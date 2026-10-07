// Локальное хранилище на устройстве (IndexedDB).
// meta  — структура архива (папки, материалы, настройки)
// blobs — сами файлы и миниатюры (в приложении для телефона — только в браузерной версии и до переноса)
import { createFileBlobStore } from './fileBlobs.js';
import { nativeFs, nativeFilesAvailable } from './nativeFs.js';
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
const rawDel = (store, ids) => run(store, 'readwrite', (s) => { ids.filter(Boolean).forEach((id) => s.delete(id)); });
const idbKeys = () => run('blobs', 'readonly', (s) => s.getAllKeys());

// ── Где лежат файлы ──
// В приложении для iPhone и Android — отдельными файлами в папке приложения (fileBlobs.js),
// в браузере — в базе. Файлы, оставшиеся в базе от прошлых версий, переносятся в фоне;
// пока перенос не закончен, чтение и удаление смотрят в оба места.
const FILES = nativeFilesAvailable() ? createFileBlobStore(nativeFs) : null;

// Перенос и перешифрование не должны идти одновременно.
let chain = Promise.resolve();
function exclusive(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}
let rekeying = false;
let REKEY_FROM = null; // старый ключ, пока идёт перешифрование

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

async function idbBlob(id, ...keys) {
  const v = await rawGet('blobs', id);
  if (!v) return v;
  return isSealed(v) ? openAny(v, ...keys) : v;
}

export async function getBlob(id) {
  if (FILES) {
    const b = await FILES.read(id, [KEY, ...(rekeying ? [REKEY_FROM] : [])]);
    if (b) return b;
  }
  return idbBlob(id, KEY, ...(rekeying ? [REKEY_FROM] : []));
}
export async function putBlob(id, blob) {
  guard();
  if (FILES) {
    await FILES.write(id, blob, KEY);
    rawDel('blobs', [id]).catch(() => {}); // старая копия в базе больше не нужна
    return;
  }
  return rawPut('blobs', id, KEY ? await sealBlob(blob) : blob);
}
export async function deleteBlobs(ids) {
  if (FILES) await FILES.remove(ids);
  await rawDel('blobs', ids);
}
export async function clearBlobs() {
  if (FILES) await FILES.clear();
  await run('blobs', 'readwrite', (s) => s.clear());
}
export async function blobKeys() {
  const keys = new Set(await idbKeys());
  if (FILES) (await FILES.keys()).forEach((k) => keys.add(k));
  return [...keys];
}
export const usesFileStorage = () => !!FILES;

// Размер и тип файла без чтения содержимого (для оглавления резервной копии и экспорта).
export async function blobInfo(id) {
  if (FILES) {
    const h = await FILES.info(id).catch(() => null);
    if (h) return { size: h.size, type: h.type };
  }
  const v = await rawGet('blobs', id);
  if (!v) return null;
  return { size: v.size, type: v.type || '' };
}

// Фоновый перенос файлов из базы в папку приложения. Ключ не нужен: зашифрованные записи
// переносятся как есть. Если приложение закроют посередине, перенос продолжится при следующем запуске.
export function migrateBlobsToFiles(onProgress) {
  if (!FILES) return Promise.resolve(0);
  return exclusive(async () => {
    await FILES.sweepTemp();
    const keys = await idbKeys();
    let moved = 0;
    for (let i = 0; i < keys.length; i++) {
      onProgress?.(i, keys.length);
      const id = keys[i];
      try {
        const v = await rawGet('blobs', id);
        if (!v) continue;
        if (!(await FILES.info(id).catch(() => null))) {
          await FILES.writeRecord(id, v);
          // Пока переносили, материал могли удалить — тогда не оставляем лишний файл.
          if (!(await rawGet('blobs', id))) { await FILES.remove([id]); continue; }
        }
        await rawDel('blobs', [id]);
        moved += 1;
      } catch {
        // Запись остаётся в базе и читается оттуда; попробуем ещё раз при следующем запуске.
      }
    }
    onProgress?.(keys.length, keys.length);
    return moved;
  });
}

// Перешифровать всё хранилище: from — текущий ключ (или null для открытых данных), to — новый (или null — снять шифрование).
export function rekeyAll(from, to, onProgress) {
  return exclusive(async () => {
    rekeying = true;
    REKEY_FROM = from;
    try {
      const idb = await idbKeys();
      const files = FILES ? await FILES.keys() : [];
      const total = idb.length + files.length;
      let done = 0;
      for (const id of files) {
        onProgress?.(done++, total);
        const blob = await FILES.read(id, [from, to]);
        if (blob) await FILES.write(id, blob, to);
      }
      for (const id of idb) {
        onProgress?.(done++, total);
        const v = await rawGet('blobs', id);
        if (!v) continue;
        const blob = isSealed(v) ? await openAny(v, from, to) : v;
        if (FILES) { await FILES.write(id, blob, to); await rawDel('blobs', [id]); }
        else await rawPut('blobs', id, to ? await sealBlob(blob, to) : blob);
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
      onProgress?.(total, total);
    } finally {
      rekeying = false;
      REKEY_FROM = null;
    }
  });
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
