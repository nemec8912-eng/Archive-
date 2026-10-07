// Связка с установленным приложением (Capacitor) для iPhone и Android.
// В браузере ничего не делает: всё работает через веб-возможности.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Media } from '@capacitor-community/media';
import { markExternal } from './lib/external.js';
import { toB64 } from './lib/cryptoBox.js';

const CHUNK = 3 * 512 * 1024;
const TEMP = 'share';
const TEMP_TTL = 15 * 60 * 1000;

// Временная копия файла для «Поделиться» и сохранения в галерею. Пишется порциями —
// большое видео не превращается целиком в одну огромную строку.
async function writeTemp(file) {
  const ext = /\.[a-z0-9]{2,5}$/i.test(file.name) ? '' : extFor(file.type);
  const path = `${TEMP}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${file.name.replace(/[\\/:*?"<>|]/g, '_')}${ext}`;
  const piece = async (off) => toB64(new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer()));
  const res = await Filesystem.writeFile({ path, data: await piece(0), directory: Directory.Cache, recursive: true });
  for (let off = CHUNK; off < file.size; off += CHUNK) {
    await Filesystem.appendFile({ path, data: await piece(off), directory: Directory.Cache });
  }
  return { path, uri: res.uri };
}

function extFor(type = '') {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/heic': '.heic', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'audio/mp4': '.m4a', 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3' };
  return map[type.split(';')[0]] || '';
}

// Старые временные копии убираются при запуске и перед новой отправкой. Сразу после «Поделиться»
// их не трогаем: приложение-получатель может ещё читать файл.
async function sweepTemp() {
  try {
    const { files } = await Filesystem.readdir({ path: TEMP, directory: Directory.Cache });
    const now = Date.now();
    for (const f of files || []) {
      const name = typeof f === 'string' ? f : f.name;
      const at = parseInt(name, 10);
      if (!at || now - at > TEMP_TTL) await Filesystem.deleteFile({ path: `${TEMP}/${name}`, directory: Directory.Cache }).catch(() => {});
    }
  } catch { /* папки ещё нет */ }
}

// Системное меню «Поделиться» (там же «Сохранить в Файлы», «Сохранить изображение»).
async function shareFiles(files) {
  markExternal();
  await sweepTemp();
  try {
    const written = [];
    for (const f of files) written.push(await writeTemp(f));
    await Share.share({ files: written.map((w) => w.uri), dialogTitle: 'Сохранить или отправить' });
    return files.length;
  } catch (e) {
    if (/cancel/i.test(e?.message || '')) return 0;
    throw e;
  }
}

// ── Сохранение в галерею телефона ──
// Фото и видео сохраняются прямо в «Фото» (iPhone) или в альбом «Архив» в галерее (Android).
// Остальное (голосовые, форматы, которые галерея не принимает) — через меню «Поделиться».
const ALBUM = 'Архив';
let androidAlbum = null;
async function albumId() {
  if (Capacitor.getPlatform() !== 'android') return undefined;
  if (androidAlbum) return androidAlbum;
  const { path } = await Media.getAlbumsPath();
  await Media.createAlbum({ name: ALBUM }).catch(() => {}); // уже есть — не ошибка
  androidAlbum = `${path}/${ALBUM}`;
  return androidAlbum;
}

function galleryKind(file) {
  const t = (file.type || '').split(';')[0];
  const ios = Capacitor.getPlatform() === 'ios';
  if (/^image\/(jpeg|png|heic|heif|gif|webp)$/.test(t)) return 'photo';
  if (t === 'video/mp4' || t === 'video/quicktime' || (!ios && t === 'video/webm')) return 'video';
  return null;
}

async function saveToGallery(files) {
  markExternal();
  await sweepTemp();
  const rest = [];
  let saved = 0;
  for (const f of files) {
    const kind = galleryKind(f);
    if (!kind) { rest.push(f); continue; }
    const tmp = await writeTemp(f);
    try {
      const opts = { path: tmp.uri, albumIdentifier: await albumId() };
      if (Capacitor.getPlatform() === 'android') opts.fileName = f.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') + '-' + Date.now();
      if (kind === 'photo') await Media.savePhoto(opts); else await Media.saveVideo(opts);
      saved += 1;
    } catch (e) {
      if (/denied|permission|access/i.test(e?.message || '')) {
        throw Object.assign(new Error('Нет доступа к галерее. Разрешите доступ в настройках телефона.'), { code: 'permission' });
      }
      rest.push(f); // галерея не приняла — предложим сохранить через «Поделиться»
    } finally {
      Filesystem.deleteFile({ path: tmp.path, directory: Directory.Cache }).catch(() => {});
    }
  }
  if (rest.length) saved += await shareFiles(rest);
  return saved;
}

export function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add('native', `native-${Capacitor.getPlatform()}`);

  window.ArchiveNative = {
    platform: Capacitor.getPlatform(),
    haptic(kind) {
      if (kind === 'selection') return Haptics.selectionChanged();
      if (kind === 'success') return Haptics.notification({ type: NotificationType.Success });
      if (kind === 'warning') return Haptics.notification({ type: NotificationType.Warning });
      if (kind === 'error') return Haptics.notification({ type: NotificationType.Error });
      return Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
    },
    saveToGallery,
    shareFiles,
    shareText: (title, text) => { markExternal(); return Share.share({ title, text }).catch(() => {}); },
    offerFile: (file) => shareFiles([file]).then((n) => n > 0),
    biometric: NativeBiometric,
    // Скрытие в переключателе приложений; на Android заодно запрещает снимки экрана.
    setPrivacy(on) {
      return (on ? PrivacyScreen.enable() : PrivacyScreen.disable()).catch(() => {});
    },
  };

  sweepTemp();

  // Кнопка «Назад» на Android: сначала закрываем окно поверх, затем возвращаемся по экранам.
  App.addListener('backButton', ({ canGoBack }) => {
    if (window.__archiveUi?.sheet) { window.__archiveUi.close(); return; }
    if (canGoBack) window.history.back();
    else App.minimizeApp();
  });
}
