// Локальное хранилище на устройстве (IndexedDB).
// meta  — структура архива (папки, материалы, настройки)
// blobs — сами файлы и миниатюры
const DB_NAME = 'archive-db';
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req && 'onsuccess' in req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ── Шифрование на устройстве ──
// Пока архив разблокирован, в памяти лежит ключ данных (AES-GCM 256). Без блокировки — файлы хранятся как есть.
let KEY = null;
let REQUIRE_KEY = false; // при включённой блокировке запись без ключа запрещена — открытые данные не попадут на диск
const PART = 4 * 1024 * 1024;

export function setDataKey(key) { KEY = key; }
export function setRequireKey(v) { REQUIRE_KEY = !!v; }
const guard = () => { if (REQUIRE_KEY && !KEY) throw new Error('Архив заблокирован'); };
export const hasDataKey = () => !!KEY;

const isSealed = (v) => v && typeof v === 'object' && v.__sealed === 1;

async function sealBytes(buf) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, buf);
  return { iv, ct };
}

async function sealBlob(blob, key = KEY) {
  const parts = [];
  for (let off = 0; off < blob.size || off === 0; off += PART) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await blob.slice(off, off + PART).arrayBuffer());
    parts.push({ iv, ct });
    if (!blob.size) break;
  }
  return { __sealed: 1, kind: 'blob', type: blob.type, size: blob.size, parts };
}

async function openSealed(rec, key = KEY) {
  if (!key) throw new Error('Архив заблокирован');
  if (rec.kind === 'blob') {
    const chunks = [];
    for (const p of rec.parts) chunks.push(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p.iv }, key, p.ct));
    return new Blob(chunks, { type: rec.type });
  }
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

// Во время перешифрования часть записей может уже быть под новым ключом.
async function openAny(v, ...keys) {
  let err;
  for (const k of keys) {
    if (!k) continue;
    try { return await openSealed(v, k); } catch (e) { err = e; }
  }
  throw err || new Error('Нет ключа');
}

const rawGet = (store, key) => run(store, 'readonly', (s) => s.get(key));
const rawPut = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key));

export async function getMeta(key) {
  const v = await rawGet('meta', key);
  return isSealed(v) ? openSealed(v) : v;
}
export async function setMeta(key, value) {
  guard();
  if (!KEY) return rawPut('meta', key, value);
  const { iv, ct } = await sealBytes(new TextEncoder().encode(JSON.stringify(value)));
  return rawPut('meta', key, { __sealed: 1, kind: 'json', iv, ct });
}
export async function getBlob(id) {
  const v = await rawGet('blobs', id);
  if (!v) return v;
  return isSealed(v) ? openSealed(v) : v;
}
export async function putBlob(id, blob) {
  guard();
  return rawPut('blobs', id, KEY ? await sealBlob(blob) : blob);
}
export const deleteBlobs = (ids) =>
  run('blobs', 'readwrite', (s) => { ids.filter(Boolean).forEach((id) => s.delete(id)); });
export const clearBlobs = () => run('blobs', 'readwrite', (s) => s.clear());
export const blobKeys = () => run('blobs', 'readonly', (s) => s.getAllKeys());

// Перешифровать всё хранилище: from — текущий ключ (или null для открытых данных), to — новый (или null — снять шифрование).
export async function rekeyAll(from, to, onProgress) {
  const keys = await blobKeys();
  for (let i = 0; i < keys.length; i++) {
    onProgress?.(i, keys.length);
    const v = await rawGet('blobs', keys[i]);
    if (!v) continue;
    const blob = isSealed(v) ? await openAny(v, from, to) : v;
    await rawPut('blobs', keys[i], to ? await sealBlob(blob, to) : blob);
  }
  const metaKeys = await run('meta', 'readonly', (s) => s.getAllKeys());
  for (const k of metaKeys) {
    const v = await rawGet('meta', k);
    const plain = isSealed(v) ? await openAny(v, from, to) : v;
    if (to) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, to, new TextEncoder().encode(JSON.stringify(plain)));
      await rawPut('meta', k, { __sealed: 1, kind: 'json', iv, ct });
    } else {
      await rawPut('meta', k, plain);
    }
  }
  onProgress?.(keys.length, keys.length);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function saveBlob(blob) {
  const id = uid();
  await putBlob(id, blob);
  return id;
}

// Все идентификаторы файлов, на которые ссылается материал.
export function blobIdsOf(item) {
  const ids = [item.blobId, item.thumbId];
  (item.attachments || []).forEach((a) => ids.push(a.blobId, a.thumbId));
  (item.messages || []).forEach((m) => ids.push(m.blobId, m.thumbId));
  return ids.filter(Boolean);
}
