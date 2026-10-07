import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileBlobStore, readHeader, PART } from '../src/lib/fileBlobs.js';
import { memFs, key, randomBlob, sameBytes } from './memfs.mjs';

test('открытый файл: записывается и читается без изменений, тип сохраняется', async () => {
  const fs = memFs();
  const st = createFileBlobStore(fs);
  const src = randomBlob(5 * 1024 * 1024 + 123, 'video/mp4');
  await st.write('a', src);
  const back = await st.read('a');
  assert.equal(back.type, 'video/mp4');
  assert.ok(await sameBytes(src, back));
  assert.equal((await st.info('a')).enc, 0);
});

test('зашифрованный файл больше одной части: читается только с ключом', async () => {
  const st = createFileBlobStore(memFs());
  const k = await key();
  const src = randomBlob(2 * PART + 777, 'image/jpeg');
  await st.write('b', src, k);
  const h = await st.info('b');
  assert.equal(h.enc, 1);
  assert.equal(h.lens.length, 3);
  assert.ok(await sameBytes(src, await st.read('b', [k])));
  await assert.rejects(st.read('b', []), /заблокирован/);
  await assert.rejects(st.read('b', [await key()]));
});

test('на диске нет открытых данных, если файл зашифрован', async () => {
  const fs = memFs();
  const st = createFileBlobStore(fs);
  const text = 'секретная заметка '.repeat(200);
  await st.write('c', new Blob([text], { type: 'text/plain' }), await key());
  const raw = await (await fs.read('archive-blobs/c')).text();
  assert.ok(!raw.includes('секретная'));
});

test('во время перешифрования годится любой из двух ключей', async () => {
  const st = createFileBlobStore(memFs());
  const oldK = await key();
  const newK = await key();
  const src = randomBlob(1000);
  await st.write('d', src, oldK);
  assert.ok(await sameBytes(src, await st.read('d', [newK, oldK])));
  await st.write('d', await st.read('d', [newK, oldK]), newK);
  assert.ok(await sameBytes(src, await st.read('d', [newK])));
  await assert.rejects(st.read('d', [oldK]));
});

test('пустой файл — и открытый, и зашифрованный', async () => {
  const st = createFileBlobStore(memFs());
  const k = await key();
  await st.write('e1', new Blob([], { type: 'text/plain' }));
  await st.write('e2', new Blob([], { type: 'text/plain' }), k);
  assert.equal((await st.read('e1')).size, 0);
  assert.equal((await st.read('e2', [k])).size, 0);
});

// Так файл хранился в базе прошлой версии (db.js, sealBlob).
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

test('перенос из базы: зашифрованная запись переносится без ключа и читается с ключом', async () => {
  const st = createFileBlobStore(memFs());
  const k = await key();
  const src = randomBlob(PART + 5000, 'video/quicktime');
  await st.writeRecord('m1', await legacySealed(src, k));
  const back = await st.read('m1', [k]);
  assert.equal(back.type, 'video/quicktime');
  assert.ok(await sameBytes(src, back));
});

test('перенос из базы: открытая запись', async () => {
  const st = createFileBlobStore(memFs());
  const src = randomBlob(4321, 'audio/mp4');
  await st.writeRecord('m2', src);
  assert.ok(await sameBytes(src, await st.read('m2')));
});

test('оборванная запись не портит прежний файл и не оставляет мусора', async () => {
  const fs = memFs({ failAppendAt: 2 });
  const st = createFileBlobStore(fs);
  const first = new Blob(['старое'], { type: 'text/plain' });
  // первая запись помещается в одну порцию — append не вызывается
  await st.write('f', first);
  await assert.rejects(st.write('f', randomBlob(4 * 1024 * 1024)), /Нет места/);
  assert.equal(await (await st.read('f')).text(), 'старое');
  assert.deepEqual(await fs.list('archive-blobs'), ['f']);
});

test('список, удаление, очистка и уборка временных файлов', async () => {
  const fs = memFs();
  const st = createFileBlobStore(fs);
  await st.write('x', new Blob(['1']));
  await st.write('y', new Blob(['2']));
  await fs.write('archive-blobs/z.tmp', new Uint8Array([1]));
  assert.deepEqual((await st.keys()).sort(), ['x', 'y']);
  await st.sweepTemp();
  assert.deepEqual((await fs.list('archive-blobs')).sort(), ['x', 'y']);
  await st.remove(['x', null, 'нет-такого']);
  assert.equal(await st.read('x'), null);
  await st.clear();
  assert.deepEqual(await st.keys(), []);
});

test('повреждённый файл распознаётся', async () => {
  await assert.rejects(readHeader(new Blob(['мусор, а не файл архива'])), /повреждён/);
});
