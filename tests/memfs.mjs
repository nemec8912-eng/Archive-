// Папка приложения в памяти — для проверки файлового хранилища без телефона.
export function memFs({ failAppendAt = 0 } = {}) {
  const files = new Map();
  let appends = 0;
  const fs = {
    files,
    async write(path, u8) { files.set(path, [new Uint8Array(u8)]); },
    async append(path, u8) {
      appends += 1;
      if (failAppendAt && appends === failAppendAt) throw new Error('Нет места');
      if (!files.has(path)) throw new Error('File does not exist');
      files.get(path).push(new Uint8Array(u8));
    },
    async read(path) { return files.has(path) ? new Blob(files.get(path)) : null; },
    async remove(path) { files.delete(path); },
    async rename(from, to) {
      if (!files.has(from)) throw new Error('File does not exist');
      files.set(to, files.get(from));
      files.delete(from);
    },
    async list(dir) { return [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)); },
    async clear(dir) { for (const p of [...files.keys()]) if (p.startsWith(`${dir}/`)) files.delete(p); },
  };
  return fs;
}

export const key = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export function randomBlob(size, type = 'application/octet-stream') {
  const u8 = new Uint8Array(size);
  for (let off = 0; off < size; off += 65536) crypto.getRandomValues(u8.subarray(off, Math.min(size, off + 65536)));
  return new Blob([u8], { type });
}

export async function sameBytes(a, b) {
  const x = new Uint8Array(await a.arrayBuffer());
  const y = new Uint8Array(await b.arrayBuffer());
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
