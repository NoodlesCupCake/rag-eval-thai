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
QA_FILE = DATA_DIR / "qa.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
SAMPLES_DIR = ROOT / "samples"

for d in (DOCS_DIR, RUNS_DIR):
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
        items = [q for q in list_qa() if all(e["doc_id"] != doc_id for e in q["evidence"])]
        _write(QA_FILE, items)
    return True


# ---------- QA set ----------

def list_qa() -> list[dict]:
    with _lock:
        return _read(QA_FILE, [])


def save_qa(items: list[dict]) -> None:
    with _lock:
        _write(QA_FILE, items)


def add_qa(items: list[dict]) -> list[dict]:
    with _lock:
        current = list_qa()
        for it in items:
            it.setdefault("id", new_id("qa"))
            it.setdefault("created_at", now())
        current.extend(items)
        _write(QA_FILE, current)
    return items


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
        out.append({k: r.get(k) for k in ("id", "name", "status", "created_at", "finished_at", "n_questions", "error")}
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
