#!/bin/sh
cd "$(dirname "$0")/.."
node rendimiento/ejecutar.js k6 "${1:-carga}"
