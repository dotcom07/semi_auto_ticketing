@echo off
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
set USER_DATA_DIR=%~dp0ChromeDebug

%CHROME_PATH% ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USER_DATA_DIR%" ^
  --disable-popup-blocking ^
  --no-first-run ^
  --no-default-browser-check

echo.
echo ==========================================
echo Chrome 실행됨
echo 1. 로그인
echo 2. 예매 페이지 진입
echo 3. 그대로 두세요 (자동 클릭 대기)
echo ==========================================
pause
