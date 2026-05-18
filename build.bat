@echo off
echo ============================================================
echo  SC Cargo Tracker - Build
echo ============================================================
echo.

echo Installing build tools...
pip install pyinstaller pywebview --quiet
echo.

echo Building executable...
pyinstaller ^
  --name "SC Cargo Tracker" ^
  --onedir ^
  --windowed ^
  --add-data "frontend;frontend" ^
  --paths "backend" ^
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
  run.py

echo.
if exist "dist\SC Cargo Tracker\SC Cargo Tracker.exe" (
  echo ============================================================
  echo  Build complete!
  echo  Executable: dist\SC Cargo Tracker\SC Cargo Tracker.exe
  echo  The database will be created in that same folder on first run.
  echo  You can move the entire "SC Cargo Tracker" folder anywhere.
  echo ============================================================
) else (
  echo Build may have failed - check the output above.
)
echo.
pause
