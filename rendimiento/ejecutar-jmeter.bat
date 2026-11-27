@echo off
cd /d "%~dp0.."
node rendimiento\ejecutar.js jmeter %1 %2 %3
start "" rendimiento\resultados
pause
