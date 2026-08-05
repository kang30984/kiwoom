@echo off
rem ============================================================
rem  Diagnostic - answers "is the new code actually installed
rem  and running?"  ASCII only (see start.bat for why).
rem ============================================================
setlocal
cd /d "%~dp0"

echo ============================================
echo   Install check
echo ============================================
echo.
echo Folder: %CD%
echo.

echo [1] Nested folder?
set "NESTED="
for /d %%d in (*) do if exist "%%d\web\package.json" set "NESTED=%%d"
if defined NESTED (
    echo     PROBLEM - a full copy sits inside "%NESTED%"
    echo     Move everything inside %NESTED%\ up one level,
    echo     replacing files, then delete %NESTED%.
) else (
    echo     OK - no nested copy
)
echo.

echo [2] New files present?
if exist "server\src\krx.js" (echo     OK   server\src\krx.js) else (echo     MISSING  server\src\krx.js)
if exist "server\src\analysis.js" (echo     OK   server\src\analysis.js) else (echo     MISSING  server\src\analysis.js)
if exist "server\src\routes\plan.js" (echo     OK   server\src\routes\plan.js) else (echo     MISSING  server\src\routes\plan.js)
if exist "web\src\components\TradePlan.jsx" (echo     OK   web\src\components\TradePlan.jsx) else (echo     MISSING  web\src\components\TradePlan.jsx)
echo.

echo [3] Price-limit fix inside demoFeed.js?
findstr /m /C:"priceLimits" "server\src\demoFeed.js" >nul 2>nul
if errorlevel 1 (
    echo     PROBLEM - old demoFeed.js. Overwrite did not take.
) else (
    echo     OK - price limits applied
)
echo.

echo [4] Version marker in config.js?
findstr /C:"APP_VERSION" "server\src\config.js" 2>nul
if errorlevel 1 echo     PROBLEM - old config.js
echo.

echo [5] Node processes still running?
tasklist /fi "imagename eq node.exe" 2>nul | findstr /i node.exe >nul
if errorlevel 1 (
    echo     None running - safe to start
) else (
    echo     node.exe IS running. If you just replaced files,
    echo     close the backend window or run:  taskkill /f /im node.exe
)
echo.

echo [6] What the running server reports
curl -s http://localhost:4000/api/health 2>nul
if errorlevel 1 echo     Backend not responding on port 4000 ^(not started^)
echo.
echo     Expect: "version":"3-atr-limits"
echo     If it says something else or nothing, the running
echo     process is stale - restart it.
echo.

echo ============================================
pause
