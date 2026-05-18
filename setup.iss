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
