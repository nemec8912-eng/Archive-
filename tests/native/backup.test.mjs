// Резервная копия так, как она работает в приложении на телефоне: файлы в папке приложения,
// копия пишется по частям, восстанавливается целиком, в том числе при включённом шифровании.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBlob, sameBytes, key } from '../memfs.mjs';

const db = await import('../../src/lib/db.js');
const { createBackup, readBackup, restoreBackup } = await import('../../src/lib/backup.js');

test('резервная копия: создаётся по частям и восстанавливает все файлы', async () => {
  await db.clearBlobs();
  const photo = new Blob(['jpeg-данные'], { type: 'image/jpeg' });
  const video = randomBlob(5 * 1024 * 1024 + 7, 'video/mp4');
  const p = await db.saveBlob(photo);
  const v = await db.saveBlob(video);
  const state = { folders: [{ id: 'f', name: 'Отпуск' }], items: [
    { id: 'i1', type: 'photo', blobId: p, folderId: 'f' },
    { id: 'i2', type: 'video', blobId: v, folderId: 'f' },
    { id: 'i3', type: 'note', text: 'без файла' },
  ] };
  const writes = [];
  const parts = [];
  const sink = { async write(x) { writes.push(x.size); parts.push(x); }, async finish() { return new Blob(parts); } };
  const { file, size, name } = await createBackup(state, { sink });
  assert.match(name, /^archive-backup-\d{4}-\d{2}-\d{2}\.archive$/);
  assert.equal(writes.length, 3); // оглавление и два файла — по отдельности
  assert.equal(file.size, size);

  const { header } = await readBackup(file);
  assert.equal(header.state.items.length, 3);

  await db.clearBlobs();
  const restored = await restoreBackup(file);
  assert.deepEqual(restored, state);
  assert.equal(await (await db.getBlob(p)).text(), 'jpeg-данные');
  const back = await db.getBlob(v);
  assert.equal(back.type, 'video/mp4');
  assert.ok(await sameBytes(video, back));
  await db.clearBlobs();
});

test('резервная копия при включённой блокировке: файлы в копии открытые, после восстановления снова зашифрованы', async () => {
  const k = await key();
  db.setDataKey(k);
  db.setRequireKey(true);
  const id = await db.saveBlob(new Blob(['секрет'], { type: 'text/plain' }));
  const { file } = await createBackup({ folders: [], items: [{ id: 'n', blobId: id }] });
  assert.match(await file.text(), /секрет/); // копия не шифруется — об этом предупреждает README
  await db.clearBlobs();
  await restoreBackup(file);
  assert.equal(await (await db.getBlob(id)).text(), 'секрет');
  assert.equal((await db.blobInfo(id)).size, 'секрет'.length * 2);
  db.setDataKey(null);
  await assert.rejects(db.getBlob(id));
  db.setRequireKey(false);
  await db.clearBlobs();
});

test('испорченный файл копии распознаётся', async () => {
  await assert.rejects(readBackup(new Blob(['это не копия'])), /Неверный файл/);
});
