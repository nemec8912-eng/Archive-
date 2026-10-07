#!/usr/bin/env bash
# Сборка APK для Android (используется в GitHub Actions, можно запустить и локально).
# Если задан ANDROID_SIGNING («пароль:ключ в base64», секрет репозитория) — выпускная сборка,
# подписанная постоянным ключом: новые версии ставятся поверх старых, данные сохраняются.
# Без него — тестовая сборка с ключом отладки (каждая сборка подписана по-новому).
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

if [ -n "${ANDROID_SIGNING:-}" ]; then
  KS="${RUNNER_TEMP:-/tmp}/archive-signing.p12"
  export KS_PASS="${ANDROID_SIGNING%%:*}"
  printf '%s' "${ANDROID_SIGNING#*:}" | tr -d ' \n\r' | base64 -d > "$KS"
  ./gradlew assembleRelease --no-daemon --stacktrace
  BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
  "$BT/zipalign" -p -f 4 app/build/outputs/apk/release/app-release-unsigned.apk app-aligned.apk
  "$BT/apksigner" sign --ks "$KS" --ks-pass env:KS_PASS --ks-key-alias archive --out ../archive-android.apk app-aligned.apk
  "$BT/apksigner" verify --print-certs ../archive-android.apk | grep -i "SHA-256" | head -1
  rm -f "$KS"
  echo "APK: archive-android.apk (выпускная, постоянный ключ)"
  echo "release" > ../archive-android.kind
else
  ./gradlew assembleDebug --no-daemon --stacktrace
  cp app/build/outputs/apk/debug/app-debug.apk ../archive-android.apk
  echo "APK: archive-android.apk (тестовая, ключ отладки — секрет ANDROID_SIGNING не задан)"
  echo "debug" > ../archive-android.kind
fi
