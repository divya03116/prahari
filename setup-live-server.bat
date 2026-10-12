@echo off
rem PRAHARI - finishes the live site's set-up. You run this yourself: it signs in
rem with your own Google account, and the server key goes straight from the file
rem you download to Vercel's settings. It is not shown, copied or kept anywhere else.
rem   1. publishes the database rules and the 60 indexes to prahari-2 (free)
rem   2. gives the Vercel server its key (FIREBASE_SERVICE_ACCOUNT)
rem   3. sets the first administrator's address (BOOTSTRAP_ADMIN_EMAIL)
rem   4. rebuilds the site and checks https://prahari-silk.vercel.app/api/health
setlocal
cd /d "%~dp0"
if exist "E:\prahari-ml\tmp" set TMP=E:\prahari-ml\tmp
if exist "E:\prahari-ml\tmp" set TEMP=E:\prahari-ml\tmp
if exist "E:\dev-cache\npm-cache" set npm_config_cache=E:\dev-cache\npm-cache
title PRAHARI - set up the live server

echo.
echo === Step 1 of 4: database rules and indexes ===
call npx --no-install firebase login:list | findstr /C:"Logged in as" >nul
if errorlevel 1 (
  echo A browser page opens - choose your Google account and click Allow.
  call npx --no-install firebase login
  if errorlevel 1 goto fail
)
call npx --no-install firebase deploy --only firestore:rules,firestore:indexes --project prahari-2 --force
if errorlevel 1 goto fail

echo.
echo === Step 2 of 4: the server key ===
echo A Firebase page opens. Press "Generate new private key", then "Generate key".
echo A .json file is saved to your Downloads folder.
start "" "https://console.firebase.google.com/project/prahari-2/settings/serviceaccounts/adminsdk"
echo.
echo When it has downloaded, drag that file into this window and press Enter.
set "KEY="
set /p "KEY=Key file: "
set "KEY=%KEY:"=%"
if not exist "%KEY%" (
  echo That file was not found.
  goto fail
)
findstr /C:"private_key" "%KEY%" >nul
if errorlevel 1 (
  echo That is not a service-account key file.
  goto fail
)
call npx --yes vercel@59 env rm FIREBASE_SERVICE_ACCOUNT production --yes >nul 2>nul
call npx --yes vercel@59 env add FIREBASE_SERVICE_ACCOUNT production --sensitive < "%KEY%"
if errorlevel 1 goto fail

echo.
echo === Step 3 of 4: the first administrator ===
set "ADMIN="
set /p "ADMIN=The email address you sign in to PRAHARI with: "
if "%ADMIN%"=="" goto fail
call npx --yes vercel@59 env rm BOOTSTRAP_ADMIN_EMAIL production --yes >nul 2>nul
echo|set /p="%ADMIN%"| call npx --yes vercel@59 env add BOOTSTRAP_ADMIN_EMAIL production
if errorlevel 1 goto fail

echo.
echo === Step 4 of 4: rebuilding the site (about two minutes) ===
call npx --yes vercel@59 redeploy prahari-silk.vercel.app --target production
if errorlevel 1 goto fail
echo.
echo The server now says:
curl -s https://prahari-silk.vercel.app/api/health
echo.
echo.
echo The key is in Vercel now, so the downloaded file is no longer needed.
choice /C YN /M "Delete the downloaded key file"
if not errorlevel 2 del "%KEY%"

echo.
echo Done. If the line above says {"ok":true}: sign in on the site with %ADMIN%, then open
echo https://prahari-silk.vercel.app/app/settings?setup=admin and press "Become the first administrator".
echo (The indexes take a few minutes to build; until then some lists say the database is still preparing.)
pause
exit /b 0

:fail
echo.
echo It did not finish - see the messages above. Nothing is broken; you can run this again.
pause
exit /b 1
