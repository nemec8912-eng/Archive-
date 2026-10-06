// Импорт сохранённых переписок: экспорт WhatsApp (.txt или .zip с медиа),
// экспорт Telegram (result.json или messages.html, отдельно или в .zip), обычный текст.
// Всё разбирается на устройстве.
import { readZip, isZip } from './zip.js';

const MEDIA_KIND = (name = '') => {
  const ext = name.toLowerCase().split('.').pop();
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif'].includes(ext)) return 'photo';
  if (['mp4', 'mov', 'm4v', '3gp', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['opus', 'ogg', 'oga', 'm4a', 'aac', 'mp3', 'amr', 'wav'].includes(ext)) return 'voice';
  return 'file';
};

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm', '3gp': 'video/3gpp',
  opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', amr: 'audio/amr',
};
export const mimeOf = (name = '') => MIME[name.toLowerCase().split('.').pop()] || 'application/octet-stream';
const base = (p) => p.split('/').pop();

// ── даты ──
function toTs(d, mo, y, h, mi, s = 0, ampm) {
  let year = +y;
  if (year < 100) year += 2000;
  let hour = +h;
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  const t = new Date(year, +mo - 1, +d, hour, +mi, +s).getTime();
  return Number.isFinite(t) ? t : null;
}

// ── WhatsApp ──
// Android: «07.10.2026, 01:18 - Имя: текст»; iOS: «[07.10.2026, 01:18:22] Имя: текст»;
// англ.: «10/7/26, 1:18 AM - Name: text».
const WA_LINE = /^‎?\[?(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp]\.?\s?[Mm]\.?)?\]?\s?(?:[-–—]\s)?([^:]{1,80}?):\s([\s\S]*)$/;
const WA_SYSTEM = /^‎?\[?(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2}):(\d{2})/;
const WA_ATTACH = [
  /<(?:attached|прикреплено|вложение):\s*([^>]+)>/i,
  /^‎?(.+?\.\w{2,5})\s+\((?:file attached|файл добавлен|файл прикреплён|файл прикреплен)\)/i,
];
const WA_OMITTED = /<(?:media omitted|без медиафайлов|медиафайл опущен|медиа пропущено)>|(?:image|video|audio|sticker|изображение|видео|аудио|стикер) (?:omitted|отсутствует|пропущено)/i;

export function parseWhatsApp(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const msgs = [];
  let dayFirst = null;
  for (const raw of lines) {
    const line = raw.replace(/ /g, ' ');
    const m = line.match(WA_LINE);
    if (m) {
      let [, a, b, y, h, mi, s, ampm, author, body] = m;
      // формат даты: если хотя бы раз первое число > 12 — это день
      if (dayFirst == null && +a > 12) dayFirst = true;
      if (dayFirst == null && +b > 12) dayFirst = false;
      msgs.push({ a, b, y, h, mi, s, ampm, author: author.replace(/^‎/, '').trim(), body });
    } else if (msgs.length && !WA_SYSTEM.test(line)) {
      msgs[msgs.length - 1].body += `\n${line}`;
    }
  }
  if (dayFirst == null) dayFirst = !msgs.some((m) => m.ampm);
  return msgs.map((m) => {
    const time = dayFirst ? toTs(m.a, m.b, m.y, m.h, m.mi, m.s, m.ampm) : toTs(m.b, m.a, m.y, m.h, m.mi, m.s, m.ampm);
    let body = m.body.replace(/‎/g, '').trim();
    let file = null;
    for (const re of WA_ATTACH) {
      const am = body.match(re);
      if (am) { file = am[1].trim(); body = body.replace(am[0], '').trim(); break; }
    }
    if (!file && WA_OMITTED.test(body)) body = '[медиафайл не был сохранён в экспорте]';
    return { author: m.author, time, text: body, file };
  });
}

// ── Telegram JSON ──
function tgText(t) {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.map((p) => (typeof p === 'string' ? p : p.text || '')).join('');
  return '';
}

export function parseTelegramJson(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const chat = data.messages ? data : data.chats?.list?.[0];
  if (!chat?.messages) throw new Error('В файле нет сообщений');
  const msgs = chat.messages
    .filter((m) => m.type === 'message')
    .map((m) => ({
      author: m.from || m.actor || 'Собеседник',
      time: m.date_unixtime ? +m.date_unixtime * 1000 : Date.parse(m.date) || null,
      text: tgText(m.text),
      file: m.photo || m.file || null,
      kindHint: m.photo ? 'photo' : m.media_type === 'voice_message' ? 'voice' : m.media_type === 'video_file' || m.media_type === 'video_message' ? 'video' : null,
    }));
  return { title: chat.name, messages: msgs };
}

// ── Telegram HTML ──
export function parseTelegramHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('.page_header .text')?.textContent.trim();
  const out = [];
  let lastAuthor = null;
  doc.querySelectorAll('.message.default').forEach((el) => {
    const name = el.querySelector(':scope > .body > .from_name')?.textContent.trim();
    if (name) lastAuthor = name;
    const dateTitle = el.querySelector('.date')?.getAttribute('title') || '';
    const dm = dateTitle.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const media = el.querySelector('a.photo_wrap, a.video_file_wrap, a.media_voice_message, a.media_file, a.animated_wrap, a.video_msg_wrap');
    const href = media?.getAttribute('href');
    out.push({
      author: lastAuthor || 'Собеседник',
      time: dm ? toTs(dm[1], dm[2], dm[3], dm[4], dm[5], dm[6]) : null,
      text: el.querySelector(':scope > .body > .text')?.innerText?.trim() || el.querySelector('.text')?.textContent.trim() || '',
      file: href && !/^https?:/.test(href) ? href : null,
      kindHint: media?.classList.contains('media_voice_message') ? 'voice' : null,
    });
  });
  if (!out.length) throw new Error('В файле нет сообщений');
  return { title, messages: out };
}

// Разбирает выбранный файл. Возвращает { title, messages, participants, media: Map(name → entry) }.
export async function parseChatFile(file) {
  let media = new Map();
  let parsed = null;
  let title = file.name.replace(/\.(txt|zip|json|html?)$/i, '');

  if (await isZip(file)) {
    const entries = await readZip(file);
    for (const e of entries) media.set(base(e.name), e);
    const byName = (re) => entries.find((e) => re.test(base(e.name)));
    const tgJson = byName(/^result\.json$/i);
    const tgHtml = entries.filter((e) => /^messages\d*\.html$/i.test(base(e.name)))
      .sort((x, y) => x.name.localeCompare(y.name, 'en', { numeric: true }));
    const wa = byName(/^_chat\.txt$/i) || byName(/\.txt$/i);
    if (tgJson) {
      parsed = parseTelegramJson(await (await tgJson.read()).text());
    } else if (tgHtml.length) {
      const parts = [];
      for (const h of tgHtml) parts.push(parseTelegramHtml(await (await h.read()).text()));
      parsed = { title: parts[0].title, messages: parts.flatMap((p) => p.messages) };
    } else if (wa) {
      parsed = { messages: parseWhatsApp(await (await wa.read()).text()) };
      title = title.replace(/^WhatsApp Chat( with| -)?\s*/i, '').replace(/^Чат WhatsApp( с)?\s*/i, '') || title;
    } else {
      throw new Error('В архиве не найден файл переписки');
    }
  } else {
    const text = await file.text();
    if (/\.json$/i.test(file.name) || /^\s*\{/.test(text)) parsed = parseTelegramJson(text);
    else if (/\.html?$/i.test(file.name) || /^\s*</.test(text)) parsed = parseTelegramHtml(text);
    else {
      const wa = parseWhatsApp(text);
      if (wa.length) {
        parsed = { messages: wa };
        title = title.replace(/^WhatsApp Chat( with| -)?\s*/i, '').replace(/^Чат WhatsApp( с)?\s*/i, '') || title;
      } else {
        // Обычный текст: каждая непустая строка — сообщение собеседника.
        parsed = { messages: text.split(/\n+/).filter((l) => l.trim()).map((l) => ({ author: 'Собеседник', time: null, text: l.trim() })) };
      }
    }
  }

  const messages = parsed.messages.filter((m) => m.text || m.file);
  if (!messages.length) throw new Error('В файле нет сообщений');
  const counts = new Map();
  messages.forEach((m) => counts.set(m.author, (counts.get(m.author) || 0) + 1));
  const participants = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return { title: parsed.title || title, messages, participants, media, mediaKind: MEDIA_KIND };
}

export { MEDIA_KIND };

// Создаёт материал «Переписка» из разобранного файла: сохраняет медиа и миниатюры на устройстве.
export async function buildChatItem(parsed, me, folderId, { saveBlob, imageInfo, audioInfo, uid, onProgress }) {
  const out = [];
  let size = 0;
  const total = parsed.messages.length;
  for (let i = 0; i < total; i++) {
    const m = parsed.messages[i];
    if (onProgress && i % 25 === 0) onProgress(i, total);
    const from = m.author === me ? 'me' : 'them';
    const time = m.time || null;
    if (m.file) {
      const name = m.file.split('/').pop();
      const entry = parsed.media.get(name);
      const kind = m.kindHint || MEDIA_KIND(name);
      if (entry && kind !== 'file') {
        try {
          const blob = await entry.read(mimeOf(name));
          const msg = { id: uid(), from, kind, time, blobId: await saveBlob(blob), mime: blob.type, size: blob.size, name };
          size += blob.size;
          if (kind === 'photo') {
            const info = await imageInfo(blob);
            if (info.thumb) msg.thumbId = await saveBlob(info.thumb);
          } else if (kind === 'voice') {
            const info = await audioInfo(blob);
            msg.duration = info.duration;
            msg.waveform = info.waveform;
          }
          out.push(msg);
          if (m.text) out.push({ id: uid(), from, kind: 'text', text: m.text, time });
          continue;
        } catch { /* файл не удалось прочитать — ниже останется текстовая пометка */ }
      }
      out.push({ id: uid(), from, kind: 'text', text: [m.text, `[файл: ${name}]`].filter(Boolean).join('\n'), time });
      continue;
    }
    out.push({ id: uid(), from, kind: 'text', text: m.text, time });
  }
  const first = parsed.messages.find((m) => m.time)?.time;
  return {
    id: uid(),
    type: 'chat',
    name: parsed.title || 'Переписка',
    folderId: folderId || null,
    createdAt: Date.now(),
    chatStart: first || null,
    size: size + new Blob([JSON.stringify(out)]).size,
    favorite: false,
    deletedAt: null,
    messages: out,
  };
}
