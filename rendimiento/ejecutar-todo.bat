@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo Bateria completa de rendimiento (unos 30 minutos)...
echo Si JMeter no esta en el PATH, antes ejecuta: set JMETER_BIN=C:\jmeter\apache-jmeter-5.6.3\bin\jmeter.bat
node rendimiento\ejecutar.js todo %*
start "" rendimiento\resultados\INFORME-CONSOLIDADO.html
pause
