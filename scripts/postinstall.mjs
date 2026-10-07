// Исправления сторонних плагинов после установки зависимостей.
// @capacitor-community/media 7.0.x для Android вызывает call.success(), которого нет в Capacitor 7,
// из-за чего сборка APK падает. Меняем на call.resolve() — поведение то же.
import fs from 'fs';

const MEDIA = 'node_modules/@capacitor-community/media/android/src/main/java/com/getcapacitor/community/media/MediaPlugin.java';
if (fs.existsSync(MEDIA)) {
  const src = fs.readFileSync(MEDIA, 'utf8');
  const fixed = src.replace(/\bcall\.success\(\)/g, 'call.resolve()');
  if (fixed !== src) {
    fs.writeFileSync(MEDIA, fixed);
    console.log('media: исправлен вызов call.success() для Capacitor 7');
  }
}
