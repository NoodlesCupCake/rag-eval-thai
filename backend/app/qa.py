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


_NO = {"no", "n", "false", "0", "ไม่", "ไม่ใช้", "x", "skip"}


def _xlsx_rows(raw: bytes) -> list[dict]:
    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(raw), read_only=True, data_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True)
    header = [str(h).strip().lower() if h is not None else "" for h in next(it, [])]
    rows = []
    for values in it:
        if values is None or all(v in (None, "") for v in values):
            continue
        rows.append({header[i]: ("" if v is None else str(v)) for i, v in enumerate(values) if i < len(header) and header[i]})
    return rows


def parse_upload(filename: str, raw: bytes) -> list[dict]:
    """Rows from .xlsx, .csv or .json with question, answer, evidence (text), and
    optional document (file name), id (to update an existing question) and use
    (no / ไม่ใช้ leaves the row out)."""
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm")):
        rows = _xlsx_rows(raw)
    else:
        text = raw.decode("utf-8-sig")
        if name.endswith(".json") or text.lstrip().startswith(("[", "{")):
            data = json.loads(text)
            if isinstance(data, dict):
                data = data.get("items") or data.get("qa") or []
            rows = data
        else:
            rows = list(csv.DictReader(io.StringIO(text)))
    out = []
    for r in rows:
        r = {str(k).strip().lower(): v for k, v in r.items() if k}
        base = {"id": str(r.get("id") or "").strip() or None,
                "question": str(r.get("question") or "").strip(), "answer": str(r.get("answer") or "").strip(),
                "use": str(r.get("use") or "").strip().lower() not in _NO}
        ev = r.get("evidence") or r.get("context") or ""
        if isinstance(ev, list):  # our own JSON export
            out.append(base | {"evidence_spans": ev, "document": None})
        else:
            out.append(base | {"evidence_text": str(ev).strip(), "document": str(r.get("document") or r.get("doc") or "").strip() or None})
    return out


def resolve_row(n: int, r: dict, docs: list[dict]) -> tuple[dict | None, dict | None]:
    """One parsed row -> (QA item with character-span evidence, None) or (None, error)."""
    if not r["question"]:
        return None, {"row": n, "error": "ไม่มีคำถาม"}
    item = {"question": r["question"], "answer": r["answer"], "source": "import"}
    if r.get("id"):
        item["id"] = r["id"]
    if r.get("evidence_spans"):
        ids = {d["id"] for d in docs}
        spans = [s for s in r["evidence_spans"] if s.get("doc_id") in ids]
        if not spans:
            return None, {"row": n, "error": "evidence อ้างถึงเอกสารที่ไม่มีในระบบ", "question": r["question"]}
        return item | {"evidence": spans}, None
    if not r.get("evidence_text"):
        return None, {"row": n, "error": "ไม่มี evidence (ข้อความในเอกสารที่ใช้ตอบ)", "question": r["question"]}
    named = [d for d in docs if d["name"] == r.get("document")]
    ev = locate_evidence(r["evidence_text"], named or docs)
    if not ev:
        return None, {"row": n, "error": "หา evidence ในเอกสารไม่เจอ", "question": r["question"]}
    return item | {"evidence": [ev]}, None


def resolve_rows(rows: list[dict], docs: list[dict]) -> tuple[list[dict], list[dict]]:
    """Turn parsed rows into QA items. Rows marked use = no are left out. Returns (ok, errors)."""
    ok, errors = [], []
    for n, r in enumerate(rows, 2):  # row 1 is the header in a spreadsheet
        if not r.get("use", True):
            continue
        item, err = resolve_row(n, r, docs)
        (ok.append(item) if item else errors.append(err))
    return ok, errors


def export_xlsx(items: list[dict], docs: dict[str, dict]) -> bytes:
    """A spreadsheet people can filter and edit, then import back (matched by id)."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = Workbook()
    ws = wb.active
    ws.title = "qa"
    cols = [("id", 16), ("use", 8), ("question", 48), ("answer", 40), ("evidence", 64), ("document", 32), ("source", 12)]
    ws.append([c for c, _ in cols])
    for q in items:
        ev = q["evidence"][0]
        d = docs.get(ev["doc_id"])
        ws.append([q["id"], "yes", q["question"], q["answer"], d["text"][ev["start"]:ev["end"]] if d else "",
                   d["name"] if d else "", q.get("source", "")])
    head = PatternFill("solid", fgColor="F4F4F5")
    for i, (_, w) in enumerate(cols, 1):
        letter = ws.cell(row=1, column=i).column_letter
        ws.column_dimensions[letter].width = w
        c = ws.cell(row=1, column=i)
        c.font, c.fill = Font(bold=True), head
    wrap = Alignment(wrap_text=True, vertical="top")
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = wrap
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions
    dv = DataValidation(type="list", formula1='"yes,no"', allow_blank=True)
    dv.add(f"B2:B{max(2, len(items) + 1)}")
    ws.add_data_validation(dv)

    notes = wb.create_sheet("วิธีใช้")
    for line in [
        "แก้ไขแล้วนำเข้ากลับได้ที่หน้าชุดคำถาม > นำเข้า",
        "id: ใช้จับคู่กับคำถามเดิม ถ้าลบ id ออกหรือเพิ่มแถวใหม่ จะถือเป็นคำถามใหม่",
        "use: ใส่ no เพื่อคัดคำถามออก (หรือกรองแล้วลบแถวทิ้ง แล้วนำเข้าแบบแทนที่ทั้งชุด)",
        "evidence: ข้อความจากเอกสารที่ใช้ตอบ ต้องคัดลอกมาตรงตัว (ช่องว่างต่างได้)",
        "document: ชื่อไฟล์เอกสาร ช่วยให้หา evidence ได้เร็วและไม่สับสน",
    ]:
        notes.append([line])
    notes.column_dimensions["A"].width = 100
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


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
