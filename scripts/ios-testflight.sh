#!/usr/bin/env bash
# Сборка для iPhone и отправка в TestFlight (GitHub Actions → «Отправить в TestFlight», запуск вручную).
# Нужны: платный аккаунт Apple Developer, приложение с идентификатором com.nemec8912.archive в App Store Connect
# и секреты репозитория (см. README): APPLE_TEAM_ID, ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (файл .p8 в base64).
set -euo pipefail
for v in APPLE_TEAM_ID ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8; do
  if [ -z "${!v:-}" ]; then echo "Не задан секрет $v — см. README, раздел «TestFlight»"; exit 1; fi
done

npm install --no-audit --no-fund
npm run build
if [ ! -d ios ]; then
  npx cap add ios
  npx --yes @capacitor/assets@latest generate --ios \
    --iconBackgroundColor '#07080c' --splashBackgroundColor '#07080c' --splashBackgroundColorDark '#07080c'
fi
node scripts/native-setup.mjs
npx cap sync ios

WORK="${RUNNER_TEMP:-/tmp}/testflight"
mkdir -p "$WORK"
KEY="$WORK/AuthKey_${ASC_KEY_ID}.p8"
printf '%s' "$ASC_KEY_P8" | tr -d ' \n\r' | base64 -d > "$KEY"
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$WORK/App.xcarchive" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic \
  "${AUTH[@]}" archive | tail -n 40

cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${APPLE_TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

xcodebuild -exportArchive -archivePath "$WORK/App.xcarchive" -exportOptionsPlist "$WORK/ExportOptions.plist" \
  -exportPath "$WORK/export" "${AUTH[@]}" | tail -n 40
rm -f "$KEY"
echo "Сборка отправлена в App Store Connect; в TestFlight появится после обработки Apple (обычно 10–30 минут)."
