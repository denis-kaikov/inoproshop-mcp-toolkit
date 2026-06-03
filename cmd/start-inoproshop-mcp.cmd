@echo off
setlocal

if not exist "C:\Temp\inoproshop-mcp-logs" mkdir "C:\Temp\inoproshop-mcp-logs" >nul 2>nul

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_DIR=%%~fI"

cd /d "%REPO_DIR%"
node ".\dist\inoproshopServer.js" 2>> "C:\Temp\inoproshop-mcp-logs\server.err.log"
