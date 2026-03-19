@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Open-Cowork-Legacy-Cleanup.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%OPEN_COWORK_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
