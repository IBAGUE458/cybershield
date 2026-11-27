#!/bin/sh
cd "$(dirname "$0")/.."
node rendimiento/ejecutar.js jmeter "${1:-50}" "${2:-90}" "${3:-20}"
