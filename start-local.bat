@echo off
rem ==========================================================================
rem  PRAHARI - one-click local start (Windows).
rem  Starts the Firebase emulators and the website in their own windows,
rem  loads demo data the first time, and opens the site in your browser.
rem  Close the two server windows to stop everything.
rem ==========================================================================
setlocal
title PRAHARI launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org and run this again.
  goto :fail
)
where java >nul 2>nul
if errorlevel 1 (
  echo Java 21 or newer is required by the Firebase emulators. Install it, then run this again.
  goto :fail
)

rem --- Already running? Just open the browser. -------------------------------
"%SystemRoot%\System32\curl.exe" -s -o nul http://127.0.0.1:5173/ >nul 2>nul
if not errorlevel 1 (
  node --no-deprecation scripts\wait-for-emulators.mjs --once >nul 2>nul
  if not errorlevel 1 (
    echo PRAHARI is already running.
    call :startai
    if not defined PRAHARI_NO_BROWSER start "" http://127.0.0.1:5173/signin
    goto :done
  )
)

rem --- First run: install packages and create the local settings file. -------
if not exist node_modules (
  echo Installing website packages - first run only, this takes a few minutes...
  call npm install
  if errorlevel 1 goto :fail
)
if not exist functions\node_modules (
  echo Installing server packages - first run only...
  call npm --prefix functions install
  if errorlevel 1 goto :fail
)
if not exist .env (
  echo Creating .env for the local emulators...
  > .env echo VITE_FIREBASE_API_KEY=demo-key
  >> .env echo VITE_FIREBASE_AUTH_DOMAIN=demo-prahari.firebaseapp.com
  >> .env echo VITE_FIREBASE_PROJECT_ID=demo-prahari
  >> .env echo VITE_FIREBASE_STORAGE_BUCKET=demo-prahari.appspot.com
  >> .env echo VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
  >> .env echo VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000
  >> .env echo VITE_FUNCTIONS_REGION=asia-south1
  >> .env echo VITE_USE_EMULATORS=true
  >> .env echo VITE_PPE_INFERENCE_URL=http://127.0.0.1:8765
)

rem --- Backend -------------------------------------------------------------
node --no-deprecation scripts\wait-for-emulators.mjs --once >nul 2>nul
if errorlevel 1 (
  echo Starting the Firebase emulators in a new window...
  start "PRAHARI backend - keep this window open" cmd /k "set FUNCTIONS_DISCOVERY_TIMEOUT=90&& npm run emulators"
)
node --no-deprecation scripts\wait-for-emulators.mjs
if errorlevel 1 goto :fail
node --no-deprecation scripts\seed.mjs --if-empty
if errorlevel 1 goto :fail

rem --- PPE inference service --------------------------------------------------
call :startai

rem --- Website -------------------------------------------------------------
"%SystemRoot%\System32\curl.exe" -s -o nul http://127.0.0.1:5173/ >nul 2>nul
if errorlevel 1 (
  echo Starting the website in a new window...
  start "PRAHARI website - keep this window open" cmd /k "npm run dev"
)
set /a tries=0
:waitweb
"%SystemRoot%\System32\curl.exe" -s -o nul http://127.0.0.1:5173/ >nul 2>nul
if not errorlevel 1 goto :open
set /a tries+=1
if %tries% geq 90 (
  echo The website did not start. Check the "PRAHARI website" window for errors.
  goto :fail
)
"%SystemRoot%\System32\timeout.exe" /t 1 /nobreak >nul
goto :waitweb

:open
if not defined PRAHARI_NO_BROWSER start "" http://127.0.0.1:5173/signin
echo.
echo  PRAHARI is running at http://127.0.0.1:5173
echo  Sign in with admin@prahari.test / Prahari-demo-1
echo  (also officer@, manager@ and reviewer@prahari.test, same password)
echo.
echo  To stop: close the "PRAHARI backend", "PRAHARI website" and "PRAHARI AI inference" windows.
echo  Note: the local database starts fresh each time the backend restarts.

:done
echo.
pause
exit /b 0

:fail
echo.
echo Something went wrong - see the messages above.
pause
exit /b 1

rem --- Starts the PPE inference service if its Python environment exists
rem     (see ai\README.md) and it is not already running.
:startai
if not exist "E:\prahari-ml\venv\Scripts\python.exe" (
  echo Note: AI inference environment not found - live PPE monitoring will show "AI Model Not Configured".
  exit /b 0
)
"%SystemRoot%\System32\curl.exe" -s -o nul http://127.0.0.1:8765/v1/health >nul 2>nul
if not errorlevel 1 exit /b 0
echo Starting the PPE inference service in a new window...
rem CPU keeps memory use low on this laptop; set PPE_DEVICE=0 to use the GPU.
start "PRAHARI AI inference - keep this window open" cmd /k "set PPE_DEVICE=cpu&& set PPE_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173,https://prahari-silk.vercel.app&& "E:\prahari-ml\venv\Scripts\python.exe" ai\inference_service\server.py"
exit /b 0
