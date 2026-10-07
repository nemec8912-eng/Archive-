import { saveBlob, getBlob, uid } from './db.js';
import { stamp } from './format.js';
import { markExternal } from './external.js';

const THUMB_MAX = 480;

function canvasToBlob(canvas, quality = 0.8) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function drawThumb(source, w, h) {
  const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas);
}

export async function imageInfo(blob) {
  try {
    let src;
    try {
      src = await createImageBitmap(blob);
    } catch {
      src = await loadImage(blob);
    }
    const w = src.width || src.naturalWidth;
    const h = src.height || src.naturalHeight;
    const thumb = await drawThumb(src, w, h);
    if (src.close) src.close();
    return { width: w, height: h, thumb };
  } catch {
    return {};
  }
}

export function videoInfo(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(res);
    };
    const timer = setTimeout(() => finish({ duration: Number.isFinite(v.duration) ? v.duration : 0 }), 10000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    };
    v.onseeked = async () => {
      try {
        const thumb = await drawThumb(v, v.videoWidth, v.videoHeight);
        clearTimeout(timer);
        finish({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, thumb });
      } catch {
        clearTimeout(timer);
        finish({ duration: v.duration });
      }
    };
    v.onerror = () => { clearTimeout(timer); finish({}); };
    v.src = url;
  });
}

function seededWave(seed, bars = 56) {
  let x = 0;
  for (const ch of String(seed)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [];
  for (let i = 0; i < bars; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(0.25 + ((x >>> 16) % 1000) / 1400);
  }
  return out;
}

export async function audioInfo(blob, knownDuration) {
  let duration = knownDuration || 0;
  let waveform;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const buf = await new Promise((resolve, reject) => {
      blob.arrayBuffer().then((ab) => ctx.decodeAudioData(ab, resolve, reject)).catch(reject);
    });
    if (!duration) duration = buf.duration;
    const data = buf.getChannelData(0);
    const bars = 56;
    const step = Math.max(1, Math.floor(data.length / bars));
    const raw = [];
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) sum += data[j] * data[j];
      raw.push(Math.sqrt(sum / step));
    }
    const max = Math.max(...raw) || 1;
    waveform = raw.map((r) => Math.max(0.12, r / max));
    ctx.close?.();
  } catch {
    waveform = seededWave(blob.size);
  }
  return { duration, waveform };
}

// Превращает выбранный файл в материал архива.
export async function importFile(file, type, folderId) {
  const blobId = await saveBlob(file);
  const now = Date.now();
  const item = {
    id: uid(),
    type,
    name: file.name || `${type}_${stamp(now)}`,
    folderId: folderId || null,
    createdAt: now,
    size: file.size,
    mime: file.type,
    blobId,
    favorite: false,
    deletedAt: null,
  };
  try { item.hash = await fileHash(file); } catch { /* необязательно */ }
  if (type === 'photo' || type === 'screenshot') {
    const info = await imageInfo(file);
    if (info.thumb) item.thumbId = await saveBlob(info.thumb);
    item.width = info.width;
    item.height = info.height;
    // Скриншоты из галереи автоматически попадают в свою категорию.
    if (type === 'photo' && looksLikeScreenshot(file, info)) item.type = 'screenshot';
  } else if (type === 'video') {
    const info = await videoInfo(file);
    if (info.thumb) item.thumbId = await saveBlob(info.thumb);
    item.duration = info.duration || 0;
    item.width = info.width;
    item.height = info.height;
  } else if (type === 'voice') {
    const info = await audioInfo(file, file.duration);
    item.duration = info.duration;
    item.waveform = info.waveform;
  }
  return item;
}

export function audioExt(mime = '') {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  return 'webm';
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function chatToText(item) {
  const lines = [item.name, ''];
  (item.messages || []).forEach((m) => {
    const who = m.from === 'me' ? 'Я' : 'Собеседник';
    const body = m.kind === 'text' ? m.text : `[${{ photo: 'фото', video: 'видео', voice: 'голосовое' }[m.kind] || 'вложение'}]`;
    lines.push(`${who}: ${body}`);
  });
  return lines.join('\n');
}

// Поделиться: системное меню телефона, иначе — сохранить файл.
export async function shareItem(item) {
  markExternal();
  if (window.ArchiveNative) {
    if (item.type === 'note' || item.type === 'chat') {
      return window.ArchiveNative.shareText(item.name, item.type === 'note' ? item.text || '' : chatToText(item));
    }
    const blob = await getBlob(item.blobId);
    if (blob) await window.ArchiveNative.shareFiles([new File([blob], item.name, { type: item.mime || blob.type })]);
    return undefined;
  }
  try {
    if (item.type === 'note' || item.type === 'chat') {
      const text = item.type === 'note' ? item.text || '' : chatToText(item);
      if (navigator.share) await navigator.share({ title: item.name, text });
      else downloadBlob(new Blob([text], { type: 'text/plain' }), `${item.name}.txt`);
      return;
    }
    const blob = await getBlob(item.blobId);
    if (!blob) return;
    const file = new File([blob], item.name, { type: item.mime || blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: item.name });
    } else {
      downloadBlob(file, item.name);
    }
  } catch (e) {
    if (e?.name !== 'AbortError') throw e;
  }
}

// Отпечаток файла для поиска дубликатов. Большие файлы — по выборке начала, середины и конца.
export async function fileHash(blob) {
  if (!blob) return null;
  const CH = 2 * 1024 * 1024;
  let data;
  if (blob.size <= CH * 4) {
    data = await blob.arrayBuffer();
  } else {
    const mid = Math.floor(blob.size / 2);
    const parts = await Promise.all([
      blob.slice(0, CH).arrayBuffer(),
      blob.slice(mid, mid + CH).arrayBuffer(),
      blob.slice(blob.size - CH).arrayBuffer(),
    ]);
    data = await new Blob([String(blob.size), ...parts]).arrayBuffer();
  }
  const h = await crypto.subtle.digest('SHA-256', data);
  return `${blob.size}:${[...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// Распространённые ширины снимков экрана телефонов (в пикселях).
const SCREEN_WIDTHS = new Set([640, 720, 750, 828, 1080, 1125, 1170, 1179, 1206, 1242, 1260, 1284, 1290, 1320, 1440, 1536, 1600, 1620, 1668, 1640, 2048]);

// Похоже ли изображение на скриншот: по имени файла, размеру экрана этого устройства или пропорциям экрана телефона.
export function looksLikeScreenshot(file, info = {}) {
  const name = file.name || '';
  if (/screen ?shot|скриншот|снимок экрана|screen_?capture|Скриншот/i.test(name)) return true;
  const png = /png/i.test(file.type) || /\.png$/i.test(name);
  if (!png || !info.width || !info.height) return false;
  const w = Math.min(info.width, info.height);
  const h = Math.max(info.width, info.height);
  const dpr = window.devicePixelRatio || 1;
  const sw = Math.round(Math.min(screen.width, screen.height) * dpr);
  const sh = Math.round(Math.max(screen.width, screen.height) * dpr);
  if (Math.abs(w - sw) <= 2 && Math.abs(h - sh) <= 2) return true;
  const ratio = h / w;
  return SCREEN_WIDTHS.has(w) && ratio > 1.7 && ratio < 2.4;
}

// Сохранить несколько материалов в галерею телефона. В приложении — прямо в галерею,
// в браузере — через системное меню «Поделиться» → «Сохранить» или скачиванием.
export async function saveToGallery(items) {
  const files = [];
  for (const it of items) {
    if (!it.blobId) continue;
    const blob = await getBlob(it.blobId);
    if (blob) files.push(new File([blob], it.name, { type: it.mime || blob.type }));
  }
  if (!files.length) return 0;
  markExternal();
  if (window.ArchiveNative) return window.ArchiveNative.saveToGallery(files);
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files });
      return files.length;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 0;
  }
  files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 400));
  return files.length;
}

// Отдать файл пользователю: системное меню «Поделиться» (сохранить в Файлы, отправить себе) или скачивание.
export async function offerFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  markExternal();
  if (window.ArchiveNative) return window.ArchiveNative.offerFile(file);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e?.name === 'AbortError') return false; }
  }
  downloadBlob(file, name);
  return true;
}
