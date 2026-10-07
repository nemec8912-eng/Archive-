// Минимальная IndexedDB в памяти: ровно то, чем пользуется src/lib/db.js.
const dbs = new Map();
export const idbData = (name, store) => dbs.get(name)?.get(store);

function request(fn) {
  const req = { result: undefined, error: null, onsuccess: null };
  req.result = fn();
  return req;
}

export const fakeIndexedDB = {
  open(name) {
    const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
    setTimeout(() => {
      const fresh = !dbs.has(name);
      if (fresh) dbs.set(name, new Map());
      const stores = dbs.get(name);
      const db = {
        objectStoreNames: { contains: (s) => stores.has(s) },
        createObjectStore: (s) => { stores.set(s, new Map()); },
        transaction(storeName, mode) {
          const reqs = [];
          const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
          const map = stores.get(storeName);
          const ro = mode !== 'readwrite';
          const op = (fn) => { const r = request(fn); reqs.push(r); return r; };
          tx.objectStore = () => ({
            get: (key) => op(() => map.get(key)),
            put: (v, key) => { if (ro) throw new Error('readonly'); return op(() => { map.set(key, v); return key; }); },
            delete: (key) => op(() => { map.delete(key); }),
            clear: () => op(() => { map.clear(); }),
            getAllKeys: () => op(() => [...map.keys()]),
          });
          setTimeout(() => { reqs.forEach((r) => r.onsuccess?.()); tx.oncomplete?.(); }, 0);
          return tx;
        },
      };
      req.result = db;
      if (fresh) req.onupgradeneeded?.();
      req.onsuccess?.();
    }, 0);
    return req;
  },
};
