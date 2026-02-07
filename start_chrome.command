#!/bin/bash

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
USER_DATA_DIR="$(cd "$(dirname "$0")"; pwd)/ChromeDebug"

"$CHROME" \
  --remote-debugging-port=9222 \
  --user-data-dir="$USER_DATA_DIR" \
  --disable-popup-blocking \
  --no-first-run \
  --no-default-browser-check &

echo ""
echo "=========================================="
echo "Chrome 실행됨"
echo "1. 로그인"
echo "2. 예매 페이지 진입"
echo "3. 그대로 두세요 (자동 클릭 대기)"
echo "=========================================="
read
