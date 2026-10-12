@echo off
rem PRAHARI - lets phones use the AI running on THIS computer (fast, no account).
rem Starts the AI service if needed, gives it a secure web address through a
rem Cloudflare quick tunnel, points the website at it and rebuilds the site.
rem Keep this window open while phones use live monitoring or photo checks.
rem For an always-on service that does not need this computer: publish-ai.bat.
cd /d "%~dp0"
if exist "E:\prahari-ml\tmp" set TMP=E:\prahari-ml\tmp
if exist "E:\prahari-ml\tmp" set TEMP=E:\prahari-ml\tmp
if exist "E:\dev-cache\npm-cache" set npm_config_cache=E:\dev-cache\npm-cache
title PRAHARI - AI for phones - keep this window open

"%SystemRoot%\System32\curl.exe" -s -o nul http://127.0.0.1:8765/v1/health >nul 2>nul
if errorlevel 1 (
  echo Starting the AI service in its own window...
  start "" "%~dp0start-ai.bat"
  echo Waiting for it to load its models - up to a minute...
)
:wait
"%SystemRoot%\System32\curl.exe" -s -o nul http://127.0.0.1:8765/v1/health >nul 2>nul
if errorlevel 1 (
  ping -n 3 127.0.0.1 >nul
  goto wait
)
node scripts\phone-ai.mjs
pause
