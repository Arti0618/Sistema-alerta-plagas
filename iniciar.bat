@echo off
title Panel Telegram - Artilleros_bot
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] No se encontro Node.js instalado.
  echo      Descargalo en https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo.
echo  Iniciando el panel de Telegram...
echo  (No cierres esta ventana mientras uses la aplicacion)
echo.

start "" http://localhost:3000
node server.js

echo.
echo  El servidor se detuvo.
pause
