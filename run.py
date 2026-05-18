"""
SC Cargo Tracker — desktop launcher.

Starts the FastAPI backend in a background thread, then opens a native window
via pywebview (WebView2/Chromium on Windows 11).  Falls back to the default
browser automatically if pywebview is not installed.
"""
from __future__ import annotations

import logging
import queue
import socket
import sys
import threading
import time
import traceback
import urllib.request
from pathlib import Path

# ── paths ──────────────────────────────────────────────────────────────────────

# Base dir: _MEIPASS when frozen, project root when running from source
_HERE = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).parent)

# Log file always sits next to the .exe (or next to run.py in dev)
_EXE_DIR = Path(sys.executable).parent if getattr(sys, "_MEIPASS", None) else Path(__file__).parent
_LOG = _EXE_DIR / "startup.log"

# Add backend/ to sys.path so import main / database / ocr all resolve
sys.path.insert(0, str(_HERE / "backend"))

# In --windowed PyInstaller builds stdout/stderr are None.
# uvicorn's logging setup calls sys.stderr.isatty() and crashes on NoneType.
import os as _os
if sys.stdout is None:
    sys.stdout = open(_os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(_os.devnull, "w")

# ── logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    filename=str(_LOG),
    level=logging.DEBUG,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("launcher")
log.info("=== SC Cargo Tracker starting ===")
log.info("_HERE    = %s", _HERE)
log.info("_EXE_DIR = %s", _EXE_DIR)
log.info("sys.executable = %s", sys.executable)


# ── helpers ────────────────────────────────────────────────────────────────────

def _show_error(title: str, body: str) -> None:
    log.error("FATAL: %s — %s", title, body)
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(title, body + f"\n\nSee {_LOG} for details.")
        root.destroy()
    except Exception:
        print(f"ERROR — {title}\n{body}", file=sys.stderr)


def _free_port(start: int = 8000) -> int:
    for p in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise OSError("No free port found in range 8000–8099")


def _wait_for_server(port: int, timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/matrix", timeout=1)
            return
        except Exception:
            time.sleep(0.25)
    raise TimeoutError(f"Server did not start on port {port} within {timeout}s")


# ── main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    try:
        log.info("Importing backend…")
        import uvicorn
        import main as _backend  # resolves to backend/main.py via sys.path
        log.info("Backend imported OK")
    except Exception:
        _show_error("Import failed", traceback.format_exc())
        sys.exit(1)

    port = _free_port()
    log.info("Using port %d", port)
    error_q: queue.Queue = queue.Queue()

    def _run_server():
        try:
            log.info("uvicorn starting…")
            uvicorn.run(
                _backend.app,
                host="127.0.0.1",
                port=port,
                log_level="error",
            )
        except Exception:
            tb = traceback.format_exc()
            log.error("Server crashed:\n%s", tb)
            error_q.put(tb)

    threading.Thread(target=_run_server, daemon=True).start()

    try:
        _wait_for_server(port)
        log.info("Server ready on port %d", port)
    except TimeoutError as exc:
        try:
            server_err = error_q.get_nowait()
        except queue.Empty:
            server_err = "(no traceback — server may have hung during import)"
        _show_error("Startup failed", str(exc) + "\n\n" + server_err)
        sys.exit(1)

    url = f"http://127.0.0.1:{port}"
    log.info("Opening window: %s", url)

    try:
        import webview
        webview.create_window(
            "SC Cargo Tracker",
            url,
            width=1400,
            height=900,
            min_size=(800, 600),
        )
        webview.start()
    except ImportError:
        import webbrowser
        log.warning("pywebview not installed, falling back to browser")
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
