"""Locating evidence text inside documents, and importing QA sets from CSV / JSON."""
from __future__ import annotations

import csv
import io
import json
import re
import unicodedata


def _norm_map(text: str) -> tuple[str, list[int]]:
    """Whitespace-collapsed NFC text plus a map from each normalised char to its original index."""
    out, idx, prev_space = [], [], False
    for i, ch in enumerate(text):
        ch = unicodedata.normalize("NFC", ch)
        if ch.isspace():
            if prev_space:
                continue
            ch, prev_space = " ", True
        else:
            prev_space = False
        out.append(ch)
        idx.append(i)
    return "".join(out), idx


def locate_evidence(evidence: str, docs: list[dict], hint: int = 0) -> dict | None:
    """Find evidence text in the documents and return {doc_id, start, end}.

    Exact match first, then a match that ignores whitespace differences (LLMs and
    copy-paste often change spacing in Thai text).
    """
    evidence = evidence.strip()
    if not evidence:
        return None
    for d in docs:
        text = d["text"]
        pos = text.find(evidence, max(0, hint - 50))
        if pos == -1:
            pos = text.find(evidence)
        if pos != -1:
            return {"doc_id": d["id"], "start": pos, "end": pos + len(evidence)}
    needle, _ = _norm_map(evidence)
    needle = needle.strip()
    for d in docs:
        hay, idx = _norm_map(d["text"])
        pos = hay.find(needle)
        if pos != -1:
            return {"doc_id": d["id"], "start": idx[pos], "end": idx[pos + len(needle) - 1] + 1}
    return None


def parse_upload(filename: str, raw: bytes) -> list[dict]:
    """Rows with question, answer, evidence (text) and optional document (name)."""
    text = raw.decode("utf-8-sig")
    if filename.lower().endswith(".json") or text.lstrip().startswith(("[", "{")):
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("items") or data.get("qa") or []
        rows = data
    else:
        rows = list(csv.DictReader(io.StringIO(text)))
    out = []
    for r in rows:
        r = {str(k).strip().lower(): v for k, v in r.items() if k}
        ev = r.get("evidence") or r.get("context") or ""
        if isinstance(ev, list):  # our own export format
            out.append({"question": r.get("question", ""), "answer": r.get("answer", ""),
                        "evidence_spans": ev, "document": None})
            continue
        out.append({"question": (r.get("question") or "").strip(), "answer": (r.get("answer") or "").strip(),
                    "evidence_text": str(ev).strip(), "document": (r.get("document") or r.get("doc") or "").strip() or None})
    return out


def resolve_rows(rows: list[dict], docs: list[dict]) -> tuple[list[dict], list[dict]]:
    """Turn parsed rows into QA items with character-span evidence. Returns (ok, errors)."""
    by_name = {d["name"]: d for d in docs}
    by_id = {d["id"]: d for d in docs}
    ok, errors = [], []
    for n, r in enumerate(rows, 1):
        if not r["question"]:
            errors.append({"row": n, "error": "ไม่มีคำถาม"})
            continue
        if r.get("evidence_spans"):
            spans = [s for s in r["evidence_spans"] if s.get("doc_id") in by_id]
            if spans:
                ok.append({"question": r["question"], "answer": r["answer"], "evidence": spans, "source": "import"})
            else:
                errors.append({"row": n, "error": "evidence อ้างถึงเอกสารที่ไม่มีในระบบ", "question": r["question"]})
            continue
        if not r.get("evidence_text"):
            errors.append({"row": n, "error": "ไม่มี evidence (ข้อความในเอกสารที่ใช้ตอบ)", "question": r["question"]})
            continue
        pool = [by_name[r["document"]]] if r.get("document") in by_name else docs
        ev = locate_evidence(r["evidence_text"], pool)
        if not ev:
            errors.append({"row": n, "error": "หา evidence ในเอกสารไม่เจอ", "question": r["question"]})
            continue
        ok.append({"question": r["question"], "answer": r["answer"], "evidence": [ev], "source": "import"})
    return ok, errors


def read_document_file(filename: str, raw: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n\n".join((p.extract_text() or "").strip() for p in reader.pages)
    else:
        text = raw.decode("utf-8-sig", errors="replace")
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n")
    return re.sub(r"\n{3,}", "\n\n", text).strip()
