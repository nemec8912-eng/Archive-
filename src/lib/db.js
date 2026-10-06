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

export const getMeta = (key) => run('meta', 'readonly', (s) => s.get(key));
export const setMeta = (key, value) => run('meta', 'readwrite', (s) => s.put(value, key));
export const getBlob = (id) => run('blobs', 'readonly', (s) => s.get(id));
export const putBlob = (id, blob) => run('blobs', 'readwrite', (s) => s.put(blob, id));
export const deleteBlobs = (ids) =>
  run('blobs', 'readwrite', (s) => { ids.filter(Boolean).forEach((id) => s.delete(id)); });
export const clearBlobs = () => run('blobs', 'readwrite', (s) => s.clear());

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
