// Настройка нативных проектов после `npx cap add`: разрешения, ориентация, тёмная тема.
// Безопасно запускать повторно.
import fs from 'fs';

const IOS_PLIST = 'ios/App/App/Info.plist';
const ANDROID_MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const ANDROID_STRINGS = 'android/app/src/main/res/values/strings.xml';
const ANDROID_STYLES = 'android/app/src/main/res/values/styles.xml';

const ANDROID_GRADLE = 'android/app/build.gradle';

// Номер версии — из package.json; номер сборки растёт с каждой версией и каждой сборкой в GitHub Actions,
// поэтому новая версия всегда ставится поверх старой.
const VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const [maj, min, pat] = VERSION.split('.').map((n) => parseInt(n, 10) || 0);
const BUILD = (maj * 10000 + min * 100 + pat) * 1000 + ((parseInt(process.env.GITHUB_RUN_NUMBER, 10) || 0) % 1000);

const IOS_KEYS = {
  NSCameraUsageDescription: 'Камера нужна, чтобы сделать фото или видео прямо в архив.',
  NSMicrophoneUsageDescription: 'Микрофон нужен для записи голосовых и звука в видео.',
  NSPhotoLibraryUsageDescription: 'Доступ к фото нужен, чтобы добавить снимки и видео из галереи в архив.',
  NSPhotoLibraryAddUsageDescription: 'Доступ нужен, чтобы сохранить выбранные материалы из архива в галерею.',
  NSFaceIDUsageDescription: 'Face ID используется для входа в архив вместо кода.',
};

function patchPlist() {
  if (!fs.existsSync(IOS_PLIST)) return console.log('iOS: проект не найден, пропуск');
  let s = fs.readFileSync(IOS_PLIST, 'utf8');
  const set = (key, xml) => {
    const re = new RegExp(`\\s*<key>${key}</key>\\s*(<string>[^<]*</string>|<array>[\\s\\S]*?</array>|<true/>|<false/>)`);
    s = s.replace(re, '');
    s = s.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t${xml}\n</dict>\n</plist>\n`);
  };
  for (const [k, v] of Object.entries(IOS_KEYS)) set(k, `<string>${v}</string>`);
  set('CFBundleDisplayName', '<string>Архив</string>');
  set('UIUserInterfaceStyle', '<string>Dark</string>');
  set('UIStatusBarStyle', '<string>UIStatusBarStyleLightContent</string>');
  set('UISupportedInterfaceOrientations', '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>');
  set('ITSAppUsesNonExemptEncryption', '<false/>');
  set('CFBundleShortVersionString', `<string>${VERSION}</string>`);
  set('CFBundleVersion', `<string>${BUILD}</string>`);
  fs.writeFileSync(IOS_PLIST, s);
  console.log('iOS: Info.plist настроен');
}

function patchAndroid() {
  if (!fs.existsSync(ANDROID_MANIFEST)) return console.log('Android: проект не найден, пропуск');
  let m = fs.readFileSync(ANDROID_MANIFEST, 'utf8');
  const perms = ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.USE_BIOMETRIC'];
  for (const p of perms) {
    if (!m.includes(`"${p}"`)) m = m.replace(/(\s*<\/manifest>)/, `\n    <uses-permission android:name="${p}" />$1`);
  }
  // Сохранение в галерею на старых Android (9 и ниже); на новых разрешение не нужно.
  if (!m.includes('"android.permission.WRITE_EXTERNAL_STORAGE"')) {
    m = m.replace(/(\s*<\/manifest>)/, '\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />$1');
  }
  if (!m.includes('android.hardware.camera')) {
    m = m.replace(/(\s*<\/manifest>)/, '\n    <uses-feature android:name="android.hardware.camera" android:required="false" />$1');
  }
  if (!m.includes('android:screenOrientation')) m = m.replace(/<activity\b/, '<activity\n            android:screenOrientation="portrait"');
  if (!m.includes('android:allowBackup')) m = m.replace(/<application\b/, '<application\n        android:allowBackup="false"');
  else m = m.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
  fs.writeFileSync(ANDROID_MANIFEST, m);

  if (fs.existsSync(ANDROID_STRINGS)) {
    let st = fs.readFileSync(ANDROID_STRINGS, 'utf8');
    st = st.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Архив</string>')
      .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">Архив</string>');
    fs.writeFileSync(ANDROID_STRINGS, st);
  }
  if (fs.existsSync(ANDROID_STYLES)) {
    let sy = fs.readFileSync(ANDROID_STYLES, 'utf8');
    if (!sy.includes('android:windowBackground">#07080c')) {
      sy = sy.replace(/(<style name="AppTheme\.NoActionBar"[^>]*>)/, '$1\n        <item name="android:windowBackground">#07080c</item>\n        <item name="android:statusBarColor">#07080c</item>\n        <item name="android:navigationBarColor">#07080c</item>');
    }
    fs.writeFileSync(ANDROID_STYLES, sy);
  }
  if (fs.existsSync(ANDROID_GRADLE)) {
    let g = fs.readFileSync(ANDROID_GRADLE, 'utf8');
    g = g.replace(/versionCode\s+\d+/, `versionCode ${BUILD}`).replace(/versionName\s+"[^"]*"/, `versionName "${VERSION}"`);
    fs.writeFileSync(ANDROID_GRADLE, g);
  }
  console.log(`Android: манифест и тема настроены, версия ${VERSION} (${BUILD})`);
}

patchPlist();
patchAndroid();
