@echo off
rem PRAHARI - deploys the backend to the Firebase project prahari-2:
rem security rules, database indexes, file-storage rules and the server functions.
rem Before the first run, in the Firebase console (https://console.firebase.google.com/project/prahari-2):
rem   1. Upgrade the project to the Blaze plan (bottom-left "Upgrade").
rem   2. Open Storage and press "Get started" once (location: us-central1).
cd /d "%~dp0"
set TMP=E:\prahari-ml\tmp
set TEMP=E:\prahari-ml\tmp
title PRAHARI - deploy backend to Firebase

call npx --no-install firebase login:list | findstr /C:"Logged in as" >nul
if errorlevel 1 (
  echo Sign in to Firebase: a browser page opens - choose your Google account and click Allow.
  call npx --no-install firebase login
  if errorlevel 1 goto fail
)
if not exist "functions\node_modules" (
  call npm --prefix functions install
  if errorlevel 1 goto fail
)
call npm run sync
if errorlevel 1 goto fail
echo Deploying security rules, indexes, storage rules and server functions (5-10 minutes the first time)...
call npx --no-install firebase deploy --only firestore:rules,firestore:indexes,storage,functions --project prahari-2 --force
if errorlevel 1 goto fail

echo.
echo Backend deployed.
echo Next: sign in on https://prahari-silk.vercel.app with the administrator address set in functions\.env.prahari-2, then open
echo https://prahari-silk.vercel.app/app/settings?setup=admin and press "Become the first administrator".
pause
exit /b 0

:fail
echo.
echo The deploy did not finish - see the messages above. The usual causes:
echo   - the project is not on the Blaze plan yet (Firebase console, bottom-left "Upgrade");
echo   - Storage was never opened once (Firebase console, Storage, "Get started").
pause
exit /b 1
