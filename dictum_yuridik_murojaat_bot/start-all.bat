@echo off
echo Starting Dictum Legal Bot System...
echo.

start "Dictum Bot" cmd /k "cd /d C:\Users\User\dictum_yuridik_murojaat_bot && node src\bot\bot.js"

timeout /t 3 /nobreak >nul

start "Dictum Dashboard" cmd /k "cd /d C:\Users\User\dictum_yuridik_murojaat_bot && node src\api\server.js"

echo.
echo Both services started!
echo Close this window if you want.
pause