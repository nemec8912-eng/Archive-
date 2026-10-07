// Хранение файлов архива отдельными файлами в папке приложения (iPhone и Android).
// Внутренняя база WebView ограничена по объёму и может быть очищена системой, поэтому
// в установленном приложении сами фото, видео и голосовые лежат в файловой системе,
// а в базе остаётся только структура архива.
//
// Формат файла:
//   [4 байта "ARB1"][4 байта длина заголовка, LE][заголовок JSON][данные]
//   заголовок: { v: 1, type, size, enc: 0|1, ivs?: [base64], lens?: [длины частей] }
//   enc 0 — данные лежат как есть; enc 1 — части AES-GCM подряд (каждая со своим iv).
// Тип и размер файла видны и в зашифрованном виде — так же, как в базе.
//
// Модуль не зависит от Capacitor: доступ к файлам передаётся снаружи (адаптер fs),
// поэтому его можно проверять тестами без телефона.
import { toB64, fromB64 } from './cryptoBox.js';

export const MAGIC = 'ARB1';
export const PART = 4 * 1024 * 1024; // как и в базе: большие видео шифруются частями
const CHUNK = 3 * 512 * 1024; // запись порциями по 1,5 МБ, чтобы не гонять огромные строки через мост
const enc = new TextEncoder();
const dec = new TextDecoder();

export const isSealedRecord = (v) => !!v && typeof v === 'object' && v.__sealed === 1;

function header(obj) {
  const json = enc.encode(JSON.stringify({ v: 1, ...obj }));
  const out = new Uint8Array(8 + json.length);
  out.set(enc.encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  return out;
}

export async function readHeader(blob) {
  if (!blob || blob.size < 8) throw new Error('Файл повреждён');
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (dec.decode(head.subarray(0, 4)) !== MAGIC) throw new Error('Файл повреждён');
  const len = new DataView(head.buffer, head.byteOffset, 8).getUint32(4, true);
  if (8 + len > blob.size) throw new Error('Файл повреждён');
  const h = JSON.parse(dec.decode(await blob.slice(8, 8 + len).arrayBuffer()));
  return { ...h, offset: 8 + len };
}

// Последовательная запись: всё, что приходит, складывается в порции и дописывается в конец файла.
function writer(fs, path) {
  let pending = [];
  let pendingLen = 0;
  let started = false;
  const flush = async () => {
    if (!pendingLen && started) return;
    const buf = new Uint8Array(pendingLen);
    let o = 0;
    for (const p of pending) { buf.set(p, o); o += p.length; }
    pending = [];
    pendingLen = 0;
    if (started) await fs.append(path, buf);
    else { await fs.write(path, buf); started = true; }
  };
  return {
    async push(u8) {
      for (let off = 0; off < u8.length;) {
        const take = Math.min(CHUNK - pendingLen, u8.length - off);
        pending.push(u8.subarray(off, off + take));
        pendingLen += take;
        off += take;
        if (pendingLen >= CHUNK) await flush();
      }
    },
    done: flush,
  };
}

async function decryptParts(blob, h, key) {
  const chunks = [];
  let off = h.offset;
  for (let i = 0; i < h.lens.length; i++) {
    const ct = await blob.slice(off, off + h.lens[i]).arrayBuffer();
    off += h.lens[i];
    chunks.push(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(h.ivs[i]) }, key, ct));
  }
  return new Blob(chunks, { type: h.type });
}

// fs: { write(path, u8), append(path, u8), read(path) → Blob|null, head?(path, n) → Blob|null (первые n байт),
//      remove(path), rename(from, to), list(dir) → [имена], clear(dir) }
export function createFileBlobStore(fs, dir = 'archive-blobs') {
  const pathOf = (id) => `${dir}/${id}`;
  const tmpOf = (id) => `${dir}/${id}.tmp`;

  // Сначала пишем во временный файл и только потом подменяем — оборванная запись не испортит старый файл.
  async function commit(id, fill) {
    const tmp = tmpOf(id);
    try {
      await fill(tmp);
      await fs.rename(tmp, pathOf(id));
    } catch (e) {
      await fs.remove(tmp).catch(() => {});
      throw e;
    }
  }

  async function writePlain(id, blob) {
    await commit(id, async (tmp) => {
      const w = writer(fs, tmp);
      await w.push(header({ type: blob.type || '', size: blob.size, enc: 0 }));
      for (let off = 0; off < blob.size; off += CHUNK) {
        await w.push(new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer()));
      }
      await w.done();
    });
  }

  async function writeSealed(id, blob, key) {
    const n = Math.max(1, Math.ceil(blob.size / PART));
    const ivs = Array.from({ length: n }, () => crypto.getRandomValues(new Uint8Array(12)));
    const lens = Array.from({ length: n }, (_, i) => Math.min(PART, blob.size - i * PART) + 16);
    await commit(id, async (tmp) => {
      const w = writer(fs, tmp);
      await w.push(header({ type: blob.type || '', size: blob.size, enc: 1, ivs: ivs.map(toB64), lens }));
      for (let i = 0; i < n; i++) {
        const plain = await blob.slice(i * PART, (i + 1) * PART).arrayBuffer();
        await w.push(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivs[i] }, key, plain)));
      }
      await w.done();
    });
  }

  return {
    // Только заголовок: тип, размер, зашифрован ли. Если адаптер умеет читать начало файла — сам файл не читается.
    async info(id) {
      if (fs.head) {
        const start = await fs.head(pathOf(id), 64 * 1024);
        if (!start) return null;
        try { return await readHeader(start); } catch { /* заголовок длиннее — читаем целиком */ }
      }
      const b = await fs.read(pathOf(id));
      return b ? readHeader(b) : null;
    },

    // keys — ключи, которыми можно попробовать расшифровать (во время перешифрования их два).
    async read(id, keys = []) {
      const b = await fs.read(pathOf(id));
      if (!b) return null;
      const h = await readHeader(b);
      if (!h.enc) return b.slice(h.offset, h.offset + h.size, h.type);
      const usable = keys.filter(Boolean);
      if (!usable.length) throw new Error('Архив заблокирован');
      let err;
      for (const k of usable) {
        try { return await decryptParts(b, h, k); } catch (e) { err = e; }
      }
      throw err;
    },

    write(id, blob, key = null) {
      return key ? writeSealed(id, blob, key) : writePlain(id, blob);
    },

    // Перенос записи из базы как есть: зашифрованная остаётся зашифрованной, ключ не нужен.
    async writeRecord(id, rec) {
      if (!isSealedRecord(rec)) return writePlain(id, rec);
      if (rec.kind !== 'blob') throw new Error('Неизвестная запись');
      await commit(id, async (tmp) => {
        const w = writer(fs, tmp);
        const lens = rec.parts.map((p) => p.ct.byteLength);
        const ivs = rec.parts.map((p) => toB64(new Uint8Array(p.iv)));
        await w.push(header({ type: rec.type || '', size: rec.size, enc: 1, ivs, lens }));
        for (const p of rec.parts) await w.push(new Uint8Array(p.ct));
        await w.done();
      });
    },

    async remove(ids) {
      for (const id of ids.filter(Boolean)) await fs.remove(pathOf(id)).catch(() => {});
    },

    async clear() {
      await fs.clear(dir);
    },

    async keys() {
      return (await fs.list(dir)).filter((n) => !n.endsWith('.tmp'));
    },

    // Остатки оборванных записей (приложение закрыли посреди сохранения).
    async sweepTemp() {
      for (const n of await fs.list(dir)) if (n.endsWith('.tmp')) await fs.remove(`${dir}/${n}`).catch(() => {});
    },
  };
}
