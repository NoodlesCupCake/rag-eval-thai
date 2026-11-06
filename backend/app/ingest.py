"""Turn any uploaded file into documents plus a QA set.

Three shapes of input:
  faq   a table that already has question and answer columns: rows become QA items
        directly, and the answer (or a context column) becomes the searchable text.
        No LLM needed.
  table a table without them (a product list, a price sheet): each row becomes a short
        passage "column: value", then the LLM writes questions from those passages.
  text  PDF, Word, Markdown or plain text: the LLM writes questions from the document.

Uploads are kept in memory for a short time between the preview and the start, so the
person can check the detected columns first.
"""
from __future__ import annotations

import io
import os
import re
import threading
import time
import unicodedata
import uuid

from .qa import read_document_file

MAX_UPLOAD_MB = float(os.environ.get("MAX_UPLOAD_MB", "20"))
MAX_ROWS = int(os.environ.get("MAX_TABLE_ROWS", "5000"))
TEXT_TYPES = (".txt", ".md", ".pdf", ".docx")
TABLE_TYPES = (".xlsx", ".xlsm", ".csv")
ALL_TYPES = TEXT_TYPES + TABLE_TYPES

# header words that identify each role, Thai and English, compared after normalising
_ROLES = {
    "question": ["question", "questions", "q", "query", "prompt", "ask", "คำถาม", "ถาม", "โจทย์", "หัวข้อคำถาม"],
    "answer": ["answer", "answers", "a", "response", "reply", "solution", "คำตอบ", "ตอบ", "เฉลย", "คำอธิบาย"],
    "context": ["evidence", "context", "passage", "source text", "reference", "content", "detail", "details",
                "เนื้อหา", "อ้างอิง", "หลักฐาน", "ข้อความอ้างอิง", "รายละเอียด", "บริบท"],
}


class IngestError(ValueError):
    pass


def _norm(h: str) -> str:
    return re.sub(r"[\s_\-:.()]+", " ", unicodedata.normalize("NFC", str(h)).strip().lower()).strip()


def detect_mapping(headers: list[str]) -> dict[str, int | None]:
    """Column index for question, answer and context, or None. Exact word matches win
    over partial ones, and a column is used for one role only."""
    names = [_norm(h) for h in headers]
    out: dict[str, int | None] = {"question": None, "answer": None, "context": None}
    taken: set[int] = set()
    for role, words in _ROLES.items():
        for exact in (True, False):
            for i, n in enumerate(names):
                if i in taken or not n:
                    continue
                hit = n in words if exact else any(w in n for w in words if len(w) > 2)
                if hit:
                    out[role] = i
                    taken.add(i)
                    break
            if out[role] is not None:
                break
    return out


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return unicodedata.normalize("NFC", str(v)).replace("\r\n", "\n").strip()


def read_table(filename: str, raw: bytes) -> list[dict]:
    """Sheets as {name, headers, rows}; the first non-empty row is the header."""
    sheets = []
    if filename.lower().endswith(".csv"):
        import csv
        text = raw.decode("utf-8-sig", errors="replace")
        rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
        if rows:
            sheets.append({"name": "csv", "headers": [_cell(h) for h in rows[0]], "rows": [[_cell(c) for c in r] for r in rows[1:]]})
    else:
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        for ws in wb.worksheets:
            rows = [[_cell(c) for c in r] for r in ws.iter_rows(values_only=True)]
            rows = [r for r in rows if any(c for c in r)]
            if rows:
                sheets.append({"name": ws.title, "headers": rows[0], "rows": rows[1:]})
    for s in sheets:
        width = len(s["headers"])
        s["headers"] = [h or f"คอลัมน์ {i + 1}" for i, h in enumerate(s["headers"])]
        s["rows"] = [(r + [""] * width)[:width] for r in s["rows"]][:MAX_ROWS]
    return [s for s in sheets if s["rows"]]


def read_text(filename: str, raw: bytes) -> str:
    if filename.lower().endswith(".docx"):
        from docx import Document
        d = Document(io.BytesIO(raw))
        parts = [p.text for p in d.paragraphs]
        for t in d.tables:  # keep table text too, a row per line
            for row in t.rows:
                parts.append(" · ".join(c.text.strip() for c in row.cells if c.text.strip()))
        text = "\n\n".join(p.strip() for p in parts if p.strip())
        return re.sub(r"\n{3,}", "\n\n", unicodedata.normalize("NFC", text)).strip()
    return read_document_file(filename, raw)


# ---------- building documents and QA items ----------

def faq_to_document(sheet: dict, mapping: dict) -> tuple[str, list[dict]]:
    """FAQ table -> (document text, QA items with exact evidence offsets).
    The searchable text for each row is the context column when there is one, otherwise
    the question and answer together, so the answer can be found by retrieval."""
    q_i, a_i, c_i = mapping.get("question"), mapping.get("answer"), mapping.get("context")
    if q_i is None or (a_i is None and c_i is None):
        raise IngestError("ต้องเลือกคอลัมน์คำถาม และคอลัมน์คำตอบหรือเนื้อหาอ้างอิงอย่างน้อยหนึ่งคอลัมน์")
    parts, items, pos = [], [], 0
    for row in sheet["rows"]:
        q = row[q_i]
        a = row[a_i] if a_i is not None else ""
        ctx = row[c_i] if c_i is not None else ""
        if not q or not (a or ctx):
            continue
        block = ctx if ctx else f"{q}\n{a}"
        evidence = ctx if ctx else a
        start = pos + block.index(evidence)
        items.append({"question": q, "answer": a or ctx, "evidence_span": (start, start + len(evidence))})
        parts.append(block)
        pos += len(block) + 2  # the "\n\n" separator
    if not items:
        raise IngestError("ไม่มีแถวที่มีทั้งคำถามและคำตอบ")
    return "\n\n".join(parts), items


def table_to_document(sheet: dict, columns: list[int] | None = None) -> str:
    """Data table -> one passage per row, "column: value" per line."""
    cols = columns if columns else list(range(len(sheet["headers"])))
    blocks = []
    for row in sheet["rows"]:
        lines = [f"{sheet['headers'][i]}: {row[i]}" for i in cols if row[i]]
        if lines:
            blocks.append("\n".join(lines))
    if not blocks:
        raise IngestError("ตารางไม่มีข้อมูล")
    return "\n\n".join(blocks)


# ---------- preview cache ----------

_uploads: dict[str, dict] = {}
_lock = threading.Lock()
_TTL = 60 * 60


def check_size(filename: str, size: int) -> None:
    if not filename.lower().endswith(ALL_TYPES):
        raise IngestError(f"รองรับ {' '.join(ALL_TYPES)}")
    if size > MAX_UPLOAD_MB * 1024 * 1024:
        raise IngestError(f"ไฟล์ใหญ่เกินขีดจำกัด {MAX_UPLOAD_MB:g} MB")


def preview(filename: str, raw: bytes) -> dict:
    check_size(filename, len(raw))
    token = uuid.uuid4().hex[:12]
    info: dict = {"token": token, "filename": filename, "size": len(raw), "max_mb": MAX_UPLOAD_MB}
    if filename.lower().endswith(TABLE_TYPES):
        sheets = read_table(filename, raw)
        if not sheets:
            raise IngestError("ไม่พบข้อมูลในไฟล์")
        info["kind"] = "table"
        info["sheets"] = []
        for s in sheets:
            m = detect_mapping(s["headers"])
            mode = "faq" if m["question"] is not None and (m["answer"] is not None or m["context"] is not None) else "table"
            info["sheets"].append({"name": s["name"], "headers": s["headers"], "n_rows": len(s["rows"]),
                                   "sample": s["rows"][:5], "mapping": m, "mode": mode,
                                   "truncated": len(s["rows"]) >= MAX_ROWS})
        payload = {"sheets": sheets}
    else:
        text = read_text(filename, raw)
        if not text:
            raise IngestError("ไม่มีข้อความในไฟล์ (PDF ที่เป็นภาพสแกนต้อง OCR ก่อน)")
        info.update(kind="text", mode="text", chars=len(text), sample_text=text[:600])
        payload = {"text": text}
    with _lock:
        now = time.time()
        for k in [k for k, v in _uploads.items() if now - v["at"] > _TTL]:
            _uploads.pop(k, None)
        _uploads[token] = {"at": now, "filename": filename, **payload}
    return info


def peek(token: str) -> dict:
    with _lock:
        up = _uploads.get(token)
    if not up:
        raise IngestError("ไฟล์หมดอายุหรือไม่พบ อัปโหลดใหม่อีกครั้ง")
    return up


def take(token: str) -> dict:
    up = peek(token)
    with _lock:
        _uploads.pop(token, None)
    return up
