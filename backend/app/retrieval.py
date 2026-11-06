"""Retrievers: dense (sentence-transformers), BM25 over Thai word tokens, and hybrid (RRF)."""
from __future__ import annotations

import threading
import time
import unicodedata
from functools import lru_cache

import numpy as np

from .chunking import Chunk, _tokenizer

RETRIEVER_TYPES = ("dense", "bm25", "hybrid")

SUGGESTED_MODELS = [
    {"id": "intfloat/multilingual-e5-small", "note": "118M · fast, a good first baseline"},
    {"id": "intfloat/multilingual-e5-base", "note": "278M"},
    {"id": "BAAI/bge-m3", "note": "568M · strong on Thai, slower"},
    {"id": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", "note": "118M · older baseline"},
]


# ---------- embeddings ----------

_model_lock = threading.Lock()


@lru_cache(maxsize=3)
def _load_model(name: str):
    from sentence_transformers import SentenceTransformer
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return SentenceTransformer(name, device=device)


def device_name() -> str:
    try:
        import torch
        return torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    except Exception:
        return "unknown"


def _prefixes(name: str) -> tuple[str, str]:
    """Some model families are trained with role prefixes and lose accuracy without them."""
    n = name.lower()
    if "e5" in n:
        return "query: ", "passage: "
    return "", ""


class Embedder:
    def __init__(self, name: str):
        self.name = name
        with _model_lock:
            self.model = _load_model(name)
        self.q_prefix, self.p_prefix = _prefixes(name)

    def passages(self, texts: list[str]) -> np.ndarray:
        return self.model.encode([self.p_prefix + t for t in texts], batch_size=32,
                                 normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)

    def query(self, text: str) -> np.ndarray:
        return self.model.encode([self.q_prefix + text], normalize_embeddings=True,
                                 convert_to_numpy=True, show_progress_bar=False)[0]


# ---------- BM25 tokenisation ----------

def bm25_tokens(text: str) -> list[str]:
    text = unicodedata.normalize("NFC", text.lower())
    toks = _tokenizer()(text, engine="newmm", keep_whitespace=False)
    return [t for t in toks if any(ch.isalnum() for ch in t)]


# ---------- retrievers ----------

class Retriever:
    name = "base"

    def index(self, chunks: list[Chunk]) -> None: ...

    def search(self, query: str, k: int) -> list[tuple[int, float]]:
        """Return [(chunk_index, score)] best first."""
        raise NotImplementedError


def _top_k(scores: np.ndarray, k: int) -> list[tuple[int, float]]:
    k = min(k, len(scores))
    if k == 0:
        return []
    idx = np.argpartition(-scores, k - 1)[:k]
    idx = idx[np.argsort(-scores[idx])]
    return [(int(i), float(scores[i])) for i in idx]


# Cache passage matrices so re-running with the same model and chunks skips encoding.
_emb_cache: dict[tuple, np.ndarray] = {}


class DenseRetriever(Retriever):
    def __init__(self, model: str):
        self.embedder = Embedder(model)
        self.name = f"dense:{model}"

    def index(self, chunks):
        key = (self.embedder.name, tuple((c.doc_id, c.start, c.end) for c in chunks))
        if key not in _emb_cache:
            if len(_emb_cache) > 16:
                _emb_cache.pop(next(iter(_emb_cache)))
            _emb_cache[key] = self.embedder.passages([c.text for c in chunks])
        self.matrix = _emb_cache[key]

    def search(self, query, k):
        q = self.embedder.query(query)
        return _top_k(self.matrix @ q, k)


class BM25Retriever(Retriever):
    name = "bm25"

    def index(self, chunks):
        from rank_bm25 import BM25Okapi
        self.bm25 = BM25Okapi([bm25_tokens(c.text) or ["∅"] for c in chunks])

    def search(self, query, k):
        return _top_k(np.asarray(self.bm25.get_scores(bm25_tokens(query))), k)


class HybridRetriever(Retriever):
    """Reciprocal rank fusion of dense + BM25."""

    def __init__(self, model: str, rrf_k: int = 60, pool: int = 50):
        self.dense, self.sparse = DenseRetriever(model), BM25Retriever()
        self.rrf_k, self.pool = rrf_k, pool
        self.name = f"hybrid:{model}"

    def index(self, chunks):
        self.dense.index(chunks)
        self.sparse.index(chunks)

    def search(self, query, k):
        fused: dict[int, float] = {}
        for results in (self.dense.search(query, self.pool), self.sparse.search(query, self.pool)):
            for rank, (i, _) in enumerate(results):
                fused[i] = fused.get(i, 0.0) + 1.0 / (self.rrf_k + rank + 1)
        return sorted(fused.items(), key=lambda x: -x[1])[:k]


def build_retriever(cfg: dict) -> Retriever:
    t = cfg["type"]
    if t == "dense":
        return DenseRetriever(cfg["model"])
    if t == "bm25":
        return BM25Retriever()
    if t == "hybrid":
        return HybridRetriever(cfg["model"])
    raise ValueError(f"unknown retriever: {t}")


def retriever_label(cfg: dict) -> str:
    if cfg["type"] == "bm25":
        return "bm25"
    return f"{cfg['type']}:{cfg['model'].split('/')[-1]}"


def timed_search(r: Retriever, query: str, k: int) -> tuple[list[tuple[int, float]], float]:
    t0 = time.perf_counter()
    res = r.search(query, k)
    return res, (time.perf_counter() - t0) * 1000.0
