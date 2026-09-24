@echo off
rem PRAHARI - starts only the AI inference service, for the hosted website
rem (https://prahari-silk.vercel.app) opened in THIS computer's browser.
rem Keep the window open while you use live monitoring or photo reports.
rem Phones and other computers need the hosted AI service (ai\space\README.md).
cd /d "%~dp0"
if not exist "E:\prahari-ml\venv\Scripts\python.exe" (
  echo The AI environment E:\prahari-ml\venv was not found - see ai\README.md.
  pause
  exit /b 1
)
"%SystemRoot%\System32\curl.exe" -s -o nul http://127.0.0.1:8765/v1/health >nul 2>nul
if not errorlevel 1 (
  echo The PRAHARI AI service is already running on http://127.0.0.1:8765.
  ping -n 5 127.0.0.1 >nul
  exit /b 0
)
title PRAHARI AI inference - keep this window open
rem CPU keeps memory use low on this laptop; set PPE_DEVICE=0 to use the GPU.
set PPE_DEVICE=cpu
set PPE_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173,https://prahari-silk.vercel.app
set YOLO_CONFIG_DIR=E:\prahari-ml\tmp\Ultralytics
set TMP=E:\prahari-ml\tmp
set TEMP=E:\prahari-ml\tmp
echo Starting the PRAHARI AI service on http://127.0.0.1:8765 - the website finds it by itself.
"E:\prahari-ml\venv\Scripts\python.exe" ai\inference_service\server.py
pause
