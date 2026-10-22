@echo off
REM ═══════════════════════════════════════════════════════════════
REM  Opens BeautyPOS across both HK718 screens.
REM
REM    Screen 1 (14" operator) -> the till
REM    Screen 2 (10" front)    -> the customer display
REM
REM  BOTH WINDOWS MUST SHARE ONE CHROME PROFILE.
REM  They talk over BroadcastChannel, which is scoped to origin AND
REM  browser profile. Give them separate --user-data-dir values and
REM  they become two unrelated browsers: the customer screen then
REM  shows "Welcome" forever and nothing explains why.
REM
REM  MAIN_WIDTH is the PIXEL WIDTH of the main screen — Windows lays
REM  the second monitor out to its right. If the customer window
REM  opens on top of the till, this number is wrong. Check it in
REM  Settings > System > Display > Advanced display.
REM ═══════════════════════════════════════════════════════════════

set POS_URL=https://thipe-pos.vercel.app
set MAIN_WIDTH=1366
set CFD_WIDTH=1024
set CFD_HEIGHT=600

set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" (
  echo Chrome not found. Install Chrome, or edit CHROME in this file.
  pause
  exit /b 1
)

set PROFILE=%LOCALAPPDATA%\BeautyPOS\chrome

REM The till first: it owns the basket and answers the display's
REM "hello" on startup. Opening it second is harmless — the display
REM asks again on every state change — but this way the customer
REM screen is populated from the moment it appears.
start "" "%CHROME%" --app=%POS_URL% ^
  --user-data-dir="%PROFILE%" ^
  --window-position=0,0 --start-fullscreen ^
  --no-first-run --no-default-browser-check --disable-features=TranslateUI

timeout /t 3 /nobreak >nul

REM No --kiosk here: kiosk forces the window onto the primary display
REM and ignores --window-position, which puts the customer screen on
REM top of the till. Explicit geometry is what actually lands it on
REM the second monitor.
start "" "%CHROME%" --app=%POS_URL%/customer ^
  --user-data-dir="%PROFILE%" ^
  --window-position=%MAIN_WIDTH%,0 ^
  --window-size=%CFD_WIDTH%,%CFD_HEIGHT% ^
  --no-first-run --no-default-browser-check --disable-features=TranslateUI --disable-pinch

REM If the customer window is not quite full-screen on the 10" panel,
REM click it once and press F11.
