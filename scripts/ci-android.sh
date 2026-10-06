#!/usr/bin/env bash
# Сборка APK для Android (используется в GitHub Actions, можно запустить и локально).
set -euo pipefail
npm install --no-audit --no-fund
npm run build
if [ ! -d android ]; then
  npx cap add android
  npx --yes @capacitor/assets@latest generate --android \
    --iconBackgroundColor '#07080c' --iconBackgroundColorDark '#07080c' \
    --splashBackgroundColor '#07080c' --splashBackgroundColorDark '#07080c'
fi
node scripts/native-setup.mjs
npx cap sync android
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon --stacktrace
cp app/build/outputs/apk/debug/app-debug.apk ../archive-android.apk
echo "APK: archive-android.apk"
