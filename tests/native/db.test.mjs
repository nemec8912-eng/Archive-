// Проверка db.js так, как он работает в приложении на телефоне: файлы в папке приложения,
// перенос из базы прошлых версий, перешифрование и запрет записи без ключа.
import test from 'node:test';
import assert from 'node:assert/strict';
import { idbData } from '../stubs/fake-idb.mjs';
import { disk } from '../stubs/capacitor-filesystem.mjs';
import { PART } from '../../src/lib/fileBlobs.js';
import { key, randomBlob, sameBytes } from '../memfs.mjs';

const db = await import('../../src/lib/db.js');
const blobsInDb = () => idbData('archive-db', 'blobs');
const filesOnDisk = () => [...disk.keys()].filter((p) => p.startsWith('LIBRARY:archive-blobs/'));

async function legacySealed(blob, k) {
  const parts = [];
  for (let off = 0; off < blob.size || off === 0; off += PART) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, await blob.slice(off, off + PART).arrayBuffer());
    parts.push({ iv, ct });
    if (!blob.size) break;
  }
  return { __sealed: 1, kind: 'blob', type: blob.type, size: blob.size, parts };
}

test('в приложении для телефона используется файловое хранилище', () => {
  assert.equal(db.usesFileStorage(), true);
});

test('перенос из базы: всё уходит в файлы, зашифрованное остаётся зашифрованным', async () => {
  await db.getMeta('state'); // открыть базу
  const k = await key();
  const plain = randomBlob(PART + 10, 'image/png');
  const secret = randomBlob(3000, 'audio/mp4');
  blobsInDb().set('old-plain', plain);
  blobsInDb().set('old-sealed', await legacySealed(secret, k));
  assert.equal(await db.migrateBlobsToFiles(), 2);
  assert.equal(blobsInDb().size, 0);
  assert.equal(filesOnDisk().length, 2);
  assert.ok(await sameBytes(plain, await db.getBlob('old-plain')));
  await assert.rejects(db.getBlob('old-sealed')); // без ключа не читается
  db.setDataKey(k);
  assert.ok(await sameBytes(secret, await db.getBlob('old-sealed')));
  db.setDataKey(null);
  await db.clearBlobs();
});

test('новые файлы пишутся в папку приложения, а не в базу', async () => {
  const id = await db.saveBlob(new Blob(['фото'], { type: 'image/jpeg' }));
  assert.equal(blobsInDb().size, 0);
  assert.equal(await (await db.getBlob(id)).text(), 'фото');
  assert.deepEqual(await db.blobKeys(), [id]);
  await db.deleteBlobs([id]);
  assert.equal(await db.getBlob(id), undefined);
});

test('включение и снятие шифрования перешифровывает файлы и структуру архива', async () => {
  const src = randomBlob(2 * PART + 1, 'video/mp4');
  await db.putBlob('v', src);
  await db.setMeta('state', { items: [{ id: 'v', name: 'Отпуск' }] });
  const k = await key();
  db.setDataKey(k);
  await db.rekeyAll(null, k);
  db.setRequireKey(true);
  const onDisk = Buffer.from([...disk.entries()].find(([p]) => p.endsWith('/v'))[1]).toString();
  assert.match(onDisk, /"enc":1/);
  assert.ok(await sameBytes(src, await db.getBlob('v')));
  assert.equal((await db.getMeta('state')).items[0].name, 'Отпуск');
  // заблокировано: чтения нет, запись запрещена
  db.setDataKey(null);
  await assert.rejects(db.getBlob('v'));
  await assert.rejects(db.putBlob('w', new Blob(['x'])), /заблокирован/);
  await assert.rejects(db.setMeta('state', {}), /заблокирован/);
  // снять шифрование
  db.setRequireKey(false);
  await db.rekeyAll(k, null);
  assert.ok(await sameBytes(src, await db.getBlob('v')));
  assert.equal((await db.getMeta('state')).items[0].name, 'Отпуск');
  await db.clearBlobs();
});

test('удаление во время переноса не оставляет лишних файлов', async () => {
  blobsInDb().set('gone', randomBlob(100));
  const p = db.migrateBlobsToFiles();
  await db.deleteBlobs(['gone']);
  await p;
  assert.equal(await db.getBlob('gone'), undefined);
  assert.equal(filesOnDisk().length, 0);
});
