@echo off
cd /d "%~dp0"
echo Instalando dependencias (solo la primera vez)...
call npm install
call npx playwright install chromium
echo Ejecutando las 27 pruebas...
call npm test
pause
