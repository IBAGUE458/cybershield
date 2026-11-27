#!/bin/sh
# CyberShield - Análisis de seguridad con Snyk (Mac/Linux)
cd "$(dirname "$0")/.." || exit 1
command -v snyk >/dev/null 2>&1 || { echo "Instalando Snyk CLI..."; npm install -g snyk; }
command -v snyk-to-html >/dev/null 2>&1 || { echo "Instalando snyk-to-html..."; npm install -g snyk-to-html; }
echo "[0/2] Prueba de cobertura: que Snyk vea TODO el código..."
node herramientas/construir.js --comprobar || node herramientas/construir.js
node herramientas/cobertura-snyk.js
snyk whoami --experimental >/dev/null 2>&1 || { echo "Se abrirá el navegador para iniciar sesión en Snyk..."; snyk auth; }
echo; echo "[1/2] Analizando dependencias (snyk test)..."
snyk test --dev --json-file-output=seguridad/snyk-dependencias.json
echo; echo "[2/2] Analizando el código fuente (snyk code test)..."
snyk code test --json-file-output=seguridad/snyk-codigo.json
echo; echo "Generando informes HTML..."
[ -f seguridad/snyk-dependencias.json ] && snyk-to-html -i seguridad/snyk-dependencias.json -o seguridad/snyk-dependencias.html
[ -f seguridad/snyk-codigo.json ] && snyk-to-html -i seguridad/snyk-codigo.json -o seguridad/snyk-codigo.html
node herramientas/informe-snyk.js
echo; echo "Listo. Informes en la carpeta seguridad/"
