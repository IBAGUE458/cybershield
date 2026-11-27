#!/bin/sh
# CyberShield - Prueba con New Relic (OpenTelemetry). Uso: sh observabilidad/newrelic/ejecutar-newrelic.sh [escenario k6]
cd "$(dirname "$0")/../.." || exit 1
if [ -z "$NEW_RELIC_LICENSE_KEY" ]; then
  printf "Pega tu License key de New Relic (INGEST - LICENSE): "; stty -echo 2>/dev/null; read -r NEW_RELIC_LICENSE_KEY; stty echo 2>/dev/null; echo
  export NEW_RELIC_LICENSE_KEY
fi
[ -n "$NEW_RELIC_LICENSE_KEY" ] || { echo "No se indicó la clave."; exit 1; }
export NEW_RELIC_REGION="${NEW_RELIC_REGION:-US}"
[ -d node_modules/@opentelemetry/sdk-node ] || npm install
if command -v k6 >/dev/null 2>&1; then
  node -r ./observabilidad/newrelic/telemetria.js rendimiento/ejecutar.js k6 "${1:-carga}"
else
  echo "k6 no está instalado: se arranca solo el servidor con telemetría (http://127.0.0.1:8080, Ctrl+C para terminar)."
  node -r ./observabilidad/newrelic/telemetria.js servidor.js 8080
fi
echo "Abre https://one.newrelic.com > APM & Services > cybershield"
