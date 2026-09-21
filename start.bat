@echo off
setlocal
cd /d "%~dp0"
set "PORT=8000"
set "PYTHON="

where py >nul 2>&1
if not errorlevel 1 set "PYTHON=py"

if not defined PYTHON (
  where python >nul 2>&1
  if not errorlevel 1 set "PYTHON=python"
)

if not defined PYTHON (
  echo Python was not found.
  echo Install Python 3, then run start.bat again.
  pause
  exit /b 1
)

echo Starting Travel Atlas at http://127.0.0.1:%PORT%/
if defined NO_BROWSER (
  %PYTHON% -m http.server %PORT%
  exit /b %errorlevel%
)

start "Travel Atlas Server" cmd /k "%PYTHON% -m http.server %PORT%"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"
endlocal
