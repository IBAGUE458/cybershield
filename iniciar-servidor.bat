@echo off
cd /d "%~dp0"
start http://127.0.0.1:8080/
node servidor.js 8080
pause
