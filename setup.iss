; SC Cargo Tracker — Inno Setup 6 script

#define AppName    "SC Cargo Tracker"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppExe     "SC Cargo Tracker.exe"

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
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\icon.ico
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
Source: "icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName} now"; Flags: postinstall nowait skipifsilent

[Code]
const
  TessExe = 'C:\Program Files\Tesseract-OCR\tesseract.exe';
  TessURL = 'https://github.com/UB-Mannheim/tesseract/releases/download/v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe';

procedure SetProgress(Msg: String; Marquee: Boolean);
begin
  WizardForm.StatusLabel.Caption := Msg;
  if Marquee then
    WizardForm.ProgressGauge.Style := npbstMarquee
  else
    WizardForm.ProgressGauge.Style := npbstNormal;
  WizardForm.Update;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  TmpFile: String;
  ResultCode: Integer;
  PS: String;
begin
  if CurStep <> ssPostInstall then Exit;
  if FileExists(TessExe) then Exit;

  SetProgress('Downloading Tesseract OCR — please wait...', True);

  TmpFile := ExpandConstant('{tmp}\tesseract-setup.exe');
  PS := '-NoProfile -NonInteractive -Command "(New-Object System.Net.WebClient).DownloadFile(''' + TessURL + ''', ''' + TmpFile + ''')"';

  if not Exec('powershell.exe', PS, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    SetProgress('', False);
    MsgBox('Could not download Tesseract OCR. You can install it manually from https://github.com/UB-Mannheim/tesseract/wiki', mbError, MB_OK);
    Exit;
  end;

  SetProgress('Installing Tesseract OCR — please wait...', True);
  Exec(TmpFile, '/S', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  SetProgress('', False);
end;
