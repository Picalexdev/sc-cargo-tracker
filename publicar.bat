@echo off
setlocal
rem Publishes a new version from this PC: stamps the version, builds the
rem installer and creates the GitHub release with the .exe attached.
rem Usage: publicar.bat v1.2.0
rem Needs Python, Inno Setup 6 and the GitHub CLI (gh) signed in.

set "TAG=%~1"
if "%TAG%"=="" goto :usage
if /i not "%TAG:~0,1%"=="v" goto :usage
set "VER=%TAG:~1%"
if "%VER%"=="" goto :usage

gh auth status >nul 2>&1
if errorlevel 1 (
  echo ERROR: gh is not signed in. Run "gh auth login" first.
  exit /b 1
)

git diff --quiet HEAD
if errorlevel 1 (
  echo ERROR: there are uncommitted changes. Commit or stash them first.
  exit /b 1
)

git fetch -q origin --tags
git rev-parse -q --verify "refs/tags/%TAG%" >nul
if not errorlevel 1 (
  echo ERROR: tag %TAG% already exists.
  exit /b 1
)

echo VERSION = "%VER%"> backend\version.py
git diff --quiet -- backend\version.py
if errorlevel 1 (
  git commit -q -m "Version %VER%" -- backend\version.py
  if errorlevel 1 exit /b 1
)

if exist "dist\SC-Cargo-Tracker-Setup.exe" del "dist\SC-Cargo-Tracker-Setup.exe"
call build_installer.bat %VER%
if errorlevel 1 exit /b 1
if not exist "dist\SC-Cargo-Tracker-Setup.exe" (
  echo ERROR: the installer was not created.
  exit /b 1
)

git push -q origin HEAD
if errorlevel 1 exit /b 1
for /f %%c in ('git rev-parse HEAD') do set "SHA=%%c"

gh release create "%TAG%" "dist\SC-Cargo-Tracker-Setup.exe" --target %SHA% --title "%TAG%" --generate-notes
if errorlevel 1 exit /b 1
git fetch -q origin --tags
echo.
echo Published %TAG%.
exit /b 0

:usage
echo Usage: publicar.bat vX.Y.Z
exit /b 1
