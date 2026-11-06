"""Plain JSON-file storage under data/. Small, inspectable, easy to back up or commit."""
from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
DOCS_DIR = DATA_DIR / "documents"
RUNS_DIR = DATA_DIR / "runs"
QA_FILE = DATA_DIR / "qa.json"          # before QA sets existed; migrated on start
QA_DIR = DATA_DIR / "qa"
SETS_FILE = DATA_DIR / "qa_sets.json"
DEFAULT_SET = "set_main"
SETTINGS_FILE = DATA_DIR / "settings.json"
SAMPLES_DIR = ROOT / "samples"

for d in (DOCS_DIR, RUNS_DIR, QA_DIR):
    d.mkdir(parents=True, exist_ok=True)

_lock = threading.RLock()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def now() -> float:
    return time.time()


def _read(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, data: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


# ---------- documents ----------

def list_documents(include_text: bool = False) -> list[dict]:
    with _lock:
        docs = [_read(p, None) for p in sorted(DOCS_DIR.glob("*.json"))]
    docs = [d for d in docs if d]
    docs.sort(key=lambda d: d["created_at"])
    if not include_text:
        docs = [{k: v for k, v in d.items() if k != "text"} | {"chars": len(d["text"])} for d in docs]
    return docs


def get_document(doc_id: str) -> dict | None:
    with _lock:
        return _read(DOCS_DIR / f"{doc_id}.json", None)


def add_document(name: str, text: str) -> dict:
    doc = {"id": new_id("doc"), "name": name, "text": text, "created_at": now()}
    with _lock:
        _write(DOCS_DIR / f"{doc['id']}.json", doc)
    return doc


def delete_document(doc_id: str) -> bool:
    path = DOCS_DIR / f"{doc_id}.json"
    with _lock:
        if not path.exists():
            return False
        path.unlink()
        # QA items whose evidence lived in this document no longer have ground truth.
        for st in list_sets():
            items = [q for q in list_qa(st["id"]) if all(e["doc_id"] != doc_id for e in q["evidence"])]
            save_qa(st["id"], items)
    return True


# ---------- QA sets ----------
# Each set is its own file under data/qa/, so sets stay independent and easy to share.

def _migrate() -> None:
    with _lock:
        if SETS_FILE.exists():
            return
        sets = [{"id": DEFAULT_SET, "name": "ชุดหลัก", "created_at": now()}]
        if QA_FILE.exists():
            _write(QA_DIR / f"{DEFAULT_SET}.json", _read(QA_FILE, []))
            QA_FILE.rename(QA_FILE.with_suffix(".json.migrated"))
        _write(SETS_FILE, sets)


def list_sets() -> list[dict]:
    _migrate()
    with _lock:
        sets = _read(SETS_FILE, [])
    return [st | {"count": len(_read(QA_DIR / f"{st['id']}.json", []))} for st in sets]


def get_set(set_id: str) -> dict | None:
    return next((st for st in list_sets() if st["id"] == set_id), None)


def create_set(name: str) -> dict:
    _migrate()
    st = {"id": new_id("set"), "name": name.strip() or "ชุดใหม่", "created_at": now()}
    with _lock:
        _write(SETS_FILE, _read(SETS_FILE, []) + [st])
        _write(QA_DIR / f"{st['id']}.json", [])
    return st | {"count": 0}


def find_or_create_set(name: str) -> dict:
    return next((st for st in list_sets() if st["name"] == name), None) or create_set(name)


def rename_set(set_id: str, name: str) -> dict | None:
    with _lock:
        sets = _read(SETS_FILE, [])
        for st in sets:
            if st["id"] == set_id:
                st["name"] = name.strip() or st["name"]
                _write(SETS_FILE, sets)
                return get_set(set_id)
    return None


def delete_set(set_id: str) -> bool:
    with _lock:
        sets = _read(SETS_FILE, [])
        if len(sets) <= 1 or not any(st["id"] == set_id for st in sets):
            return False
        _write(SETS_FILE, [st for st in sets if st["id"] != set_id])
        (QA_DIR / f"{set_id}.json").unlink(missing_ok=True)
    return True


def resolve_set(set_id: str | None) -> str:
    """The set to use: the given one, else the first set."""
    sets = list_sets()
    if set_id and any(st["id"] == set_id for st in sets):
        return set_id
    return sets[0]["id"]


def list_qa(set_id: str | None = None) -> list[dict]:
    with _lock:
        return _read(QA_DIR / f"{resolve_set(set_id)}.json", [])


def save_qa(set_id: str | None, items: list[dict]) -> None:
    with _lock:
        _write(QA_DIR / f"{resolve_set(set_id)}.json", items)


def add_qa(set_id: str | None, items: list[dict]) -> list[dict]:
    with _lock:
        current = list_qa(set_id)
        for it in items:
            it.setdefault("id", new_id("qa"))
            it.setdefault("created_at", now())
        current.extend(items)
        save_qa(set_id, current)
    return items


def count_qa() -> int:
    return sum(st["count"] for st in list_sets())


# ---------- runs ----------

def save_run(run: dict) -> None:
    with _lock:
        _write(RUNS_DIR / f"{run['id']}.json", run)


def get_run(run_id: str) -> dict | None:
    with _lock:
        return _read(RUNS_DIR / f"{run_id}.json", None)


def list_runs() -> list[dict]:
    with _lock:
        runs = [_read(p, None) for p in RUNS_DIR.glob("*.json")]
    out = []
    for r in runs:
        if not r:
            continue
        kind = r.get("kind") or ("rag" if (r.get("spec", {}).get("generation") or {}).get("enabled") else "retrieval")
        out.append({k: r.get(k) for k in ("id", "name", "status", "created_at", "finished_at", "n_questions", "error", "qa_set")}
                   | {"kind": kind}
                   | {"n_configs": len(r.get("results", [])), "summary": [res["metrics"] | {"label": res["label"]} for res in r.get("results", [])]})
    out.sort(key=lambda r: r["created_at"], reverse=True)
    return out


def delete_run(run_id: str) -> bool:
    path = RUNS_DIR / f"{run_id}.json"
    with _lock:
        if path.exists():
            path.unlink()
            return True
    return False


# ---------- settings ----------

def get_settings() -> dict:
    with _lock:
        return _read(SETTINGS_FILE, {})


def save_settings(data: dict) -> None:
    with _lock:
        _write(SETTINGS_FILE, data)
