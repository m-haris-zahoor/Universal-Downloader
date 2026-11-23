#!/bin/sh
# Converts ./extension into a Safari extension Xcode project (requires full Xcode, not just Command Line Tools).
set -e
cd "$(dirname "$0")/.."
xcrun safari-web-extension-converter extension --app-name "Universal Downloader Safari" --bundle-identifier com.universaldownloader.safari --macos-only --project-location safari
echo "Open safari/Universal Downloader Safari/*.xcodeproj in Xcode, press Run, then enable the extension in Safari > Settings > Extensions."
