@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
where node >/dev/null 2>/dev/null || (echo ERROR: Node.js no esta instalado. & pause & exit /b 1)
if "%NEW_RELIC_LICENSE_KEY%"=="" set /p NEW_RELIC_LICENSE_KEY=Pega tu License key (INGEST - LICENSE): 
if "%NEW_RELIC_USER_KEY%"=="" set /p NEW_RELIC_USER_KEY=Pega tu User key NRAK- (opcional, Enter para saltar): 
node observabilidad\newrelic\diagnostico.js
pause
