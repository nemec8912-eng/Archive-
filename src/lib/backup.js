// Резервная копия — один файл: 12 цифр длины заголовка, JSON-заголовок, затем файлы подряд.
// Файл создаётся и читается только на устройстве, никуда не отправляется.
import { getBlob, putBlob, clearBlobs, blobIdsOf, blobInfo } from './db.js';
import { memorySink } from './sink.js';
import { fmtDay } from './format.js';

const MAGIC = 'archive-backup';

export const backupName = () => `archive-backup-${fmtDay(Date.now()).split('.').reverse().join('-')}.archive`;

// Копия пишется по частям: сначала оглавление (размеры известны заранее), затем файлы по одному.
// sink — куда писать (см. sink.js); возвращает то, что вернул sink.finish(), и общий размер.
export async function createBackup(state, { sink = memorySink('application/octet-stream'), onProgress } = {}) {
  const ids = [...new Set(state.items.flatMap(blobIdsOf))];
  const index = [];
  let offset = 0;
  for (const id of ids) {
    const info = await blobInfo(id);
    if (!info) continue;
    index.push({ id, offset, size: info.size, type: info.type });
    offset += info.size;
  }
  const header = new TextEncoder().encode(
    JSON.stringify({ magic: MAGIC, version: 1, createdAt: Date.now(), state, blobs: index })
  );
  const len = String(header.length).padStart(12, '0');
  await sink.write(new Blob([len, header]));
  for (let i = 0; i < index.length; i++) {
    const b = await getBlob(index[i].id);
    if (!b || b.size !== index[i].size) throw new Error('Файл изменился во время создания копии');
    await sink.write(b);
    onProgress?.(i + 1, index.length);
  }
  return { file: await sink.finish(), name: backupName(), size: 12 + header.length + offset };
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
