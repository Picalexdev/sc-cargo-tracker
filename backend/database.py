import math
import os
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

if getattr(sys, "_MEIPASS", None):
    # Frozen: write DB to %LOCALAPPDATA%\SC Cargo Tracker\ so it survives updates
    # and works even when the exe is installed to Program Files (read-only for users).
    _appdata = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    _db_dir  = _appdata / "SC Cargo Tracker"
    _db_dir.mkdir(parents=True, exist_ok=True)
    DB_PATH  = _db_dir / "cargo_tracking.db"
else:
    DB_PATH = Path(__file__).parent.parent / "cargo_tracking.db"

_SEED_MATERIALS = ["Titanium", "Silicon", "Aluminum", "Carbon"]

_SEED_DESTINATIONS = [
    {"name": "Lorville",            "quantities": {"Titanium": 7, "Silicon": None, "Aluminum": 7, "Carbon": None}},
    {"name": "Sakura Sun Magnolia", "quantities": {"Titanium": 6, "Silicon": 4,    "Aluminum": 9, "Carbon": None}},
    {"name": "HDPC-Farnesway",      "quantities": {"Titanium": 5, "Silicon": 3,    "Aluminum": 5, "Carbon": None}},
    {"name": "HDPC-Cassillo",       "quantities": {"Titanium": 3, "Silicon": 5,    "Aluminum": None, "Carbon": None}},
]


@contextmanager
def _conn():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _add_col(con, table: str, column: str, definition: str):
    existing = [r["name"] for r in con.execute(f"PRAGMA table_info({table})")]
    if column not in existing:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db():
    with _conn() as con:
        # ── core tables ──────────────────────────────────────────────────────
        con.executescript("""
            CREATE TABLE IF NOT EXISTS materials (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS destinations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS quantities (
                dest_id  INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
                mat_id   INTEGER NOT NULL REFERENCES materials(id)   ON DELETE CASCADE,
                quantity INTEGER,
                PRIMARY KEY (dest_id, mat_id)
            );
        """)

        # ── current-run tables ───────────────────────────────────────────────
        con.executescript("""
            CREATE TABLE IF NOT EXISTS missions (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                reward           INTEGER,
                contracted_by    TEXT,
                pickup_location  TEXT,
                sort_order       INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS mission_deliveries (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
                mat_name   TEXT    NOT NULL,
                mat_id     INTEGER,
                dest_name  TEXT    NOT NULL,
                dest_id    INTEGER,
                quantity   INTEGER NOT NULL
            );
        """)
        # safe migration for DBs created before these columns existed
        _add_col(con, "missions", "contracted_by",   "TEXT")
        _add_col(con, "missions", "pickup_location",  "TEXT")

        # ── history tables ───────────────────────────────────────────────────
        con.executescript("""
            CREATE TABLE IF NOT EXISTS runs (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                completed_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime')),
                mission_count         INTEGER NOT NULL DEFAULT 0,
                total_base_reward     INTEGER NOT NULL DEFAULT 0,
                total_effective_reward INTEGER NOT NULL DEFAULT 0,
                total_base_scu        INTEGER NOT NULL DEFAULT 0,
                total_effective_scu   INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS run_missions (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id              INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                reward              INTEGER,
                completion_pct      INTEGER NOT NULL,
                effective_reward    INTEGER,
                contracted_by       TEXT,
                pickup_location     TEXT
            );
            CREATE TABLE IF NOT EXISTS run_deliveries (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                run_mission_id    INTEGER NOT NULL REFERENCES run_missions(id) ON DELETE CASCADE,
                mat_name          TEXT    NOT NULL,
                dest_name         TEXT    NOT NULL,
                base_quantity     INTEGER NOT NULL,
                effective_quantity INTEGER NOT NULL
            );
        """)

        # ── destination aliases ──────────────────────────────────────────────
        con.executescript("""
            CREATE TABLE IF NOT EXISTS dest_aliases (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                alias   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                dest_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE
            );
        """)

        if con.execute("SELECT COUNT(*) FROM materials").fetchone()[0] == 0:
            _seed(con)

        # Seed default aliases (only once, only if Lorville exists)
        if con.execute("SELECT COUNT(*) FROM dest_aliases").fetchone()[0] == 0:
            lorville = con.execute(
                "SELECT id FROM destinations WHERE name = 'Lorville' COLLATE NOCASE"
            ).fetchone()
            if lorville:
                for alias in ["Teasa Spaceport", "Teasa Station"]:
                    con.execute(
                        "INSERT OR IGNORE INTO dest_aliases (alias, dest_id) VALUES (?, ?)",
                        (alias, lorville["id"]),
                    )


def _seed(con):
    for i, name in enumerate(_SEED_MATERIALS):
        con.execute("INSERT INTO materials (name, sort_order) VALUES (?, ?)", (name, i))
    mat_ids = {r["name"]: r["id"] for r in con.execute("SELECT id, name FROM materials")}
    for i, dest in enumerate(_SEED_DESTINATIONS):
        con.execute("INSERT INTO destinations (name, sort_order) VALUES (?, ?)", (dest["name"], i))
        did = con.execute("SELECT last_insert_rowid()").fetchone()[0]
        for mat_name, qty in dest["quantities"].items():
            mid = mat_ids.get(mat_name)
            if mid is not None:
                con.execute("INSERT INTO quantities (dest_id, mat_id, quantity) VALUES (?, ?, ?)", (did, mid, qty))


# ── reads ──────────────────────────────────────────────────────────────────────

def get_materials() -> list[dict]:
    with _conn() as con:
        return [dict(r) for r in con.execute("SELECT id, name FROM materials ORDER BY sort_order, id")]


def get_destinations() -> list[dict]:
    with _conn() as con:
        return [dict(r) for r in con.execute("SELECT id, name FROM destinations ORDER BY sort_order, id")]


def get_matrix() -> dict:
    with _conn() as con:
        materials    = [dict(r) for r in con.execute("SELECT id, name FROM materials ORDER BY sort_order, id")]
        destinations = [dict(r) for r in con.execute("SELECT id, name FROM destinations ORDER BY sort_order, id")]
        qtys = {(r["dest_id"], r["mat_id"]): r["quantity"]
                for r in con.execute("SELECT dest_id, mat_id, quantity FROM quantities")}
    return {
        "materials": materials,
        "destinations": [{
            "id":   d["id"],
            "name": d["name"],
            "quantities": {str(m["id"]): qtys.get((d["id"], m["id"])) for m in materials},
        } for d in destinations],
    }


# ── materials ──────────────────────────────────────────────────────────────────

def add_material(name: str) -> dict:
    with _conn() as con:
        if con.execute("SELECT id FROM materials WHERE name = ? COLLATE NOCASE", (name,)).fetchone():
            raise ValueError(f"Material '{name}' already exists")
        max_ord = con.execute("SELECT COALESCE(MAX(sort_order),0) FROM materials").fetchone()[0]
        con.execute("INSERT INTO materials (name, sort_order) VALUES (?, ?)", (name, max_ord + 1))
        mid = con.execute("SELECT last_insert_rowid()").fetchone()[0]
        con.execute("INSERT INTO quantities (dest_id, mat_id, quantity) SELECT id, ?, NULL FROM destinations", (mid,))
        return {"id": mid, "name": name}


def delete_material(mat_id: int):
    with _conn() as con:
        con.execute("DELETE FROM materials WHERE id = ?", (mat_id,))


# ── destinations ───────────────────────────────────────────────────────────────

def add_destination(name: str) -> dict:
    with _conn() as con:
        max_ord = con.execute("SELECT COALESCE(MAX(sort_order),0) FROM destinations").fetchone()[0]
        con.execute("INSERT INTO destinations (name, sort_order) VALUES (?, ?)", (name, max_ord + 1))
        did = con.execute("SELECT last_insert_rowid()").fetchone()[0]
        con.execute("INSERT INTO quantities (dest_id, mat_id, quantity) SELECT ?, id, NULL FROM materials", (did,))
        return {"id": did, "name": name}


def update_destination(dest_id: int, name: str):
    with _conn() as con:
        con.execute("UPDATE destinations SET name = ? WHERE id = ?", (name, dest_id))


def delete_destination(dest_id: int):
    with _conn() as con:
        con.execute("DELETE FROM destinations WHERE id = ?", (dest_id,))


# ── quantities ─────────────────────────────────────────────────────────────────

def set_quantity(dest_id: int, mat_id: int, quantity: Optional[int]):
    with _conn() as con:
        con.execute("INSERT OR REPLACE INTO quantities (dest_id, mat_id, quantity) VALUES (?, ?, ?)", (dest_id, mat_id, quantity))


# ── missions (current run) ─────────────────────────────────────────────────────

def get_missions() -> list[dict]:
    with _conn() as con:
        missions   = [dict(r) for r in con.execute("SELECT id, reward, contracted_by, pickup_location FROM missions ORDER BY sort_order, id")]
        deliveries = [dict(r) for r in con.execute("SELECT id, mission_id, mat_name, mat_id, dest_name, dest_id, quantity FROM mission_deliveries ORDER BY id")]
    by_mission: dict[int, list] = {}
    for d in deliveries:
        by_mission.setdefault(d["mission_id"], []).append(d)
    for m in missions:
        m["deliveries"] = by_mission.get(m["id"], [])
    return missions


def create_mission(reward: Optional[int], deliveries: list[dict],
                   contracted_by: Optional[str] = None,
                   pickup_location: Optional[str] = None) -> dict:
    with _conn() as con:
        max_ord = con.execute("SELECT COALESCE(MAX(sort_order),0) FROM missions").fetchone()[0]
        con.execute(
            "INSERT INTO missions (reward, contracted_by, pickup_location, sort_order) VALUES (?, ?, ?, ?)",
            (reward, contracted_by, pickup_location, max_ord + 1),
        )
        mid = con.execute("SELECT last_insert_rowid()").fetchone()[0]
        for d in deliveries:
            con.execute(
                "INSERT INTO mission_deliveries (mission_id, mat_name, mat_id, dest_name, dest_id, quantity) VALUES (?, ?, ?, ?, ?, ?)",
                (mid, d["mat_name"], d.get("mat_id"), d["dest_name"], d.get("dest_id"), d["quantity"]),
            )
        rows = [dict(r) for r in con.execute(
            "SELECT id, mission_id, mat_name, mat_id, dest_name, dest_id, quantity FROM mission_deliveries WHERE mission_id = ? ORDER BY id", (mid,)
        )]
        return {"id": mid, "reward": reward, "contracted_by": contracted_by, "pickup_location": pickup_location, "deliveries": rows}


def delete_mission(mission_id: int):
    with _conn() as con:
        con.execute("DELETE FROM missions WHERE id = ?", (mission_id,))


def clear_missions():
    with _conn() as con:
        con.execute("DELETE FROM missions")


def apply_mission(mission_id: int, completion_pct: int) -> None:
    if completion_pct not in (25, 50, 75, 100):
        raise ValueError("completion_pct must be 25, 50, 75, or 100")
    with _conn() as con:
        deliveries = [dict(r) for r in con.execute("SELECT * FROM mission_deliveries WHERE mission_id = ?", (mission_id,))]
        for d in deliveries:
            mat_id  = d["mat_id"]
            dest_id = d["dest_id"]
            if mat_id is None:
                row = con.execute("SELECT id FROM materials WHERE name = ? COLLATE NOCASE", (d["mat_name"],)).fetchone()
                if row:
                    mat_id = row["id"]
                    con.execute("UPDATE mission_deliveries SET mat_id = ? WHERE id = ?", (mat_id, d["id"]))
                else:
                    max_ord = con.execute("SELECT COALESCE(MAX(sort_order),0) FROM materials").fetchone()[0]
                    con.execute("INSERT INTO materials (name, sort_order) VALUES (?, ?)", (d["mat_name"], max_ord + 1))
                    mat_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
                    con.execute("INSERT INTO quantities (dest_id, mat_id, quantity) SELECT id, ?, NULL FROM destinations", (mat_id,))
                    con.execute("UPDATE mission_deliveries SET mat_id = ? WHERE id = ?", (mat_id, d["id"]))
            if dest_id is None:
                continue
            effective = max(1, math.ceil(d["quantity"] * completion_pct / 100))
            existing  = con.execute("SELECT quantity FROM quantities WHERE dest_id = ? AND mat_id = ?", (dest_id, mat_id)).fetchone()
            new_qty   = (existing["quantity"] or 0) + effective if (existing and existing["quantity"] is not None) else effective
            con.execute("INSERT OR REPLACE INTO quantities (dest_id, mat_id, quantity) VALUES (?, ?, ?)", (dest_id, mat_id, new_qty))


# ── end run ────────────────────────────────────────────────────────────────────

def end_run(entries: list[dict]) -> None:
    """Save a history snapshot then apply + clear all missions."""
    # 1. Snapshot to history
    with _conn() as con:
        total_base_reward      = 0
        total_effective_reward = 0
        total_base_scu         = 0
        total_effective_scu    = 0

        con.execute(
            "INSERT INTO runs (mission_count) VALUES (?)",
            (len(entries),),
        )
        run_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]

        for entry in entries:
            pct = entry["completion_pct"]
            m   = dict(con.execute(
                "SELECT id, reward, contracted_by, pickup_location FROM missions WHERE id = ?",
                (entry["mission_id"],),
            ).fetchone() or {})
            if not m:
                continue

            deliveries = [dict(r) for r in con.execute(
                "SELECT mat_name, dest_name, quantity FROM mission_deliveries WHERE mission_id = ?",
                (m["id"],),
            )]

            eff_reward = math.ceil(m["reward"] * pct / 100) if m.get("reward") else None

            con.execute(
                "INSERT INTO run_missions (run_id, reward, completion_pct, effective_reward, contracted_by, pickup_location) VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, m.get("reward"), pct, eff_reward, m.get("contracted_by"), m.get("pickup_location")),
            )
            rm_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]

            for d in deliveries:
                eff_qty = max(1, math.ceil(d["quantity"] * pct / 100))
                con.execute(
                    "INSERT INTO run_deliveries (run_mission_id, mat_name, dest_name, base_quantity, effective_quantity) VALUES (?, ?, ?, ?, ?)",
                    (rm_id, d["mat_name"], d["dest_name"], d["quantity"], eff_qty),
                )
                total_base_scu      += d["quantity"]
                total_effective_scu += eff_qty

            if m.get("reward"):
                total_base_reward += m["reward"]
            if eff_reward:
                total_effective_reward += eff_reward

        con.execute(
            "UPDATE runs SET total_base_reward=?, total_effective_reward=?, total_base_scu=?, total_effective_scu=? WHERE id=?",
            (total_base_reward, total_effective_reward, total_base_scu, total_effective_scu, run_id),
        )

    # 2. Apply quantities to matrix
    for entry in entries:
        apply_mission(entry["mission_id"], entry["completion_pct"])

    # 3. Delete missions
    with _conn() as con:
        for entry in entries:
            con.execute("DELETE FROM missions WHERE id = ?", (entry["mission_id"],))


# ── history ────────────────────────────────────────────────────────────────────

def delete_run(run_id: int):
    with _conn() as con:
        con.execute("DELETE FROM runs WHERE id = ?", (run_id,))


def get_history() -> dict:
    with _conn() as con:
        runs = [dict(r) for r in con.execute(
            "SELECT id, completed_at, mission_count, total_base_reward, total_effective_reward, total_base_scu, total_effective_scu FROM runs ORDER BY id DESC"
        )]
        run_missions = [dict(r) for r in con.execute(
            "SELECT id, run_id, reward, completion_pct, effective_reward, contracted_by, pickup_location FROM run_missions ORDER BY id"
        )]
        deliveries = [dict(r) for r in con.execute(
            "SELECT id, run_mission_id, mat_name, dest_name, base_quantity, effective_quantity FROM run_deliveries ORDER BY id"
        )]

    del_by_rm: dict[int, list] = {}
    for d in deliveries:
        del_by_rm.setdefault(d["run_mission_id"], []).append(d)

    rm_by_run: dict[int, list] = {}
    for rm in run_missions:
        rm["deliveries"] = del_by_rm.get(rm["id"], [])
        rm_by_run.setdefault(rm["run_id"], []).append(rm)

    for r in runs:
        r["missions"] = rm_by_run.get(r["id"], [])

    total_runs   = len(runs)
    total_earned = sum(r["total_effective_reward"] for r in runs)
    total_scu    = sum(r["total_effective_scu"]    for r in runs)

    return {
        "summary": {
            "total_runs":   total_runs,
            "total_earned": total_earned,
            "total_scu":    total_scu,
        },
        "runs": runs,
    }


# ── destination aliases ────────────────────────────────────────────────────────

def get_aliases() -> list[dict]:
    with _conn() as con:
        return [dict(r) for r in con.execute("""
            SELECT a.id, a.alias, a.dest_id, d.name AS dest_name
            FROM dest_aliases a
            JOIN destinations d ON d.id = a.dest_id
            ORDER BY a.alias COLLATE NOCASE
        """)]


def add_alias(alias: str, dest_id: int) -> dict:
    with _conn() as con:
        if con.execute(
            "SELECT id FROM dest_aliases WHERE alias = ? COLLATE NOCASE", (alias,)
        ).fetchone():
            raise ValueError(f"Alias '{alias}' already exists")
        con.execute("INSERT INTO dest_aliases (alias, dest_id) VALUES (?, ?)", (alias, dest_id))
        aid       = con.execute("SELECT last_insert_rowid()").fetchone()[0]
        dest_name = con.execute("SELECT name FROM destinations WHERE id = ?", (dest_id,)).fetchone()["name"]
        return {"id": aid, "alias": alias, "dest_id": dest_id, "dest_name": dest_name}


def delete_alias(alias_id: int):
    with _conn() as con:
        con.execute("DELETE FROM dest_aliases WHERE id = ?", (alias_id,))
