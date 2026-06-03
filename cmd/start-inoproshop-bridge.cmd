@echo off
setlocal

if not exist "C:\Temp\inoproshop-mcp-logs" mkdir "C:\Temp\inoproshop-mcp-logs" >nul 2>nul
if not exist "C:\Temp\inoproshop-mcp-bridge" mkdir "C:\Temp\inoproshop-mcp-bridge" >nul 2>nul

if not defined INOPROSHOP_EXE set "INOPROSHOP_EXE=C:\Inovance Control\InoProShop\CODESYS\Common\InoProShop.exe"
if not defined INOPROSHOP_PROFILE set "INOPROSHOP_PROFILE=InoProShop(V1.9.1.6)"
if not defined INOPROSHOP_BRIDGE_DIR set "INOPROSHOP_BRIDGE_DIR=C:\Temp\inoproshop-mcp-bridge"

if defined INOPROSHOP_REPO_ROOT (
  set "REPO_DIR=%INOPROSHOP_REPO_ROOT%"
) else (
  set "SCRIPT_DIR=%~dp0"
  for %%I in ("%SCRIPT_DIR%..") do set "REPO_DIR=%%~fI"
)

if not defined INOPROSHOP_BRIDGE_SCRIPT set "INOPROSHOP_BRIDGE_SCRIPT=%REPO_DIR%\scripts\sp11_persistent_bridge.py"

taskkill /IM InoProShop.exe /T /F >nul 2>nul
del "%INOPROSHOP_BRIDGE_DIR%\bridge.ready" >nul 2>nul

start "" "%INOPROSHOP_EXE%" --profile="%INOPROSHOP_PROFILE%" --runscript="%INOPROSHOP_BRIDGE_SCRIPT%"
