@echo off
REM Double-click to start the BeautyPOS print bridge.
REM Leave this window open while the till is trading.
title BeautyPOS print bridge
cd /d "%~dp0"
node print-bridge.mjs
echo.
echo The bridge has stopped. Press any key to close.
pause >nul
