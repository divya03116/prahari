@echo off
rem PRAHARI - publishes the database security rules and the 60 query indexes to
rem the Firebase project prahari-2. Free: this needs no Blaze plan and no Storage.
rem Run it once, and again whenever firestore.rules or firestore.indexes.json change.
rem (deploy-backend.bat does this too, together with Storage and Cloud Functions.)
cd /d "%~dp0"
set TMP=E:\prahari-ml\tmp
set TEMP=E:\prahari-ml\tmp
title PRAHARI - publish database rules and indexes

call npx --no-install firebase login:list | findstr /C:"Logged in as" >nul
if errorlevel 1 (
  echo Sign in to Firebase: a browser page opens - choose your Google account and click Allow.
  call npx --no-install firebase login
  if errorlevel 1 goto fail
)
echo Publishing the security rules and the indexes...
call npx --no-install firebase deploy --only firestore:rules,firestore:indexes --project prahari-2 --force
if errorlevel 1 goto fail

echo.
echo Done. The indexes take a few minutes to build: until then some lists on the
echo site say the database is still preparing. Progress is shown at
echo https://console.firebase.google.com/project/prahari-2/firestore/indexes
pause
exit /b 0

:fail
echo.
echo It did not finish - see the messages above.
pause
exit /b 1
