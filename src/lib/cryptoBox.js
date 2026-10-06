// Шифрование на устройстве: AES-GCM 256, ключ из пароля через PBKDF2-SHA-256.
export const PBKDF2_ITER = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(secret, salt, { iterations = PBKDF2_ITER, usages = ['encrypt', 'decrypt'], extractable = false } = {}) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    extractable,
    usages,
  );
}

export async function encryptBytes(key, data) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv, ct: new Uint8Array(ct) };
}

export async function decryptBytes(key, iv, ct) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

export const encryptJson = (key, obj) => encryptBytes(key, enc.encode(JSON.stringify(obj)));
export const decryptJson = async (key, iv, ct) => JSON.parse(dec.decode(await decryptBytes(key, iv, ct)));

export const toB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ── Зашифрованный файл с папками (.archivebox) ──
// [8 байт "ARCHBOX1"][16 байт соль][4 байта длина заголовка][12 iv + шифр заголовка][части файлов…]
const MAGIC = 'ARCHBOX1';
const PART = 8 * 1024 * 1024; // файлы шифруются частями, чтобы не держать большие видео в памяти целиком

export async function packBox(password, payload, blobs, onProgress) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  const parts = [];
  const index = [];
  let n = 0;
  for (const { id, blob } of blobs) {
    const entry = { id, type: blob.type, size: blob.size, parts: [] };
    for (let off = 0; off < blob.size || (off === 0 && blob.size === 0); off += PART) {
      const { iv, ct } = await encryptBytes(key, await blob.slice(off, off + PART).arrayBuffer());
      entry.parts.push({ iv: toB64(iv), len: ct.length });
      parts.push(ct);
      if (blob.size === 0) break;
    }
    index.push(entry);
    onProgress?.(++n, blobs.length);
  }
  const head = await encryptJson(key, { ...payload, blobs: index });
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.iv.length + head.ct.length, true);
  return new Blob([enc.encode(MAGIC), salt, len, head.iv, head.ct, ...parts], { type: 'application/octet-stream' });
}

export async function isBox(file) {
  return dec.decode(await file.slice(0, 8).arrayBuffer()) === MAGIC;
}

// Возвращает { payload, readBlob(entry) } или бросает ошибку при неверном пароле.
export async function openBox(file, password) {
  if (!(await isBox(file))) throw new Error('Это не файл экспорта Архива');
  const salt = new Uint8Array(await file.slice(8, 24).arrayBuffer());
  const hlen = new DataView(await file.slice(24, 28).arrayBuffer()).getUint32(0, true);
  const head = new Uint8Array(await file.slice(28, 28 + hlen).arrayBuffer());
  const key = await deriveKey(password, salt);
  let payload;
  try {
    payload = await decryptJson(key, head.subarray(0, 12), head.subarray(12));
  } catch {
    const err = new Error('Неверный пароль');
    err.code = 'password';
    throw err;
  }
  // смещения частей
  let off = 28 + hlen;
  const where = new Map();
  for (const b of payload.blobs) {
    const list = b.parts.map((p) => { const r = { iv: fromB64(p.iv), start: off, len: p.len }; off += p.len; return r; });
    where.set(b.id, { ...b, list });
  }
  return {
    payload,
    async readBlob(id) {
      const b = where.get(id);
      if (!b) return null;
      const chunks = [];
      for (const p of b.list) {
        chunks.push(await decryptBytes(key, p.iv, new Uint8Array(await file.slice(p.start, p.start + p.len).arrayBuffer())));
      }
      return new Blob(chunks, { type: b.type });
    },
  };
}
