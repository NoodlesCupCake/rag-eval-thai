"""Thai-aware chunking that keeps exact character offsets.

Every chunk records (start, end) into the original document text. Ground truth in the
QA set is also a character span, so one QA set works with any chunking config and a
"hit" is decided by span overlap, not by chunk id.

Sizes are always measured in characters, so the strategies are comparable:
  - char:      fixed windows, cuts anywhere (often mid-word in Thai: the baseline)
  - word:      windows snapped to Thai word boundaries (PyThaiNLP newmm)
  - recursive: paragraph -> line -> space-separated phrase -> word, then packed
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from functools import lru_cache

STRATEGIES = ("char", "word", "recursive")


@dataclass
class Chunk:
    id: str
    doc_id: str
    start: int
    end: int
    text: str

    def to_dict(self) -> dict:
        return asdict(self)


@lru_cache(maxsize=1)
def _tokenizer():
    from pythainlp.tokenize import word_tokenize
    return word_tokenize


def word_spans(text: str, s: int = 0, e: int | None = None) -> list[tuple[int, int]]:
    """Thai word token spans inside text[s:e], whitespace kept as its own tokens."""
    e = len(text) if e is None else e
    tokens = _tokenizer()(text[s:e], engine="newmm", keep_whitespace=True)
    spans, pos = [], s
    for tok in tokens:
        found = text.find(tok, pos, e)
        if found == -1:  # tokenizer normalised something; fall back to raw characters
            return [(i, i + 1) for i in range(s, e)]
        spans.append((found, found + len(tok)))
        pos = found + len(tok)
    return spans


def _split_on(text: str, s: int, e: int, sep: str) -> list[tuple[int, int]]:
    parts, i = [], s
    while i < e:
        j = text.find(sep, i, e)
        if j == -1:
            parts.append((i, e))
            break
        parts.append((i, j + len(sep)))
        i = j + len(sep)
    return parts


_SEPARATORS = ("\n\n", "\n", " ")


def _recursive_atoms(text: str, s: int, e: int, size: int, level: int = 0) -> list[tuple[int, int]]:
    if e - s <= size:
        return [(s, e)]
    if level >= len(_SEPARATORS):
        return word_spans(text, s, e)
    out = []
    for ps, pe in _split_on(text, s, e, _SEPARATORS[level]):
        out.extend(_recursive_atoms(text, ps, pe, size, level + 1))
    return out


def _pack(atoms: list[tuple[int, int]], size: int, overlap: int) -> list[tuple[int, int]]:
    """Greedily join consecutive atoms into windows of at most `size` chars.

    The next window starts on an atom boundary at least `overlap` chars before the end
    of the previous one (when the atoms allow it).
    """
    windows, i, n = [], 0, len(atoms)
    while i < n:
        j = i
        while j + 1 < n and atoms[j + 1][1] - atoms[i][0] <= size:
            j += 1
        windows.append((atoms[i][0], atoms[j][1]))
        if j == n - 1:
            break
        nxt = j + 1
        if overlap > 0:
            k = j
            while k > i and atoms[j][1] - atoms[k][0] <= overlap:
                k -= 1
            nxt = max(i + 1, k + 1)
        i = nxt
    return windows


def chunk_text(doc_id: str, text: str, strategy: str, size: int, overlap: int = 0) -> list[Chunk]:
    if strategy not in STRATEGIES:
        raise ValueError(f"unknown chunking strategy: {strategy}")
    size = max(16, int(size))
    overlap = max(0, min(int(overlap), size // 2))
    if strategy == "char":
        step = size - overlap
        windows = [(s, min(s + size, len(text))) for s in range(0, max(len(text) - overlap, 1), step)]
    elif strategy == "word":
        windows = _pack(word_spans(text), size, overlap)
    else:
        windows = _pack(_recursive_atoms(text, 0, len(text), size), size, overlap)

    chunks = []
    for s, e in windows:
        # trim surrounding whitespace but keep offsets exact
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            chunks.append(Chunk(f"{doc_id}:{len(chunks)}", doc_id, s, e, text[s:e]))
    return chunks


def chunk_documents(docs: list[dict], strategy: str, size: int, overlap: int) -> list[Chunk]:
    out = []
    for d in docs:
        out.extend(chunk_text(d["id"], d["text"], strategy, size, overlap))
    return out


def label(cfg: dict) -> str:
    return f"{cfg['strategy']}·{cfg['size']}" + (f"/{cfg['overlap']}" if cfg.get("overlap") else "")
