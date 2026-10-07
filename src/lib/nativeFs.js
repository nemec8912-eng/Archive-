// Доступ к папке приложения на телефоне (Capacitor Filesystem) для файлового хранилища архива.
// Папка Library: на iPhone не видна в «Файлах» и не очищается системой, на Android — личная папка приложения.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { toB64, fromB64 } from './cryptoBox.js';

const D = Directory.Library;
const missing = (e) => /exist|not found|no such|doesn't|does not/i.test(e?.message || '');

export const nativeFilesAvailable = () => Capacitor.isNativePlatform();

export const nativeFs = {
  async write(path, u8) {
    await Filesystem.writeFile({ path, data: toB64(u8), directory: D, recursive: true });
  },
  async append(path, u8) {
    await Filesystem.appendFile({ path, data: toB64(u8), directory: D });
  },
  async read(path) {
    let uri;
    try {
      await Filesystem.stat({ path, directory: D });
      ({ uri } = await Filesystem.getUri({ path, directory: D }));
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
    // Быстрый путь: файл читается самим WebView, без перегонки через base64.
    try {
      const res = await fetch(Capacitor.convertFileSrc(uri));
      if (res.ok) return await res.blob();
    } catch { /* ниже — запасной путь */ }
    const r = await Filesystem.readFile({ path, directory: D });
    return typeof r.data === 'string' ? new Blob([fromB64(r.data)]) : r.data;
  },
  // Первые n байт файла: поток читается до нужного места и обрывается — большое видео целиком не грузится.
  async head(path, n) {
    let uri;
    try {
      await Filesystem.stat({ path, directory: D });
      ({ uri } = await Filesystem.getUri({ path, directory: D }));
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
    try {
      const res = await fetch(Capacitor.convertFileSrc(uri), { headers: { Range: `bytes=0-${n - 1}` } });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        while (got < n) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
        }
        reader.cancel().catch(() => {});
        return new Blob(chunks).slice(0, n);
      }
    } catch { /* ниже — чтение целиком */ }
    const all = await this.read(path);
    return all && all.slice(0, n);
  },
  async remove(path) {
    try { await Filesystem.deleteFile({ path, directory: D }); } catch (e) { if (!missing(e)) throw e; }
  },
  async rename(from, to) {
    await this.remove(to);
    await Filesystem.rename({ from, to, directory: D, toDirectory: D });
  },
  async list(dir) {
    try {
      const r = await Filesystem.readdir({ path: dir, directory: D });
      return (r.files || []).map((f) => (typeof f === 'string' ? f : f.name)).filter((n) => n && n !== '.' && n !== '..');
    } catch {
      return [];
    }
  },
  async clear(dir) {
    try { await Filesystem.rmdir({ path: dir, directory: D, recursive: true }); } catch (e) { if (!missing(e)) throw e; }
  },
};
