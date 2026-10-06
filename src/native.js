// Связка с установленным приложением (Capacitor) для iPhone и Android.
// В браузере ничего не делает: всё работает через веб-возможности.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { markExternal } from './lib/external.js';

async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// Файлы кладутся во временную папку приложения и отдаются системному меню «Поделиться»
// (там же «Сохранить изображение», «Сохранить в Файлы»). После этого временные копии удаляются.
async function shareFiles(files) {
  markExternal();
  const written = [];
  try {
    for (const f of files) {
      const path = `share/${Date.now()}-${f.name.replace(/[\\/:*?"<>|]/g, '_')}`;
      const res = await Filesystem.writeFile({ path, data: await toBase64(f), directory: Directory.Cache, recursive: true });
      written.push({ path, uri: res.uri });
    }
    await Share.share({ files: written.map((w) => w.uri), dialogTitle: 'Сохранить или отправить' });
    return files.length;
  } catch (e) {
    if (/cancel/i.test(e?.message || '')) return 0;
    throw e;
  } finally {
    setTimeout(() => written.forEach((w) => Filesystem.deleteFile({ path: w.path, directory: Directory.Cache }).catch(() => {})), 60000);
  }
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
    saveToGallery: shareFiles,
    shareText: (title, text) => { markExternal(); return Share.share({ title, text }).catch(() => {}); },
    offerFile: (file) => shareFiles([file]).then((n) => n > 0),
    biometric: NativeBiometric,
    // Скрытие в переключателе приложений; на Android заодно запрещает снимки экрана.
    setPrivacy(on) {
      return (on ? PrivacyScreen.enable() : PrivacyScreen.disable()).catch(() => {});
    },
  };

  // Кнопка «Назад» на Android: сначала закрываем окно поверх, затем возвращаемся по экранам.
  App.addListener('backButton', ({ canGoBack }) => {
    if (window.__archiveUi?.sheet) { window.__archiveUi.close(); return; }
    if (canGoBack) window.history.back();
    else App.minimizeApp();
  });
}
