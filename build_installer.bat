@echo off
rem Optional argument: the version to stamp in the installer (publicar.bat passes it).
rem With it, the script does not stop to wait for a key.
set "APPVER=%~1"
set "PAUSA=pause"
if not "%APPVER%"=="" set "PAUSA=rem"
echo ============================================================
echo  SC Cargo Tracker - Build Installer
echo ============================================================
echo.

echo [1/3] Installing Python build dependencies...
pip install pyinstaller pywebview pillow rapidfuzz fastapi "uvicorn[standard]" python-multipart pydantic --quiet
pip install pytesseract --quiet
if errorlevel 1 (
  echo ERROR: pip install failed.
  %PAUSA%
  exit /b 1
)
echo Done.
echo.

echo [2/3] Building app bundle with PyInstaller...
pyinstaller ^
  --noconfirm ^
  --name "SC Cargo Tracker" ^
  --onedir ^
  --windowed ^
  --icon "icon.ico" ^
  --add-data "frontend;frontend" ^
  --paths "backend" ^
  --collect-all "pywebview" ^
  --hidden-import "webview.platforms.winforms" ^
  --hidden-import "webview.platforms.chromium" ^
  --hidden-import "uvicorn.logging" ^
  --hidden-import "uvicorn.loops" ^
  --hidden-import "uvicorn.loops.auto" ^
  --hidden-import "uvicorn.protocols" ^
  --hidden-import "uvicorn.protocols.http" ^
  --hidden-import "uvicorn.protocols.http.auto" ^
  --hidden-import "uvicorn.protocols.websockets" ^
  --hidden-import "uvicorn.protocols.websockets.auto" ^
  --hidden-import "uvicorn.lifespan" ^
  --hidden-import "uvicorn.lifespan.on" ^
  --hidden-import "anyio._backends._asyncio" ^
  --hidden-import "pytesseract" ^
  --exclude-module "paddle" ^
  --exclude-module "paddleocr" ^
  --exclude-module "matplotlib" ^
  --exclude-module "scipy" ^
  --exclude-module "sklearn" ^
  run.py

if not exist "dist\SC Cargo Tracker\SC Cargo Tracker.exe" (
  echo.
  echo ERROR: PyInstaller build failed. Check output above.
  %PAUSA%
  exit /b 1
)
echo PyInstaller build complete.
echo.

echo [3/3] Building installer with Inno Setup...
if "%APPVER%"=="" (
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup.iss
) else (
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DAppVersion=%APPVER% setup.iss
)
if errorlevel 1 (
  echo.
  echo ERROR: Inno Setup failed. Check output above.
  %PAUSA%
  exit /b 1
)

if exist "dist\SC-Cargo-Tracker-Setup.exe" (
  echo.
  echo ============================================================
  echo  SUCCESS!
  echo  Installer: dist\SC-Cargo-Tracker-Setup.exe
  echo  Upload this file to your GitHub release.
  echo ============================================================
) else (
  echo.
  echo ERROR: Installer was not created. Check output above.
)
echo.
%PAUSA%
