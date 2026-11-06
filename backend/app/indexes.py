"""The embedding store: chunk embeddings saved per (documents, chunking, model), so they
can be browsed, mapped and searched on their own page.

Each index is data/indexes/<id>.json (metadata, chunk spans, 2D coordinates) plus
data/indexes/<id>.npy (the float32 vectors).
"""
from __future__ import annotations

import hashlib
import time

import numpy as np

from . import storage
from .chunking import chunk_documents

DIR = storage.DATA_DIR / "indexes"
DIR.mkdir(parents=True, exist_ok=True)


def docs_fingerprint(docs: list[dict]) -> str:
    h = hashlib.sha1()
    for d in sorted(docs, key=lambda d: d["id"]):
        h.update(d["id"].encode())
        h.update(hashlib.sha1(d["text"].encode()).digest())
    return h.hexdigest()[:16]


def _key(chunking: dict, model: str, fp: str) -> str:
    c = chunking
    return f"{model}|{c['strategy']}|{c['size']}|{c.get('overlap', 0)}|{fp}"


def list_indexes() -> list[dict]:
    fp = docs_fingerprint(storage.list_documents(include_text=True))
    out = []
    for p in DIR.glob("*.json"):
        m = storage._read(p, None)
        if not m:
            continue
        meta = {k: v for k, v in m.items() if k not in ("chunks",)}
        meta["stale"] = m["docs_fp"] != fp
        out.append(meta)
    return sorted(out, key=lambda m: m["created_at"], reverse=True)


def find(chunking: dict, model: str) -> dict | None:
    fp = docs_fingerprint(storage.list_documents(include_text=True))
    key = _key(chunking, model, fp)
    return next((m for m in list_indexes() if m.get("key") == key), None)


def get(index_id: str) -> dict | None:
    return storage._read(DIR / f"{index_id}.json", None)


def vectors(index_id: str) -> np.ndarray:
    return np.load(DIR / f"{index_id}.npy")


def delete(index_id: str) -> bool:
    p = DIR / f"{index_id}.json"
    if not p.exists():
        return False
    p.unlink()
    (DIR / f"{index_id}.npy").unlink(missing_ok=True)
    return True


def _project(V: np.ndarray) -> dict:
    """2D coordinates with PCA and t-SNE, both scaled to 0..1."""
    X = V.astype(np.float64)
    Xc = X - X.mean(axis=0)
    _, _, vt = np.linalg.svd(Xc, full_matrices=False)
    out = {"pca": Xc @ vt[:2].T}
    if len(X) >= 8:
        from sklearn.manifold import TSNE
        out["tsne"] = TSNE(n_components=2, perplexity=float(min(30, max(5, (len(X) - 1) // 3))), init="pca",
                           metric="cosine", random_state=0).fit_transform(X)
    else:
        out["tsne"] = out["pca"]
    for k, Y in out.items():
        out[k] = (Y - Y.min(axis=0)) / np.clip(Y.max(axis=0) - Y.min(axis=0), 1e-9, None)
    return out


def build(chunking: dict, model: str, on_step=lambda msg: None) -> dict:
    """Chunk the current documents, embed every chunk, project to 2D and save."""
    from .retrieval import Embedder, device_name
    docs = storage.list_documents(include_text=True)
    if not docs:
        raise ValueError("ยังไม่มีเอกสาร")
    fp = docs_fingerprint(docs)
    on_step("ตัด chunk")
    chunks = chunk_documents(docs, chunking["strategy"], chunking["size"], chunking.get("overlap", 0))
    on_step(f"โหลดโมเดล {model}")
    emb = Embedder(model)
    on_step(f"สร้าง embedding {len(chunks)} chunks")
    t0 = time.perf_counter()
    V = emb.passages([c.text for c in chunks]).astype(np.float32)
    secs = time.perf_counter() - t0
    on_step("คำนวณแผนที่ 2 มิติ")
    coords = _project(V)
    index_id = storage.new_id("idx")
    names = {d["id"]: d["name"] for d in docs}
    meta = {
        "id": index_id, "key": _key(chunking, model, fp), "model": model, "chunking": chunking, "docs_fp": fp,
        "n_chunks": len(chunks), "dim": int(V.shape[1]), "size_bytes": int(V.nbytes), "created_at": storage.now(),
        "encode_seconds": secs, "device": "api" if emb.api else device_name(),
        "docs": [{"id": d["id"], "name": d["name"]} for d in docs],
        "chunks": [{"id": c.id, "doc_id": c.doc_id, "doc_name": names.get(c.doc_id), "number": int(c.id.rsplit(":", 1)[1]) + 1,
                    "start": c.start, "end": c.end, "text": c.text,
                    "pca": [round(float(coords["pca"][i, 0]), 4), round(float(coords["pca"][i, 1]), 4)],
                    "tsne": [round(float(coords["tsne"][i, 0]), 4), round(float(coords["tsne"][i, 1]), 4)]}
                   for i, c in enumerate(chunks)],
    }
    np.save(DIR / f"{index_id}.npy", V)
    storage._write(DIR / f"{index_id}.json", meta)
    return {k: v for k, v in meta.items() if k != "chunks"}


def _place(sims: np.ndarray, chunks: list[dict], method: str, k: int = 5) -> list[float]:
    """Put a query on the map at the similarity-weighted centre of its nearest chunks.
    A 2D projection cannot place a new point exactly, so this shows where it belongs."""
    top = np.argsort(-sims)[:k]
    w = np.exp((sims[top] - sims[top].max()) * 20)
    w = w / w.sum()
    pts = np.array([chunks[i][method] for i in top])
    return [float(x) for x in (w[:, None] * pts).sum(axis=0)]


def search(index_id: str, query: str, k: int = 5) -> dict:
    from .retrieval import Embedder
    meta = get(index_id)
    if not meta:
        raise ValueError("ไม่พบ index")
    V = vectors(index_id)
    t0 = time.perf_counter()
    q = Embedder(meta["model"]).query(query)
    sims = V @ q
    ms = (time.perf_counter() - t0) * 1000
    top = np.argsort(-sims)[:k]
    return {"ms": ms, "hits": [{"id": meta["chunks"][i]["id"], "score": float(sims[i])} for i in top],
            "pos": {"pca": _place(sims, meta["chunks"], "pca"), "tsne": _place(sims, meta["chunks"], "tsne")}}


def neighbors(index_id: str, chunk_id: str, k: int = 5) -> list[dict]:
    meta = get(index_id)
    if not meta:
        raise ValueError("ไม่พบ index")
    ids = [c["id"] for c in meta["chunks"]]
    if chunk_id not in ids:
        raise ValueError("ไม่พบ chunk")
    V = vectors(index_id)
    i = ids.index(chunk_id)
    sims = V @ V[i]
    order = [j for j in np.argsort(-sims) if j != i][:k]
    return [{"id": ids[j], "score": float(sims[j])} for j in order]
