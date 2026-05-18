# SC Cargo Tracker

A Windows desktop app for tracking material quantities across Star Citizen cargo destinations.

## Download

[![Download latest installer](https://img.shields.io/github/v/release/Picalexdev/sc-cargo-tracker?label=Download%20Installer&style=for-the-badge&color=4f8ef7)](https://github.com/Picalexdev/sc-cargo-tracker/releases/latest/download/SC-Cargo-Tracker-Setup.exe)

Or go to the [Releases page](https://github.com/Picalexdev/sc-cargo-tracker/releases/latest) and download `SC-Cargo-Tracker-Setup.exe`.

**Requirements:** Windows 10/11 (64-bit). Everything else — Python, dependencies, Tesseract OCR — is bundled or installed automatically by the installer.

> **Windows SmartScreen warning:** When you first run the installer, Windows may show "Windows protected your PC". Click **More info** → **Run anyway**. This is normal for unsigned community software and does not indicate any risk.

---

## Features

- **Material & destination matrix** — track how much of each material needs to go where
- **Drag & drop reordering** — rearrange materials and destinations; the table updates instantly
- **Mission cards** — add up to 10 active missions; apply partial completions (25 / 50 / 75 / 100%)
- **Run history** — each completed run is logged with reward and delivery breakdown
- **Screenshot OCR** — paste or upload a cargo/mission screenshot; the app reads materials and quantities and shows a review before writing anything
- **Update notifications** — the app checks for new releases on startup and shows a banner if one is available
- **NULL vs zero** — blank cells mean "not needed"; `0` means "needed but currently zero"

---

## Data

All data is stored in a local SQLite database (`cargo_tracking.db`) in `%APPDATA%\SC Cargo Tracker`. Back up that file to preserve your data across reinstalls.

---

## Project structure

```
SC Cargo tracking/
├── backend/
│   ├── main.py          FastAPI app + API endpoints
│   ├── database.py      SQLite operations
│   ├── ocr.py           OCR pipeline (EasyOCR / Tesseract)
│   └── version.py       VERSION constant (stamped by CI at build time)
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── setup.iss            Inno Setup installer script
├── build_installer.bat  Local build script (dev)
└── .github/workflows/
    └── build-release.yml   Auto-builds installer on version tags
```

