from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database
import ocr

app = FastAPI(title="SC Cargo Resource Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

database.init_db()


# ── request models ─────────────────────────────────────────────────────────────

class MaterialCreate(BaseModel):
    name: str

class DestinationCreate(BaseModel):
    name: str

class DestinationUpdate(BaseModel):
    name: str

class QuantitySet(BaseModel):
    quantity: Optional[int] = None

class MissionCreate(BaseModel):
    reward: Optional[int] = None
    contracted_by: Optional[str] = None
    pickup_location: Optional[str] = None
    deliveries: list[dict]   # [{"mat_name", "mat_id"?, "dest_name", "dest_id"?, "quantity"}]

class MissionApply(BaseModel):
    completion_pct: int      # 25 | 50 | 75 | 100

class EndRunEntry(BaseModel):
    mission_id:     int
    completion_pct: int

class EndRunRequest(BaseModel):
    entries: list[EndRunEntry]

class OCRApply(BaseModel):
    dest_id: int
    materials: list[dict]
    new_materials: list[str]

class AliasCreate(BaseModel):
    alias: str
    dest_id: int


# ── matrix ─────────────────────────────────────────────────────────────────────

@app.get("/api/matrix")
def get_matrix():
    return database.get_matrix()


# ── materials ──────────────────────────────────────────────────────────────────

@app.post("/api/materials", status_code=201)
def add_material(data: MaterialCreate):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    try:
        return database.add_material(name)
    except ValueError as exc:
        raise HTTPException(409, str(exc))

@app.delete("/api/materials/{mat_id}")
def delete_material(mat_id: int):
    database.delete_material(mat_id)
    return {"ok": True}


# ── destinations ───────────────────────────────────────────────────────────────

@app.post("/api/destinations", status_code=201)
def add_destination(data: DestinationCreate):
    name = data.name.strip() or "New Destination"
    return database.add_destination(name)

@app.put("/api/destinations/{dest_id}")
def update_destination(dest_id: int, data: DestinationUpdate):
    database.update_destination(dest_id, data.name.strip())
    return {"ok": True}

@app.delete("/api/destinations/{dest_id}")
def delete_destination(dest_id: int):
    database.delete_destination(dest_id)
    return {"ok": True}


# ── quantities ─────────────────────────────────────────────────────────────────

@app.put("/api/quantities/{dest_id}/{mat_id}")
def set_quantity(dest_id: int, mat_id: int, data: QuantitySet):
    database.set_quantity(dest_id, mat_id, data.quantity)
    return {"ok": True}


# ── missions ───────────────────────────────────────────────────────────────────

@app.get("/api/history")
def get_history():
    return database.get_history()

@app.delete("/api/runs/{run_id}")
def delete_run(run_id: int):
    database.delete_run(run_id)
    return {"ok": True}


@app.get("/api/missions")
def get_missions():
    return database.get_missions()

@app.post("/api/missions", status_code=201)
def create_mission(data: MissionCreate):
    if len(database.get_missions()) >= 10:
        raise HTTPException(409, "Maximum of 10 mission cards reached")
    return database.create_mission(data.reward, data.deliveries, data.contracted_by, data.pickup_location)

@app.delete("/api/missions")
def clear_missions():
    database.clear_missions()
    return {"ok": True}

@app.delete("/api/missions/{mission_id}")
def delete_mission(mission_id: int):
    database.delete_mission(mission_id)
    return {"ok": True}

@app.post("/api/missions/{mission_id}/apply")
def apply_mission(mission_id: int, data: MissionApply):
    try:
        database.apply_mission(mission_id, data.completion_pct)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True}

@app.post("/api/missions/end-run")
def end_run(data: EndRunRequest):
    try:
        database.end_run([e.model_dump() for e in data.entries])
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True}


# ── OCR ────────────────────────────────────────────────────────────────────────

@app.post("/api/ocr")
async def ocr_upload(file: UploadFile = File(...)):
    image_bytes  = await file.read()
    materials    = database.get_materials()
    destinations = database.get_destinations()
    aliases      = database.get_aliases()

    try:
        result = ocr.extract_data(
            image_bytes,
            [m["name"] for m in materials],
            [d["name"] for d in destinations],
        )
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OCR error: {exc}")

    mat_by_name  = {m["name"].lower(): m for m in materials}
    dest_by_name = {d["name"].lower(): d for d in destinations}

    # ── mission screen ──────────────────────────────────────────────────────
    if result["type"] == "mission":
        enriched: list[dict] = []
        for d in result["deliveries"]:
            mat_match  = _best_match(d["mat_name"],  mat_by_name)
            dest_match = _best_dest_match(d["dest_name"], dest_by_name, aliases)
            enriched.append({
                "mat_name":  d["mat_name"],
                "mat_id":    mat_match["id"]   if mat_match  else None,
                "dest_name": d["dest_name"],
                "dest_id":   dest_match["id"]  if dest_match else None,
                "dest_matched_name": dest_match["name"] if dest_match else None,
                "quantity":  d["quantity"],
                "mat_known": mat_match is not None,
            })
        return {
            "type":             "mission",
            "reward":           result["reward"],
            "contracted_by":    result.get("contracted_by"),
            "pickup_location":  result.get("pickup_location"),
            "deliveries":       enriched,
            "all_destinations": [{"id": d["id"], "name": d["name"]} for d in destinations],
            "raw_lines":        result["raw_lines"],
        }

    # ── manifest screen ─────────────────────────────────────────────────────
    enriched_mats = []
    for item in result["materials"]:
        mat = mat_by_name.get(item["name"].lower())
        if mat:
            enriched_mats.append({**item, "mat_id": mat["id"]})

    dest_match = None
    if result["destination"]:
        dest = dest_by_name.get(result["destination"].lower())
        if dest:
            dest_match = {"id": dest["id"], "name": dest["name"]}

    return {
        "type":              "manifest",
        "destination":       dest_match,
        "materials":         enriched_mats,
        "unknown_materials": result["unknown_materials"],
        "all_destinations":  [{"id": d["id"], "name": d["name"]} for d in destinations],
        "raw_lines":         result["raw_lines"],
    }


@app.post("/api/ocr/apply")
def apply_ocr(data: OCRApply):
    for mat_name in data.new_materials:
        try:
            database.add_material(mat_name)
        except ValueError:
            pass

    mat_by_name = {m["name"].lower(): m["id"] for m in database.get_materials()}
    for item in data.materials:
        mat_id = item.get("mat_id") or mat_by_name.get(item.get("name", "").lower())
        if mat_id is not None:
            database.set_quantity(data.dest_id, mat_id, item.get("quantity"))
    return {"ok": True}


# ── destination aliases ────────────────────────────────────────────────────────

@app.get("/api/aliases")
def get_aliases():
    return database.get_aliases()

@app.post("/api/aliases", status_code=201)
def add_alias(data: AliasCreate):
    alias = data.alias.strip()
    if not alias:
        raise HTTPException(400, "Alias cannot be empty")
    try:
        return database.add_alias(alias, data.dest_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))

@app.delete("/api/aliases/{alias_id}")
def delete_alias(alias_id: int):
    database.delete_alias(alias_id)
    return {"ok": True}

# ── helpers ────────────────────────────────────────────────────────────────────

def _best_match(raw_name: str, by_name: dict) -> Optional[dict]:
    return by_name.get(raw_name.lower())


def _best_dest_match(dest_phrase: str, by_name: dict, aliases: Optional[list] = None) -> Optional[dict]:
    """
    Match a raw destination phrase like 'Sakura Sun Magnolia Workcenter on Hurston'
    against known destination names.  Tries alias table first, then substring,
    rapidfuzz, and individual words.
    """
    phrase_lower = dest_phrase.lower()

    # DB aliases — checked before anything else
    for a in (aliases or []):
        if a["alias"].lower() in phrase_lower:
            dest = by_name.get(a["dest_name"].lower())
            if dest:
                return dest

    # exact / substring check
    for name_lower, dest in by_name.items():
        if name_lower in phrase_lower or phrase_lower in name_lower:
            return dest

    # rapidfuzz
    try:
        from rapidfuzz import process, fuzz
        result = process.extractOne(
            dest_phrase, list(by_name.keys()), scorer=fuzz.token_sort_ratio
        )
        if result and result[1] >= 65:
            return by_name[result[0]]
    except ImportError:
        pass

    # individual words
    for word in dest_phrase.split():
        if len(word) >= 4 and word.lower() in by_name:
            return by_name[word.lower()]

    return None


# ── serve frontend (must be last) ──────────────────────────────────────────────

# When bundled by PyInstaller, frontend/ is extracted to sys._MEIPASS/frontend/
_BASE = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).parent.parent)
_FRONTEND = _BASE / "frontend"
app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="static")
