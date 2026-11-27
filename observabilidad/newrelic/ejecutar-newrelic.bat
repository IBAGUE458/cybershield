@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
echo ==================================================
echo   CyberShield - Prueba con New Relic (OpenTelemetry)
echo ==================================================
where node >nul 2>nul || (echo. & echo ERROR: Node.js no esta instalado. Instalalo con:  winget install OpenJS.NodeJS.LTS  o desde https://nodejs.org & echo Despues cierra esta ventana, abre una nueva y vuelve a ejecutar este archivo. & pause & exit /b 1)
if "%NEW_RELIC_LICENSE_KEY%"=="" set /p NEW_RELIC_LICENSE_KEY=Pega tu License key de New Relic (INGEST - LICENSE): 
if "%NEW_RELIC_LICENSE_KEY%"=="" (echo No se indico la clave. & pause & exit /b 1)
if "%NEW_RELIC_REGION%"=="" set NEW_RELIC_REGION=US
if not exist node_modules\@opentelemetry\sdk-node (echo Instalando dependencias... & call npm install)
set ESC=%1
if "%ESC%"=="" set ESC=carga
where k6 >nul 2>nul
if errorlevel 1 (
  echo k6 no esta instalado: se arranca solo el servidor con telemetria. Juega en http://127.0.0.1:8080 y pulsa Ctrl+C al terminar.
  node -r ./observabilidad/newrelic/telemetria.js servidor.js 8080
) else (
  echo Lanzando la prueba de carga k6 "%ESC%" con telemetria hacia New Relic...
  node -r ./observabilidad/newrelic/telemetria.js rendimiento\ejecutar.js k6 %ESC%
)
echo.
echo Abre https://one.newrelic.com  ^>  APM ^& Services  ^>  cybershield
pause
