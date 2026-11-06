from __future__ import annotations

import csv
import io
import json
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from . import llm, runner, storage  # noqa: E402
from .chunking import STRATEGIES, chunk_text, word_spans  # noqa: E402
from .qa import locate_evidence, parse_upload, read_document_file, resolve_rows  # noqa: E402
from .retrieval import RETRIEVER_TYPES, SUGGESTED_MODELS, device_name  # noqa: E402

app = FastAPI(title="RAG Eval TH")
FRONTEND = storage.ROOT / "frontend"


@app.get("/api/status")
def status():
    return {"llm_available": llm.available(), "default_model": llm.default_model(), "llm": llm.public_settings(),
            "device": device_name(),
            "strategies": STRATEGIES, "retrievers": RETRIEVER_TYPES, "suggested_models": SUGGESTED_MODELS,
            "counts": {"documents": len(storage.list_documents()), "qa": len(storage.list_qa()),
                       "runs": len(storage.list_runs())}}


# ---------- documents ----------

@app.get("/api/documents")
def documents():
    return storage.list_documents()


@app.get("/api/documents/{doc_id}")
def document(doc_id: str):
    d = storage.get_document(doc_id)
    if not d:
        raise HTTPException(404, "ไม่พบเอกสาร")
    return d


@app.post("/api/documents")
async def upload_documents(files: list[UploadFile] = File(...)):
    out = []
    for f in files:
        if not f.filename.lower().endswith((".txt", ".md", ".pdf")):
            raise HTTPException(400, f"{f.filename}: รองรับเฉพาะ .txt .md .pdf")
        text = read_document_file(f.filename, await f.read())
        if not text:
            raise HTTPException(400, f"{f.filename}: ไม่มีข้อความ (PDF ที่เป็นภาพสแกนต้อง OCR ก่อน)")
        out.append({k: v for k, v in storage.add_document(f.filename, text).items() if k != "text"})
    return out


@app.delete("/api/documents/{doc_id}")
def remove_document(doc_id: str):
    if not storage.delete_document(doc_id):
        raise HTTPException(404, "ไม่พบเอกสาร")
    return {"ok": True}


class PreviewReq(BaseModel):
    strategy: str
    size: int
    overlap: int = 0


@app.post("/api/documents/{doc_id}/chunks")
def preview_chunks(doc_id: str, req: PreviewReq):
    d = storage.get_document(doc_id)
    if not d:
        raise HTTPException(404, "ไม่พบเอกสาร")
    if req.strategy not in STRATEGIES:
        raise HTTPException(400, f"unknown strategy {req.strategy}")
    chunks = chunk_text(doc_id, d["text"], req.strategy, req.size, req.overlap)
    bounds = {0, len(d["text"])}
    for s, e in word_spans(d["text"]):
        bounds.update((s, e))
    mid_word = sum(1 for c in chunks if c.start not in bounds or c.end not in bounds)
    sizes = [c.end - c.start for c in chunks] or [0]
    return {"chunks": [c.to_dict() for c in chunks], "mid_word": mid_word,
            "stats": {"n": len(chunks), "avg": sum(sizes) / len(sizes), "min": min(sizes), "max": max(sizes)}}


@app.post("/api/samples")
def load_samples():
    """Load the bundled Thai sample documents and their QA set."""
    existing = {d["name"] for d in storage.list_documents()}
    added_docs = []
    for p in sorted((storage.SAMPLES_DIR / "documents").glob("*.md")):
        if p.name not in existing:
            added_docs.append(storage.add_document(p.name, read_document_file(p.name, p.read_bytes())))
    docs = storage.list_documents(include_text=True)
    rows = parse_upload("qa.json", (storage.SAMPLES_DIR / "qa.json").read_bytes())
    have = {q["question"] for q in storage.list_qa()}
    rows = [r for r in rows if r["question"] not in have]
    ok, errors = resolve_rows(rows, docs)
    for it in ok:
        it["source"] = "sample"
    storage.add_qa(ok)
    return {"documents": len(added_docs), "qa": len(ok), "errors": errors}


# ---------- QA ----------

@app.get("/api/qa")
def qa_list():
    docs = {d["id"]: d for d in storage.list_documents(include_text=True)}
    out = []
    for q in storage.list_qa():
        ev = q["evidence"][0]
        d = docs.get(ev["doc_id"])
        out.append(q | {"doc_name": d["name"] if d else None,
                        "evidence_text": d["text"][ev["start"]:ev["end"]] if d else ""})
    return out


class QAIn(BaseModel):
    question: str
    answer: str = ""
    evidence: str
    document_id: str | None = None


@app.post("/api/qa")
def qa_add(item: QAIn):
    docs = storage.list_documents(include_text=True)
    pool = [d for d in docs if d["id"] == item.document_id] or docs
    ev = locate_evidence(item.evidence, pool)
    if not ev:
        raise HTTPException(400, "หาข้อความ evidence ในเอกสารไม่เจอ ต้องคัดลอกมาจากเอกสารตรงตัว")
    return storage.add_qa([{"question": item.question.strip(), "answer": item.answer.strip(),
                            "evidence": [ev], "source": "manual"}])[0]


class QAPatch(BaseModel):
    question: str | None = None
    answer: str | None = None


@app.patch("/api/qa/{qa_id}")
def qa_update(qa_id: str, patch: QAPatch):
    items = storage.list_qa()
    for it in items:
        if it["id"] == qa_id:
            it.update({k: v.strip() for k, v in patch.model_dump().items() if v is not None})
            storage.save_qa(items)
            return it
    raise HTTPException(404, "ไม่พบคำถาม")


@app.delete("/api/qa/{qa_id}")
def qa_delete(qa_id: str):
    items = storage.list_qa()
    storage.save_qa([q for q in items if q["id"] != qa_id])
    return {"ok": True}


@app.delete("/api/qa")
def qa_clear():
    storage.save_qa([])
    return {"ok": True}


@app.post("/api/qa/import")
async def qa_import(file: UploadFile = File(...)):
    try:
        rows = parse_upload(file.filename, await file.read())
    except (ValueError, json.JSONDecodeError, csv.Error) as e:
        raise HTTPException(400, f"อ่านไฟล์ไม่ได้: {e}")
    ok, errors = resolve_rows(rows, storage.list_documents(include_text=True))
    storage.add_qa(ok)
    return {"added": len(ok), "errors": errors}


@app.get("/api/qa/export")
def qa_export(format: str = "json"):
    items = storage.list_qa()
    if format == "csv":
        docs = {d["id"]: d for d in storage.list_documents(include_text=True)}
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["question", "answer", "evidence", "document"])
        for q in items:
            ev = q["evidence"][0]
            d = docs.get(ev["doc_id"])
            w.writerow([q["question"], q["answer"], d["text"][ev["start"]:ev["end"]] if d else "", d["name"] if d else ""])
        return Response("﻿" + buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=qa.csv"})
    return Response(json.dumps(items, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=qa.json"})


class GenerateReq(BaseModel):
    document_ids: list[str] = []
    per_passage: int = Field(2, ge=1, le=5)
    passage_chars: int = Field(800, ge=200, le=4000)
    max_questions: int = Field(30, ge=1, le=500)
    model: str | None = None


@app.post("/api/qa/generate")
def qa_generate(req: GenerateReq):
    try:
        return runner.start_generate(req.document_ids, req.per_passage, req.passage_chars,
                                     req.max_questions, req.model or None)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------- LLM settings ----------

@app.get("/api/settings")
def settings_get():
    return {"settings": llm.public_settings(), "presets": llm.PRESETS}


class SettingsIn(BaseModel):
    preset: str = "custom"
    provider: str
    base_url: str = ""
    api_key: str | None = None  # None keeps the saved key
    model: str = ""
    effort: str = "low"


@app.put("/api/settings")
def settings_put(s: SettingsIn):
    if s.provider not in ("anthropic", "openai"):
        raise HTTPException(400, "provider ต้องเป็น anthropic หรือ openai")
    if s.provider == "openai" and not s.base_url:
        raise HTTPException(400, "ต้องใส่ base URL")
    old = storage.get_settings()
    new = s.model_dump()
    new["base_url"] = new["base_url"].strip().rstrip("/")
    if new["api_key"] is None:
        new["api_key"] = old.get("api_key", "") if old.get("provider") == s.provider else ""
    storage.save_settings(new)
    return llm.public_settings()


@app.post("/api/settings/test")
def settings_test():
    if not llm.available():
        raise HTTPException(400, "ตั้งค่ายังไม่ครบ")
    try:
        return llm.test_connection()
    except llm.LLMError as e:
        raise HTTPException(400, str(e))


# ---------- runs ----------

class ChunkCfg(BaseModel):
    strategy: str
    size: int = Field(ge=16, le=8000)
    overlap: int = Field(0, ge=0)


class RetrieverCfg(BaseModel):
    type: str
    model: str | None = None


class GenCfg(BaseModel):
    enabled: bool = False
    top_k: int = Field(3, ge=1, le=10)
    model: str | None = None


class RunReq(BaseModel):
    name: str | None = None
    chunkings: list[ChunkCfg] = Field(min_length=1)
    retrievers: list[RetrieverCfg] = Field(min_length=1)
    k_max: int = Field(10, ge=1, le=20)
    sample: int | None = None
    generation: GenCfg = GenCfg()


@app.post("/api/runs")
def run_create(req: RunReq):
    for c in req.chunkings:
        if c.strategy not in STRATEGIES:
            raise HTTPException(400, f"unknown strategy {c.strategy}")
    for r in req.retrievers:
        if r.type not in RETRIEVER_TYPES or (r.type != "bm25" and not r.model):
            raise HTTPException(400, f"retriever {r.type} ต้องระบุ embedding model")
    try:
        return runner.start_run(req.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/runs")
def runs():
    return storage.list_runs()


@app.get("/api/runs/{run_id}")
def run_get(run_id: str):
    r = storage.get_run(run_id)
    if not r:
        raise HTTPException(404, "ไม่พบผลการรัน")
    return r


@app.delete("/api/runs/{run_id}")
def run_delete(run_id: str):
    return {"ok": storage.delete_run(run_id)}


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    j = runner.get_job(job_id)
    if not j:
        raise HTTPException(404, "job not found (server restarted?)")
    return j


# ---------- frontend ----------

app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/{path:path}")
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "not found")
    return FileResponse(FRONTEND / "index.html")
