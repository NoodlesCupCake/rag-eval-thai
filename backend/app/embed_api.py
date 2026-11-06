"""Embedding models served over an API: Voyage AI, OpenAI, and any OpenAI-compatible
/v1/embeddings server (Ollama, LM Studio, vLLM).

Providers are saved in data/embedding_providers.json. A retriever refers to one model as
"api:<provider id>:<model>", so the rest of the app treats it like any other model name.
"""
from __future__ import annotations

import re
import time

import numpy as np

from . import storage

FILE = storage.DATA_DIR / "embedding_providers.json"
PREFIX = "api:"
BATCH = 64

PRESETS = [
    {"id": "voyage", "label": "Voyage AI", "kind": "voyage", "base_url": "https://api.voyageai.com/v1",
     "models": "voyage-3.5, voyage-3-large, voyage-multilingual-2", "needs_key": True},
    {"id": "openai", "label": "OpenAI", "kind": "openai", "base_url": "https://api.openai.com/v1",
     "models": "text-embedding-3-small, text-embedding-3-large", "needs_key": True},
    {"id": "ollama", "label": "Ollama", "kind": "openai", "base_url": "http://localhost:11434/v1",
     "models": "bge-m3, nomic-embed-text", "needs_key": False},
    {"id": "custom", "label": "OpenAI-compatible อื่น ๆ", "kind": "openai", "base_url": "", "models": "", "needs_key": False},
]


class EmbedAPIError(RuntimeError):
    pass


# ---------- providers ----------

def _read() -> list[dict]:
    return storage._read(FILE, [])


def list_providers(mask: bool = True) -> list[dict]:
    out = []
    for p in _read():
        q = dict(p)
        if mask:
            key = q.pop("api_key", "")
            q["api_key_set"] = bool(key)
            q["api_key_hint"] = f"…{key[-4:]}" if len(key) > 8 else ""
        out.append(q)
    return out


def get_provider(pid: str) -> dict | None:
    return next((p for p in _read() if p["id"] == pid), None)


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "provider"


def save_provider(p: dict) -> dict:
    items = _read()
    old = next((x for x in items if x["id"] == p.get("id")), None)
    if not old:
        base, n, ids = _slug(p.get("name") or p["kind"]), 1, {x["id"] for x in items}
        pid = base
        while pid in ids:
            n += 1
            pid = f"{base}-{n}"
        p["id"] = pid
    if p.get("api_key") is None:  # keep the saved key
        p["api_key"] = old.get("api_key", "") if old else ""
    p["models"] = [m.strip() for m in (p.get("models") or []) if m.strip()]
    clean = {k: p.get(k) for k in ("id", "name", "kind", "base_url", "api_key", "models")}
    clean["base_url"] = (clean["base_url"] or "").strip().rstrip("/")
    items = [x for x in items if x["id"] != clean["id"]] + [clean]
    storage._write(FILE, items)
    return next(x for x in list_providers() if x["id"] == clean["id"])


def delete_provider(pid: str) -> bool:
    items = _read()
    if not any(x["id"] == pid for x in items):
        return False
    storage._write(FILE, [x for x in items if x["id"] != pid])
    return True


def model_ids() -> list[dict]:
    """Every API model as a selectable retriever model id."""
    return [{"id": f"{PREFIX}{p['id']}:{m}", "note": f"API · {p['name']} · คิดเงินตามผู้ให้บริการ", "api": True}
            for p in _read() for m in p.get("models", [])]


def parse(name: str) -> tuple[dict, str]:
    """'api:<provider>:<model>' -> (provider, model)."""
    rest = name[len(PREFIX):]
    pid, _, model = rest.partition(":")
    p = get_provider(pid)
    if not p:
        raise EmbedAPIError(f"ไม่พบผู้ให้บริการ embedding “{pid}” ในหน้าตั้งค่า")
    return p, model


# ---------- calling the APIs ----------

def _voyage(p: dict, model: str, texts: list[str], input_type: str) -> list[list[float]]:
    """Voyage's own API (not OpenAI-compatible: it takes input_type query/document)."""
    import json
    import urllib.error
    import urllib.request
    url = (p["base_url"] or "https://api.voyageai.com/v1") + "/embeddings"
    body = json.dumps({"input": texts, "model": model, "input_type": input_type}).encode()
    for attempt in range(5):
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": f"Bearer {p.get('api_key', '')}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = sorted(json.loads(r.read())["data"], key=lambda d: d["index"])
                return [d["embedding"] for d in data]
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(min(2 ** attempt, 20))
                continue
            if e.code == 401:
                raise EmbedAPIError("API key ไม่ถูกต้อง") from e
            raise EmbedAPIError(f"Voyage error {e.code}: {e.read()[:200].decode(errors='replace')}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            raise EmbedAPIError(f"เชื่อมต่อ {url} ไม่ได้: {e}") from e
    raise EmbedAPIError("Voyage ตอบช้าหรือจำกัดอัตรา ลองใหม่ภายหลัง")


def _openai(p: dict, model: str, texts: list[str]) -> list[list[float]]:
    import openai
    client = openai.OpenAI(api_key=p.get("api_key") or "not-needed", base_url=p["base_url"], max_retries=4, timeout=120)
    try:
        r = client.embeddings.create(model=model, input=texts)
    except openai.AuthenticationError as e:
        raise EmbedAPIError("API key ไม่ถูกต้อง") from e
    except openai.NotFoundError as e:
        raise EmbedAPIError(f"ไม่พบโมเดล {model} หรือ base URL ผิด") from e
    except openai.APIConnectionError as e:
        raise EmbedAPIError(f"เชื่อมต่อ {p['base_url']} ไม่ได้") from e
    except openai.APIStatusError as e:
        raise EmbedAPIError(f"API error {e.status_code}: {e.message}") from e
    return [d.embedding for d in sorted(r.data, key=lambda d: d.index)]


def embed(name: str, texts: list[str], kind: str) -> np.ndarray:
    """kind is "query" or "document". Returns L2-normalised vectors."""
    p, model = parse(name)
    out: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        batch = [t if t.strip() else " " for t in texts[i:i + BATCH]]
        out += _voyage(p, model, batch, kind) if p["kind"] == "voyage" else _openai(p, model, batch)
    m = np.asarray(out, dtype=np.float32)
    return m / np.clip(np.linalg.norm(m, axis=1, keepdims=True), 1e-12, None)


def test(p: dict, model: str) -> dict:
    t0 = time.perf_counter()
    v = (_voyage(p, model, ["ทดสอบการเชื่อมต่อ"], "query") if p["kind"] == "voyage" else _openai(p, model, ["ทดสอบการเชื่อมต่อ"]))[0]
    return {"ok": True, "model": model, "dim": len(v), "ms": (time.perf_counter() - t0) * 1000}
