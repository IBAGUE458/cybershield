#!/bin/sh
cd "$(dirname "$0")"
echo "Abre http://127.0.0.1:8080/"
node servidor.js 8080
