"""
Local OCR pipeline for Star Citizen cargo screenshots.

Two recognised screen layouts:
  mission  — "Deliver 0/9 SCU of Quartz to Sakura Sun Magnolia…"
             Optionally preceded by a "Reward ⊞ 99,500" line.
  manifest — material name + quantity on the same row (cargo hold view).
"""

from __future__ import annotations

import io
import re
from typing import Optional

# ── configurable thresholds ────────────────────────────────────────────────────
FUZZY_THRESHOLD: float = 72.0
ROW_Y_TOLERANCE: int   = 18


# ── fuzzy matching ─────────────────────────────────────────────────────────────

def _fuzzy_match(token: str, candidates: list[str], threshold: float = FUZZY_THRESHOLD) -> Optional[str]:
    if not candidates or not token.strip():
        return None
    try:
        from rapidfuzz import process, fuzz
        result = process.extractOne(token, candidates, scorer=fuzz.token_sort_ratio)
        if result and result[1] >= threshold:
            return result[0]
    except ImportError:
        tl = token.lower()
        for c in candidates:
            if c.lower() == tl:
                return c
    return None


# ── OCR backends ───────────────────────────────────────────────────────────────

def _run_easyocr(image_bytes: bytes) -> list[tuple[str, list]]:
    import easyocr
    import numpy as np
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    arr = np.array(img)
    reader = easyocr.Reader(["en"], verbose=False)
    raw = reader.readtext(arr)
    return [(text, bbox) for bbox, text, conf in raw if conf > 0.3]



def _run_ocr(image_bytes: bytes) -> list[tuple[str, list]]:
    import logging, traceback
    log = logging.getLogger("ocr")
    try:
        result = _run_easyocr(image_bytes)
        log.info("EasyOCR succeeded, %d tokens", len(result))
        return result
    except Exception as exc:
        log.error("EasyOCR failed:\n%s", traceback.format_exc())
        raise RuntimeError(f"OCR failed: {exc}")


# ── helpers ────────────────────────────────────────────────────────────────────

def _y_center(bbox: list) -> float:
    if not bbox:
        return 0.0
    ys = [pt[1] for pt in bbox]
    return (min(ys) + max(ys)) / 2.0


def _group_rows(tokens: list[tuple[str, list]], tolerance: int = ROW_Y_TOLERANCE) -> list[list[str]]:
    if not tokens:
        return []
    sorted_tokens = sorted(tokens, key=lambda t: _y_center(t[1]))
    rows: list[list[str]] = []
    current_row: list[str] = []
    last_y: Optional[float] = None

    for text, bbox in sorted_tokens:
        y = _y_center(bbox)
        if last_y is None or abs(y - last_y) <= tolerance:
            current_row.append(text)
            last_y = y if last_y is None else (last_y + y) / 2
        else:
            rows.append(current_row)
            current_row = [text]
            last_y = y
    if current_row:
        rows.append(current_row)
    return rows


# ── mission-objectives parser ──────────────────────────────────────────────────

# "Deliver 0/9 SCU of Quartz to Sakura Sun Magnolia Workcenter on Hurston."
_MISSION_OBJ_RE = re.compile(
    r"deliver\s+\d+/(\d+)\s+scu\s+of\s+(\w+)\s+to\s+(.+)",
    re.IGNORECASE,
)

# "Reward  ⊞ 99,500"  or  "Reward # 99,500"  or  "Reward 99500"
_REWARD_RE = re.compile(r"reward[^\d]*([\d,]+)", re.IGNORECASE)


def _extract_reward(raw_lines: list[str]) -> Optional[int]:
    for i, line in enumerate(raw_lines):
        # Same-line: "Reward ⊞ 99,500"
        m = _REWARD_RE.search(line)
        if m:
            try:
                return int(m.group(1).replace(",", ""))
            except ValueError:
                pass
        # Split-line: "Reward" on its own, number on the next line
        # (EasyOCR sometimes separates the icon from the digits)
        if re.match(r"reward\s*$", line, re.IGNORECASE) and i + 1 < len(raw_lines):
            candidates = re.findall(r"[\d,]+", raw_lines[i + 1])
            for c in candidates:
                digits = c.replace(",", "")
                if len(digits) >= 4:   # rewards are always 4+ digits
                    try:
                        return int(digits)
                    except ValueError:
                        pass
    return None


def _parse_mission_objectives(raw_lines: list[str]) -> list[dict]:
    """
    Return list of raw deliveries:
      [{"mat_name": str, "dest_name": str, "quantity": int}]
    """
    deliveries: list[dict] = []
    for line in raw_lines:
        m = _MISSION_OBJ_RE.search(line)
        if m:
            qty_str  = m.group(1)
            mat_raw  = m.group(2).strip()
            dest_raw = m.group(3).strip().rstrip(":.")
            # Strip trailing SC location qualifiers: "on Hurston", "in Lorville", etc.
            dest_raw = re.sub(r'\s+(?:on|in|at)\s+\w+$', '', dest_raw, flags=re.IGNORECASE)
            deliveries.append({
                    "mat_name": mat_raw,
                    "dest_name": dest_raw,
                    "quantity": int(qty_str),
                })
    return deliveries


# "Contracted By   Covalex Independent Contractors"  — may be on same or next line
_CONTRACTED_BY_RE = re.compile(r"contracted\s+by\s+(.+)", re.IGNORECASE)

# "Collect Quartz from Everus Harbor."
_PICKUP_RE = re.compile(r"collect\s+\w+\s+from\s+([^.,\n]+)", re.IGNORECASE)


def _extract_contracted_by(raw_lines: list[str]) -> Optional[str]:
    for i, line in enumerate(raw_lines):
        m = _CONTRACTED_BY_RE.search(line)
        if m:
            val = m.group(1).strip()
            if val:
                return val
        # Split across two lines: "Contracted By" / "Covalex …"
        if re.match(r"contracted\s+by\s*$", line, re.IGNORECASE) and i + 1 < len(raw_lines):
            val = raw_lines[i + 1].strip()
            if val and not re.match(r"^\d", val):
                return val
    return None


def _extract_pickup(raw_lines: list[str]) -> Optional[str]:
    for line in raw_lines:
        m = _PICKUP_RE.search(line)
        if m:
            return m.group(1).strip().rstrip(".")
    return None


# ── public API ─────────────────────────────────────────────────────────────────

def extract_data(
    image_bytes: bytes,
    known_materials: list[str],
    known_destinations: list[str],
    fuzzy_threshold: float = FUZZY_THRESHOLD,
) -> dict:
    """
    Returns one of two shapes depending on the detected screen layout.

    Mission objectives screen:
      {
        "type": "mission",
        "reward": int | None,
        "deliveries": [{"mat_name": str, "dest_name": str, "quantity": int}],
        "raw_lines": [str]
      }

    Cargo manifest screen:
      {
        "type": "manifest",
        "destination": str | None,
        "materials": [{"name": str, "quantity": int, "raw_name": str, "raw_qty": str}],
        "unknown_materials": [str],
        "raw_lines": [str]
      }
    """
    tokens   = _run_ocr(image_bytes)
    raw_lines = [t for t, _ in tokens]

    # ── try mission-objectives format first ────────────────────────────────────
    deliveries = _parse_mission_objectives(raw_lines)
    if deliveries:
        return {
            "type":           "mission",
            "reward":         _extract_reward(raw_lines),
            "contracted_by":  _extract_contracted_by(raw_lines),
            "pickup_location": _extract_pickup(raw_lines),
            "deliveries":     deliveries,
            "raw_lines":      raw_lines,
        }

    # ── fallback: cargo-manifest format ───────────────────────────────────────
    matched_destination: Optional[str] = None
    for text, _ in tokens:
        m = _fuzzy_match(text.strip(), known_destinations, fuzzy_threshold)
        if m:
            matched_destination = m
            break

    rows = _group_rows(tokens)
    result_pairs: list[dict] = []
    seen_materials: set[str] = set()
    candidate_unknowns: list[str] = []

    for row in rows:
        row_text = " ".join(row)
        numbers  = re.findall(r"\b(\d+)\b", row_text)

        for token in row:
            cleaned = re.sub(r"[.:,;]+$", "", token.strip())
            if not cleaned or len(cleaned) < 3:
                continue

            matched_mat = _fuzzy_match(cleaned, known_materials, fuzzy_threshold)

            if matched_mat and matched_mat not in seen_materials:
                seen_materials.add(matched_mat)
                if numbers:
                    raw_qty = numbers[-1]
                    result_pairs.append({
                        "name":     matched_mat,
                        "quantity": int(raw_qty),
                        "raw_name": token,
                        "raw_qty":  raw_qty,
                    })
            elif (
                matched_mat is None
                and not re.match(r"^\d+$", cleaned)
                and len(cleaned) >= 4
                and _fuzzy_match(cleaned, known_destinations, fuzzy_threshold) is None
            ):
                candidate_unknowns.append(cleaned)

    return {
        "type":             "manifest",
        "destination":      matched_destination,
        "materials":        result_pairs,
        "unknown_materials": list({t for t in candidate_unknowns if len(t) >= 4}),
        "raw_lines":        raw_lines,
    }
