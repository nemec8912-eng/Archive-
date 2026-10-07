import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWhatsApp, parseTelegramJson, parseChatFile, buildChatItem } from '../src/lib/chatImport.js';

const local = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const zip = (name) => new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name, { type: 'application/zip' });

test('WhatsApp Android: многострочные сообщения и пропущенные медиа', () => {
  const m = parseWhatsApp('07.10.2026, 01:18 - Аня: Привет\nвторая строка\n07.10.2026, 01:19 - Я: <Без медиафайлов>\n');
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], { author: 'Аня', time: local(2026, 10, 7, 1, 18), text: 'Привет\nвторая строка', file: null });
  assert.equal(m[1].text, '[медиафайл не был сохранён в экспорте]');
});

test('WhatsApp на английском: AM/PM, месяц впереди, вложенный файл', () => {
  const m = parseWhatsApp('10/7/26, 1:18 AM - Ann: Hi\n10/13/26, 1:19 PM - Me: IMG-1.jpg (file attached)\nnote');
  assert.equal(m[0].time, local(2026, 10, 7, 1, 18));
  assert.equal(m[1].time, local(2026, 10, 13, 13, 19));
  assert.equal(m[1].file, 'IMG-1.jpg');
  assert.equal(m[1].text, 'note');
});

test('Telegram JSON: служебные сообщения пропускаются, форматированный текст склеивается', () => {
  const r = parseTelegramJson({ name: 'Чат', messages: [
    { type: 'service', actor: 'A', date_unixtime: '1' },
    { type: 'message', from: 'A', date_unixtime: '1791280860', text: [{ type: 'bold', text: 'Жирный' }, ' и обычный'] },
  ] });
  assert.equal(r.title, 'Чат');
  assert.deepEqual(r.messages.map((x) => x.text), ['Жирный и обычный']);
  assert.equal(r.messages[0].time, 1791280860000);
  assert.throws(() => parseTelegramJson({ foo: 1 }), /нет сообщений/);
});

test('архив WhatsApp (.zip): переписка, участники и фото', async () => {
  const p = await parseChatFile(zip('whatsapp.zip'));
  assert.deepEqual(p.participants.sort(), ['Аня', 'Я']);
  assert.equal(p.messages.length, 4);
  assert.equal(p.messages[1].text, 'Привет 😊\nкак дела?');
  assert.equal(p.messages[2].file, '00000012-PHOTO-2026-10-07-01-20-00.jpg');
  assert.ok(p.media.has('00000012-PHOTO-2026-10-07-01-20-00.jpg'));
});

test('архив Telegram (.zip) превращается в переписку с вложениями', async () => {
  const p = await parseChatFile(zip('telegram.zip'));
  assert.equal(p.title, 'Семья');
  assert.equal(p.messages.length, 4);
  const saved = [];
  let n = 0;
  const item = await buildChatItem(p, 'Я', 'f1', {
    saveBlob: async (b) => { saved.push(b); return `blob${saved.length}`; },
    imageInfo: async () => ({ thumb: null }),
    audioInfo: async () => ({ duration: 3, waveform: [] }),
    uid: () => `id${++n}`,
  });
  assert.equal(item.type, 'chat');
  assert.equal(item.folderId, 'f1');
  assert.equal(item.chatStart, 1791280860000);
  const kinds = item.messages.map((m) => `${m.from}:${m.kind}`);
  // фото есть в архиве — сохраняется; голосового в архиве нет — остаётся текстовая пометка
  assert.deepEqual(kinds, ['them:text', 'me:text', 'them:photo', 'me:text']);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].type, 'image/jpeg');
  assert.match(item.messages[3].text, /\[файл: audio_1\.ogg\]/);
});

test('пустой файл переписки — понятная ошибка', async () => {
  await assert.rejects(parseChatFile(new File(['\n\n'], 'chat.txt')), /нет сообщений/);
});
