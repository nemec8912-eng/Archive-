// Папка приложения в памяти с тем же поведением, что у Capacitor Filesystem (данные — base64).
export const Directory = { Library: 'LIBRARY', Cache: 'CACHE' };
export const disk = new Map();
const k = (o) => `${o.directory}:${o.path}`;
const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const nope = () => { throw new Error('File does not exist.'); };
const cat = (a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };

export const Filesystem = {
  async writeFile(o) { disk.set(k(o), b64(o.data)); return { uri: `mem://${o.path}` }; },
  async appendFile(o) { if (!disk.has(k(o))) nope(); disk.set(k(o), cat(disk.get(k(o)), b64(o.data))); },
  async stat(o) { if (!disk.has(k(o))) nope(); return { size: disk.get(k(o)).length }; },
  async getUri(o) { return { uri: `mem://${o.path}` }; },
  async readFile(o) { if (!disk.has(k(o))) nope(); return { data: Buffer.from(disk.get(k(o))).toString('base64') }; },
  async deleteFile(o) { if (!disk.delete(k(o))) nope(); },
  async rename(o) {
    const from = `${o.directory}:${o.from}`;
    if (!disk.has(from)) nope();
    disk.set(`${o.toDirectory}:${o.to}`, disk.get(from));
    disk.delete(from);
  },
  async readdir(o) {
    const pre = `${o.directory}:${o.path}/`;
    const files = [...disk.keys()].filter((x) => x.startsWith(pre)).map((x) => ({ name: x.slice(pre.length) }));
    if (!files.length) throw new Error('Directory does not exist.');
    return { files };
  },
  async rmdir(o) {
    const pre = `${o.directory}:${o.path}/`;
    for (const x of [...disk.keys()]) if (x.startsWith(pre)) disk.delete(x);
  },
};
