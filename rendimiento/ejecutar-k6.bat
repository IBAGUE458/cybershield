@echo off
cd /d "%~dp0.."
set ESC=%1
if "%ESC%"=="" set ESC=carga
node rendimiento\ejecutar.js k6 %ESC%
start "" rendimiento\resultados
pause
