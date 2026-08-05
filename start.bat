@echo off
rem ============================================================
rem  Kiwoom Quote Terminal - launcher for Windows
rem
rem  ASCII ONLY on purpose. cmd.exe parses .bat files using the
rem  OEM codepage (949 on Korean Windows), so UTF-8 Korean text
rem  inside a .bat corrupts the line structure and the script
rem  breaks apart. Do not add non-ASCII characters to this file.
rem  Line endings must stay CRLF.
rem ============================================================
setlocal
cd /d "%~dp0"

echo ============================================
echo   Kiwoom Quote Terminal
echo ============================================
echo   First time here? Read START-HERE.md
echo   Demo mode - no API key needed.
echo ============================================
echo.

rem --- locate the project root ------------------------------
rem Windows "Extract All" often adds one extra nesting level,
rem e.g. kiwoom-quote-web\kiwoom-quote-web\. Step into it.
if not exist "web\package.json" (
    for /d %%d in (*) do if exist "%%d\web\package.json" (
        echo Project found inside "%%d", switching folder...
        cd /d "%~dp0%%d"
    )
)

if not exist "web\package.json" goto :nofolder
if not exist "server\package.json" goto :nofolder

rem Everything below uses ROOT, not %~dp0, because we may have moved.
set "ROOT=%CD%"
echo Project folder: %ROOT%

rem --- Node.js present? -------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :nonode
for /f "delims=" %%v in ('node -v') do echo Node %%v

rem --- first run: create .env -------------------------------
if not exist "%ROOT%\server\.env" (
    copy /y "%ROOT%\.env.example" "%ROOT%\server\.env" >nul
    echo Created server\.env  - starting in DEMO mode, no API key needed.
)

rem --- install dependencies ---------------------------------
if not exist "%ROOT%\server\node_modules" (
    echo.
    echo Installing server packages, please wait...
    pushd "%ROOT%\server"
    call npm install
    popd
    if not exist "%ROOT%\server\node_modules" goto :installfail
)

if not exist "%ROOT%\web\node_modules" (
    echo.
    echo Installing web packages, please wait...
    pushd "%ROOT%\web"
    call npm install
    popd
    if not exist "%ROOT%\web\node_modules" goto :installfail
)

rem --- backend in its own window ----------------------------
rem "npm run dev" runs node --watch, so editing files under
rem server\src restarts the backend automatically. With plain
rem "npm start" the old code stays in memory after an update.
echo.
echo Starting backend in a new window (auto-reload on file change)...
start "Kiwoom Backend" /d "%ROOT%\server" cmd /k npm run dev

echo Waiting for backend to come up...
timeout /t 5 /nobreak >nul

echo.
echo Opening browser at http://localhost:5173
echo To stop: close this window AND the "Kiwoom Backend" window.
echo After replacing source files, close both windows and re-run this script.
echo.

cd /d "%ROOT%\web"
call npm run dev
goto :end

:nofolder
echo [ERROR] Could not find web\package.json and server\package.json.
echo.
echo         start.bat must sit in the SAME folder as the
echo         "web" and "server" folders. Current folder:
echo         %CD%
echo.
echo         Open that folder in Explorer. If you do not see
echo         "web" and "server" there, extract the zip again
echo         and run start.bat from inside the extracted folder.
goto :end

:nonode
echo [ERROR] Node.js not found.
echo         Install the LTS version from https://nodejs.org
echo         then close this window and run start.bat again.
goto :end

:installfail
echo [ERROR] npm install failed. Scroll up to read the npm error.
echo         Common causes: no internet, or a corporate proxy.
goto :end

:end
echo.
pause
