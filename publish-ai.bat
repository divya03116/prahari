@echo off
rem PRAHARI - puts the AI models online as a Hugging Face Space, so live monitoring
rem and photo reports work on phones and other computers, without this laptop.
rem The Space is public: its model files can be downloaded by anyone.
cd /d "%~dp0"
set PY=E:\prahari-ml\venv\Scripts\python.exe
set HF=E:\prahari-ml\venv\Scripts\hf.exe
set TMP=E:\prahari-ml\tmp
set TEMP=E:\prahari-ml\tmp
title PRAHARI - publish the AI service

"%HF%" auth whoami >nul 2>nul
if errorlevel 1 (
  echo Sign in to Hugging Face. Create a Write token at
  echo   https://huggingface.co/settings/tokens/new?tokenType=write
  echo and paste it below - it stays invisible while you paste. Answer "n" to the git question.
  "%HF%" auth login
  if errorlevel 1 goto fail
)
"%PY%" ai\space\stage.py
if errorlevel 1 goto fail
"%PY%" ai\space\publish.py
if errorlevel 1 goto fail
pause
exit /b 0

:fail
echo.
echo The AI service was not published - see the messages above.
pause
exit /b 1
