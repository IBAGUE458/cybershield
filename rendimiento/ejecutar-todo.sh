#!/bin/sh
cd "$(dirname "$0")/.."
node rendimiento/ejecutar.js todo "$@"
