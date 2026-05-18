# SC Cargo Resource Tracker

A local-only desktop web app for tracking material quantities across Star Citizen cargo destinations.

## Quick start

**Double-click `start.bat`** (Windows), or run:

```
python start.py
```

This installs dependencies automatically (first run takes a minute), starts the server on `http://localhost:8000`, and opens your browser.

All data is stored in `cargo_tracking.db` in this folder — back up the whole folder to preserve your data.

---

## Dependencies

Python 3.9+ required.  
Core packages (installed automatically by `start.py`):

| Package | Purpose |
|---|---|
| `fastapi` | Web framework / API |
| `uvicorn` | ASGI server |
| `python-multipart` | File upload support |
| `pydantic` | Request validation |
| `rapidfuzz` | Fuzzy string matching for OCR |
| `Pillow` | Image loading for OCR |

### OCR (optional — install manually)

OCR requires **one** of the following. Without it, the screenshot upload button is still shown but the server will return an error.

**Option A — PaddleOCR** (better accuracy on stylised game UI):
```
pip install paddlepaddle paddleocr
```

**Option B — Tesseract** (simpler install):
1. Download and install the Tesseract binary:  
   https://github.com/UB-Mannheim/tesseract/wiki
2. `pip install pytesseract`

---

## Features

- **Materials list** — add/remove material names; each becomes a column across all destinations.
- **Destination matrix** — editable table: click any name or quantity to edit; changes save instantly.
- **NULL vs zero** — blank cells mean "not needed"; `0` means "zero needed". They are stored differently.
- **Copy as Table** — copies the full matrix as tab-separated values for pasting into Excel/Sheets.
- **Screenshot OCR** — upload a cargo/mission screenshot; the app extracts material names and quantities, shows you a preview to review and correct, then writes to the matrix only after you confirm.
- **Fuzzy matching** — OCR errors like "Titaniun" are corrected to "Titanium" by matching against your known materials list.

---

## Project structure

```
SC Cargo tracking/
├── backend/
│   ├── main.py          FastAPI app + API endpoints
│   ├── database.py      SQLite operations
│   ├── ocr.py           OCR pipeline (PaddleOCR / Tesseract)
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js           Vanilla JS UI (no build step)
├── cargo_tracking.db    Created on first run
├── start.py             Launcher
├── start.bat            Windows double-click launcher
└── README.md
```

---

## Configuring OCR thresholds

Open `backend/ocr.py` and edit the constants near the top:

```python
FUZZY_THRESHOLD: float = 72.0   # 0–100; lower = more permissive matching
ROW_Y_TOLERANCE: int   = 18     # pixels; increase if tokens on same row aren't grouped
```
