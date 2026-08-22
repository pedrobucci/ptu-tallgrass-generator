#!/usr/bin/env bash
set -euo pipefail

npm ci

if [[ ! -d src-tauri/gen/android ]]; then
  npm run tauri android init
fi

node scripts/configure-android-signing.mjs
npm run tauri android build -- --apk --target aarch64

mkdir -p artifacts
apk_path="$(find src-tauri/gen/android/app/build/outputs -type f -iname '*release*.apk' | sort | tail -n 1)"
if [[ -z "${apk_path}" ]]; then
  echo "O Gradle terminou sem produzir um APK release." >&2
  exit 1
fi
cp "${apk_path}" artifacts/PTU-Encounter-Generator-arm64-release.apk
echo "APK criado em artifacts/PTU-Encounter-Generator-arm64-release.apk"
