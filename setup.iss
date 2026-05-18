; SC Cargo Tracker — Inno Setup 6 script
; Wraps the PyInstaller bundle and silently downloads + installs Tesseract OCR.

#define AppName    "SC Cargo Tracker"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppExe     "SC Cargo Tracker.exe"
#define TessURL    "https://github.com/UB-Mannheim/tesseract/releases/download/v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe"

[Setup]
AppId={{B7C3A1F2-D4E5-4890-BCDE-F01234567890}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Picalexdev
AppPublisherURL=https://github.com/Picalexdev/sc-cargo-tracker
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
OutputDir=dist
OutputBaseFilename=SC-Cargo-Tracker-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
DisableWelcomePage=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "dist\SC Cargo Tracker\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName} now"; Flags: postinstall nowait skipifsilent

[Code]
const
  TESS_URL = '{#TessURL}';

function TesseractInstalled: Boolean;
begin
  Result :=
    FileExists('C:\Program Files\Tesseract-OCR\tesseract.exe') or
    FileExists('C:\Program Files (x86)\Tesseract-OCR\tesseract.exe');
end;

procedure DownloadAndInstallTesseract;
var
  TempFile  : String;
  ResultCode: Integer;
  PSArgs    : String;
begin
  if TesseractInstalled then
  begin
    Log('Tesseract already present — skipping download.');
    Exit;
  end;

  WizardForm.StatusLabel.Caption := 'Downloading Tesseract OCR (required for scanning)...';
  TempFile := ExpandConstant('{tmp}\tesseract_setup.exe');

  PSArgs := '-NoProfile -ExecutionPolicy Bypass -Command ' +
            '"Invoke-WebRequest -Uri ''' + TESS_URL + ''' ' +
            '-OutFile ''' + TempFile + ''' -UseBasicParsing"';

  Log('Downloading Tesseract from: ' + TESS_URL);
  if not Exec('powershell.exe', PSArgs, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or
     (ResultCode <> 0) then
  begin
    MsgBox(
      'Could not download Tesseract OCR.' + #13#10 +
      'The app will work normally, but the OCR screenshot scanning feature will be unavailable.' + #13#10#13#10 +
      'To enable OCR later, install Tesseract manually from:' + #13#10 +
      'https://github.com/UB-Mannheim/tesseract/releases',
      mbInformation, MB_OK
    );
    Exit;
  end;

  WizardForm.StatusLabel.Caption := 'Installing Tesseract OCR...';
  Log('Running Tesseract installer silently...');
  if not Exec(TempFile, '/S', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or
     (ResultCode <> 0) then
  begin
    MsgBox(
      'Tesseract OCR installer failed (code ' + IntToStr(ResultCode) + ').' + #13#10 +
      'OCR scanning will be unavailable.' + #13#10#13#10 +
      'You can install it manually from:' + #13#10 +
      'https://github.com/UB-Mannheim/tesseract/releases',
      mbError, MB_OK
    );
  end
  else
    Log('Tesseract installed successfully.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    DownloadAndInstallTesseract;
end;
