@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================
echo   CyberShield - Analisis de seguridad con Snyk
echo ============================================

where snyk >nul 2>nul || (echo Instalando Snyk CLI... & call npm install -g snyk)
where snyk-to-html >nul 2>nul || (echo Instalando snyk-to-html... & call npm install -g snyk-to-html)

echo [0/2] Prueba de cobertura: que Snyk vea TODO el codigo...
call node herramientas\construir.js --comprobar || call node herramientas\construir.js
call node herramientas\cobertura-snyk.js
if exist seguridad\cobertura-snyk.html start "" seguridad\cobertura-snyk.html
echo.
call snyk whoami --experimental >nul 2>nul || (echo Se abrira el navegador para iniciar sesion en Snyk... & call snyk auth)

echo.
echo [1/2] Analizando dependencias (snyk test)...
call snyk test --dev --json-file-output=seguridad\snyk-dependencias.json
echo.
echo [2/2] Analizando el codigo fuente (snyk code test)...
call snyk code test --json-file-output=seguridad\snyk-codigo.json

echo.
echo Generando informes HTML...
if exist seguridad\snyk-dependencias.json call snyk-to-html -i seguridad\snyk-dependencias.json -o seguridad\snyk-dependencias.html
if exist seguridad\snyk-codigo.json call snyk-to-html -i seguridad\snyk-codigo.json -o seguridad\snyk-codigo.html
call node herramientas\informe-snyk.js
if exist seguridad\INFORME-SNYK.html start "" seguridad\INFORME-SNYK.html
if exist seguridad\snyk-dependencias.html start "" seguridad\snyk-dependencias.html
if exist seguridad\snyk-codigo.html start "" seguridad\snyk-codigo.html
echo.
echo Listo. Los informes estan en la carpeta "seguridad".
pause
