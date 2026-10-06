// Резервная копия — один файл: 12 цифр длины заголовка, JSON-заголовок, затем файлы подряд.
// Файл создаётся и читается только на устройстве, никуда не отправляется.
import { getBlob, putBlob, clearBlobs, blobIdsOf } from './db.js';
import { fmtDay } from './format.js';

const MAGIC = 'archive-backup';

export async function createBackup(state) {
  const ids = [...new Set(state.items.flatMap(blobIdsOf))];
  const blobs = [];
  const index = [];
  let offset = 0;
  for (const id of ids) {
    const b = await getBlob(id);
    if (!b) continue;
    index.push({ id, offset, size: b.size, type: b.type });
    blobs.push(b);
    offset += b.size;
  }
  const header = new TextEncoder().encode(
    JSON.stringify({ magic: MAGIC, version: 1, createdAt: Date.now(), state, blobs: index })
  );
  const len = String(header.length).padStart(12, '0');
  const name = `archive-backup-${fmtDay(Date.now()).split('.').reverse().join('-')}.archive`;
  return { blob: new Blob([len, header, ...blobs], { type: 'application/octet-stream' }), name };
}

export async function readBackup(file) {
  const len = parseInt(await file.slice(0, 12).text(), 10);
  if (!Number.isFinite(len) || len <= 0) throw new Error('Неверный файл копии');
  const header = JSON.parse(await file.slice(12, 12 + len).text());
  if (header.magic !== MAGIC) throw new Error('Неверный файл копии');
  return { header, base: 12 + len };
}

export async function restoreBackup(file) {
  const { header, base } = await readBackup(file);
  await clearBlobs();
  for (const b of header.blobs) {
    const part = file.slice(base + b.offset, base + b.offset + b.size, b.type);
    // Копируем данные в память, чтобы не зависеть от исходного файла.
    await putBlob(b.id, new Blob([await part.arrayBuffer()], { type: b.type }));
  }
  return header.state;
}
