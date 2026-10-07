import test from 'node:test';
import assert from 'node:assert/strict';
import { packBox, openBox, isBox } from '../src/lib/cryptoBox.js';
import { newDataKey, wrapWithPin, unwrapWithPin } from '../src/lib/vault.js';
import { randomBlob, sameBytes } from './memfs.mjs';

test('код доступа: верный открывает ключ данных, неверный — нет', async () => {
  const dek = await newDataKey();
  const rec = await wrapWithPin('2580', dek);
  assert.equal(rec.iter, 600000);
  const back = await unwrapWithPin('2580', rec);
  const raw = (k) => crypto.subtle.exportKey('raw', k).then((b) => Buffer.from(b).toString('hex'));
  assert.equal(await raw(back), await raw(dek));
  assert.equal(await unwrapWithPin('0000', rec), null);
});

test('экспорт папок (.archivebox): пароль, содержимое и неверный пароль', async () => {
  const a = randomBlob(9 * 1024 * 1024, 'video/mp4');
  const b = new Blob(['заметка'], { type: 'text/plain' });
  const files = { a, b };
  const entries = Object.entries(files).map(([id, f]) => ({ id, type: f.type, size: f.size }));
  const box = await packBox('пароль-1', { folders: [{ id: 'f1', name: 'Отпуск' }] }, entries, { read: async (id) => files[id] });
  assert.ok(await isBox(box));
  const opened = await openBox(box, 'пароль-1');
  assert.equal(opened.payload.folders[0].name, 'Отпуск');
  assert.ok(await sameBytes(a, await opened.readBlob('a')));
  assert.equal(await (await opened.readBlob('b')).text(), 'заметка');
  await assert.rejects(openBox(box, 'не тот'), (e) => e.code === 'password');
});

test('экспорт папок пишется по частям, а не одним куском', async () => {
  const writes = [];
  const sink = { async write(p) { writes.push(p.size ?? p.length); }, async finish() { return 'готово'; } };
  const big = randomBlob(9 * 1024 * 1024);
  const res = await packBox('пароль', {}, [{ id: 'v', type: '', size: big.size }], { read: async () => big, sink });
  assert.equal(res, 'готово');
  assert.equal(writes.length, 1 + 2); // заголовок + две части по 8 МБ и меньше
  assert.ok(Math.max(...writes) <= 8 * 1024 * 1024 + 16);
});

test('экспорт останавливается, если файл изменился по ходу', async () => {
  await assert.rejects(packBox('пароль', {}, [{ id: 'x', type: '', size: 10 }], { read: async () => new Blob(['короче']) }), /изменился/);
});
