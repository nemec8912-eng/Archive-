#!/usr/bin/env bash
# Проверочная сборка для iPhone (симулятор, без подписи). Для установки на телефон — Xcode, см. README.
set -euo pipefail
npm install --no-audit --no-fund
npm run build
if [ ! -d ios ]; then
  npx cap add ios
  npx --yes @capacitor/assets@latest generate --ios \
    --iconBackgroundColor '#07080c' --splashBackgroundColor '#07080c' --splashBackgroundColorDark '#07080c'
fi
node scripts/native-setup.mjs
npx cap sync ios
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build | tail -n 60
echo "iOS: сборка для симулятора прошла"
