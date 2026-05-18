#!/usr/bin/env python3
"""
Launch the SC Cargo Tracker.
  - Installs Python dependencies on first run.
  - Starts the FastAPI server on http://localhost:8000
  - Opens the browser automatically.
"""
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT    = Path(__file__).parent
BACKEND = ROOT / "backend"
REQ     = BACKEND / "requirements.txt"

HOST = "127.0.0.1"
PORT = 8000
URL  = f"http://{HOST}:{PORT}"


def pip_install():
    print("Installing / verifying Python dependencies…")
    # Install only the non-optional lines
    lines = [
        ln.strip()
        for ln in REQ.read_text().splitlines()
        if ln.strip() and not ln.startswith("#")
    ]
    if lines:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet", *lines]
        )


def main():
    print("=" * 50)
    print("  SC Cargo Resource Tracker")
    print("=" * 50)

    try:
        pip_install()
    except subprocess.CalledProcessError:
        print("\n[WARNING] Some packages failed to install.")
        print("OCR may not work. The rest of the app will still run fine.\n")

    print(f"\nStarting server at {URL} …")
    proc = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn",
            "main:app",
            "--host", HOST,
            "--port", str(PORT),
            "--reload",          # handy for development
        ],
        cwd=BACKEND,
    )

    # Give the server a moment, then open the browser
    time.sleep(1.8)
    print(f"Opening {URL} in your browser…")
    webbrowser.open(URL)
    print("\nPress Ctrl+C to stop.\n")

    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
