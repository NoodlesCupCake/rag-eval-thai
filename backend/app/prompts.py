"""Query / passage prompts per embedding model.

Many embedding models are trained with a role prefix on the text, and score noticeably
lower without it (e5 with "query: "/"passage: ", Qwen3-Embedding with an instruction on
queries only, nomic with "search_query: "/"search_document: "). Known families get their
documented prompt by default; any model can be overridden on the Settings page, saved in
data/model_prompts.json.
"""
from __future__ import annotations

import re

from . import storage

FILE = storage.DATA_DIR / "model_prompts.json"

QWEN_TASK = "Given a question, retrieve passages from the documents that answer it"

# (pattern on the lower-cased model name, query prefix, passage prefix, source note)
DEFAULTS: list[tuple[str, str, str, str]] = [
    (r"(^|[/:_-])e5([-_.]|$)", "query: ", "passage: ", "multilingual-e5 / e5 model card"),
    (r"qwen3[-_]?embedding", f"Instruct: {QWEN_TASK}\nQuery: ", "", "Qwen3-Embedding model card: instruction on queries only"),
    (r"nomic-embed", "search_query: ", "search_document: ", "nomic-embed-text model card"),
    (r"mxbai-embed", "Represent this sentence for searching relevant passages: ", "", "mxbai-embed-large model card"),
    (r"bge-(small|base|large)-(en|zh)", "Represent this sentence for searching relevant passages: ", "", "BGE v1.5 model card (English/Chinese models)"),
    (r"snowflake-arctic-embed", "Represent this sentence for searching relevant passages: ", "", "arctic-embed model card"),
]


def _model_part(name: str) -> str:
    """'api:<provider>:<model>' -> '<model>'; Hugging Face ids stay as they are."""
    return name.split(":", 2)[2] if name.startswith("api:") else name


def default_for(name: str) -> dict:
    n = _model_part(name).lower()
    for pat, q, p, note in DEFAULTS:
        if re.search(pat, n):
            return {"query": q, "passage": p, "source": "default", "note": note}
    return {"query": "", "passage": "", "source": "none", "note": "ไม่มี prompt ที่แนะนำสำหรับโมเดลนี้"}


def custom() -> dict:
    return storage._read(FILE, {})


def get(name: str) -> dict:
    """Effective prompts for a model: the saved override, else the documented default."""
    c = custom().get(name)
    if c is not None:
        return {"query": c.get("query", ""), "passage": c.get("passage", ""), "source": "custom", "note": "ตั้งเอง"}
    return default_for(name)


def set_custom(name: str, query: str, passage: str) -> dict:
    data = custom()
    data[name] = {"query": query, "passage": passage}
    storage._write(FILE, data)
    return get(name)


def reset(name: str) -> dict:
    data = custom()
    data.pop(name, None)
    storage._write(FILE, data)
    return get(name)


def tag(name: str) -> str:
    """Short fingerprint of the prompts, so caches and indexes built with other prompts
    are not reused."""
    import hashlib
    p = get(name)
    return hashlib.sha1((p["query"] + "\x00" + p["passage"]).encode()).hexdigest()[:8]
