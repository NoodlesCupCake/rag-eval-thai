from __future__ import annotations

import csv
import io
import json
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from fastapi import FastAPI, File, HTTPException, Query, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from . import embed_api, llm, runner, storage  # noqa: E402
from .chunking import STRATEGIES, chunk_documents, chunk_text, word_spans  # noqa: E402
from .metrics import is_hit  # noqa: E402
from .qa import export_xlsx, locate_evidence, parse_upload, read_document_file, resolve_rows  # noqa: E402
from .retrieval import RETRIEVER_TYPES, SUGGESTED_MODELS, build_retriever, device_name, timed_search  # noqa: E402

TAGS = [
    {"name": "documents", "description": "เอกสารที่ RAG จะค้น และตัวอย่างการตัด chunk"},
    {"name": "qa", "description": "ชุดคำถาม: คำถาม คำตอบอ้างอิง และ evidence เป็นตำแหน่งตัวอักษรในเอกสาร"},
    {"name": "runs", "description": "รัน benchmark และอ่านผล Hit@k, MRR, nDCG@10, latency"},
    {"name": "playground", "description": "ถามคำถามเดียวแล้วดู chunk ที่ค้นได้และคำตอบของ LLM"},
    {"name": "jobs", "description": "งานเบื้องหลัง (นำเข้า อัปโหลด สร้างคำถาม benchmark) และความคืบหน้า"},
    {"name": "settings", "description": "ตั้งค่า LLM: Claude หรือ server ที่รองรับ OpenAI API เช่น Ollama"},
    {"name": "status", "description": "สถานะของระบบ"},
]

app = FastAPI(
    title="RAG Eval API",
    version="0.1.0",
    description=(
        "วัดผล RAG สำหรับเอกสารภาษาไทย: ตัด chunk, ค้นด้วย BM25 / dense / hybrid, "
        "วัด Hit@k, MRR, nDCG@10 และ latency p50/p95 ต่อคำถาม\n\n"
        "งานที่ใช้เวลานาน (นำเข้า อัปโหลด สร้างคำถาม benchmark) คืน job ทันที "
        "แล้วดูความคืบหน้าได้ที่ `GET /api/jobs/{job_id}`"
    ),
    openapi_tags=TAGS,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


@app.get("/api/status", tags=["status"])
def status():
    return {"llm_available": llm.available(), "default_model": llm.default_model(), "llm": llm.public_settings(),
            "device": device_name(),
            "strategies": STRATEGIES, "retrievers": RETRIEVER_TYPES, "suggested_models": SUGGESTED_MODELS + embed_api.model_ids(),
            "counts": {"documents": len(storage.list_documents()), "qa": storage.count_qa(), "qa_sets": len(storage.list_sets()),
                       "runs": len(storage.list_runs())}}


# ---------- documents ----------

@app.get("/api/documents", tags=["documents"])
def documents():
    return storage.list_documents()


@app.get("/api/documents/{doc_id}", tags=["documents"])
def document(doc_id: str):
    d = storage.get_document(doc_id)
    if not d:
        raise HTTPException(404, "ไม่พบเอกสาร")
    return d


@app.post("/api/documents", tags=["documents"])
async def upload_documents(files: list[UploadFile] = File(...)):
    """Read the uploads, then extract text in a background job (PDFs can be slow)."""
    payload = []
    for f in files:
        if not f.filename.lower().endswith((".txt", ".md", ".pdf")):
            raise HTTPException(400, f"{f.filename}: รองรับเฉพาะ .txt .md .pdf")
        payload.append((f.filename, await f.read()))
    return runner.start_doc_upload(payload)


@app.delete("/api/documents/{doc_id}", tags=["documents"])
def remove_document(doc_id: str):
    if not storage.delete_document(doc_id):
        raise HTTPException(404, "ไม่พบเอกสาร")
    return {"ok": True}


class PreviewReq(BaseModel):
    strategy: str
    size: int
    overlap: int = 0


@app.post("/api/documents/{doc_id}/chunks", tags=["documents"])
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
    out = [c.to_dict() | {"cut_start": c.start not in bounds, "cut_end": c.end not in bounds} for c in chunks]
    mid_word = sum(1 for c in out if c["cut_start"] or c["cut_end"])
    sizes = [c.end - c.start for c in chunks] or [0]
    return {"chunks": out, "mid_word": mid_word,
            "stats": {"n": len(chunks), "avg": sum(sizes) / len(sizes), "min": min(sizes), "max": max(sizes)}}


@app.post("/api/samples", tags=["documents"])
def load_samples():
    """Load the bundled Thai sample documents, and their questions into a QA set called ชุดตัวอย่าง."""
    existing = {d["name"] for d in storage.list_documents()}
    added_docs = []
    for p in sorted((storage.SAMPLES_DIR / "documents").glob("*.md")):
        if p.name not in existing:
            added_docs.append(storage.add_document(p.name, read_document_file(p.name, p.read_bytes())))
    docs = storage.list_documents(include_text=True)
    rows = parse_upload("qa.json", (storage.SAMPLES_DIR / "qa.json").read_bytes())
    sets = storage.list_sets()
    # an empty first set (fresh install) becomes the sample set; otherwise use or make ชุดตัวอย่าง
    target = next((st for st in sets if st["name"] == "ชุดตัวอย่าง"), None)
    if not target and len(sets) == 1 and sets[0]["count"] == 0:
        target = storage.rename_set(sets[0]["id"], "ชุดตัวอย่าง")
    target = target or storage.create_set("ชุดตัวอย่าง")
    have = {q["question"] for q in storage.list_qa(target["id"])}
    rows = [r for r in rows if r["question"] not in have]
    ok, errors = resolve_rows(rows, docs)
    for it in ok:
        it["source"] = "sample"
    storage.add_qa(target["id"], ok)
    return {"documents": len(added_docs), "qa": len(ok), "set": target["id"], "errors": errors}


# ---------- any file -> QA set ----------

@app.post("/api/ingest/preview", tags=["qa"])
async def ingest_preview(file: UploadFile = File(...)):
    """Upload any document or spreadsheet (size limit MAX_UPLOAD_MB). Returns what was
    detected: sheets, headers, sample rows and the guessed question/answer columns."""
    from . import ingest
    raw = await file.read(int(ingest.MAX_UPLOAD_MB * 1024 * 1024) + 1)
    try:
        return ingest.preview(file.filename, raw)
    except ingest.IngestError as e:
        raise HTTPException(413 if "เกินขีดจำกัด" in str(e) else 400, str(e))
    except Exception as e:
        raise HTTPException(400, f"อ่านไฟล์ไม่ได้: {e}")


class IngestSheet(BaseModel):
    mode: str = "faq"  # faq | table | skip
    mapping: dict[str, int | None] | None = None
    columns: list[int] | None = None


class IngestReq(BaseModel):
    set_name: str | None = None
    sheets: list[IngestSheet] = []
    max_questions: int = Field(30, ge=1, le=500)
    per_passage: int = Field(2, ge=1, le=5)
    passage_chars: int = Field(800, ge=200, le=4000)


@app.post("/api/ingest/{token}", tags=["qa"])
def ingest_start(token: str, req: IngestReq):
    """Build documents and a new QA set from a previewed file, as a background job."""
    from . import ingest
    try:
        return runner.start_ingest(token, req.model_dump())
    except (ValueError, ingest.IngestError) as e:
        raise HTTPException(400, str(e))


# ---------- QA sets ----------

class SetIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@app.get("/api/qa-sets", tags=["qa"])
def qa_sets():
    """All QA sets with their question counts."""
    return storage.list_sets()


@app.post("/api/qa-sets", tags=["qa"])
def qa_set_create(body: SetIn, copy_from: str | None = None):
    """Create an empty set, or a copy of another set with copy_from=<set id>."""
    st = storage.create_set(body.name)
    if copy_from:
        items = [q | {"id": storage.new_id("qa")} for q in storage.list_qa(copy_from)]
        storage.save_qa(st["id"], items)
    return storage.get_set(st["id"])


@app.patch("/api/qa-sets/{set_id}", tags=["qa"])
def qa_set_rename(set_id: str, body: SetIn):
    st = storage.rename_set(set_id, body.name)
    if not st:
        raise HTTPException(404, "ไม่พบชุดคำถาม")
    return st


@app.delete("/api/qa-sets/{set_id}", tags=["qa"])
def qa_set_delete(set_id: str):
    if not storage.delete_set(set_id):
        raise HTTPException(400, "ลบไม่ได้ ต้องเหลืออย่างน้อย 1 ชุด")
    return {"ok": True}


# ---------- QA ----------

@app.get("/api/qa", tags=["qa"])
def qa_list(strategy: str | None = None, size: int = 400, overlap: int = 0, qa_set: str | None = Query(None, alias="set", description="QA set id (default: the first set)")):
    """The QA set. With a chunking config, each item also lists the chunks its evidence
    falls in under that config (numbers match the document page's chunk preview)."""
    docs = {d["id"]: d for d in storage.list_documents(include_text=True)}
    if strategy and strategy not in STRATEGIES:
        raise HTTPException(400, f"unknown strategy {strategy}")
    chunked = {i: chunk_text(i, d["text"], strategy, size, overlap) for i, d in docs.items()} if strategy else {}
    out = []
    for q in storage.list_qa(qa_set):
        ev = q["evidence"][0]
        d = docs.get(ev["doc_id"])
        item = q | {"doc_name": d["name"] if d else None,
                    "evidence_text": d["text"][ev["start"]:ev["end"]] if d else ""}
        if strategy:
            item["chunks"] = [{"id": c.id, "doc_id": c.doc_id, "number": int(c.id.rsplit(":", 1)[1]) + 1}
                              for e in q["evidence"] for c in chunked.get(e["doc_id"], []) if is_hit(c, [e])]
        out.append(item)
    return out


class QAIn(BaseModel):
    question: str
    answer: str = ""
    evidence: str
    document_id: str | None = None


@app.post("/api/qa", tags=["qa"])
def qa_add(item: QAIn, qa_set: str | None = Query(None, alias="set", description="QA set id (default: the first set)")):
    docs = storage.list_documents(include_text=True)
    pool = [d for d in docs if d["id"] == item.document_id] or docs
    ev = locate_evidence(item.evidence, pool)
    if not ev:
        raise HTTPException(400, "หาข้อความ evidence ในเอกสารไม่เจอ ต้องคัดลอกมาจากเอกสารตรงตัว")
    return storage.add_qa(qa_set, [{"question": item.question.strip(), "answer": item.answer.strip(),
                            "evidence": [ev], "source": "manual"}])[0]


class QAPatch(BaseModel):
    question: str | None = None
    answer: str | None = None


@app.patch("/api/qa/{qa_id}", tags=["qa"])
def qa_update(qa_id: str, patch: QAPatch, qa_set: str | None = Query(None, alias="set", description="QA set id (default: the first set)")):
    items = storage.list_qa(qa_set)
    for it in items:
        if it["id"] == qa_id:
            it.update({k: v.strip() for k, v in patch.model_dump().items() if v is not None})
            storage.save_qa(qa_set, items)
            return it
    raise HTTPException(404, "ไม่พบคำถาม")


@app.delete("/api/qa/{qa_id}", tags=["qa"])
def qa_delete(qa_id: str, qa_set: str | None = Query(None, alias="set", description="QA set id (default: the first set)")):
    items = storage.list_qa(qa_set)
    storage.save_qa(qa_set, [q for q in items if q["id"] != qa_id])
    return {"ok": True}


@app.delete("/api/qa", tags=["qa"])
def qa_clear(qa_set: str | None = Query(None, alias="set", description="QA set id (default: the first set)")):
    storage.save_qa(qa_set, [])
    return {"ok": True}


@app.post("/api/qa/import", tags=["qa"])
async def qa_import(file: UploadFile = File(...), mode: str = "merge", qa_set: str | None = Query(None, alias="set", description="QA set id (default: the first set)")):
    """Starts a background import job; poll /api/jobs/{id} for progress."""
    if not file.filename.lower().endswith((".xlsx", ".xlsm", ".csv", ".json")):
        raise HTTPException(400, "รองรับ .xlsx .csv และ .json")
    if mode not in ("merge", "replace"):
        raise HTTPException(400, "mode ต้องเป็น merge หรือ replace")
    return runner.start_import(file.filename, await file.read(), mode, storage.resolve_set(qa_set))


@app.get("/api/qa/export", tags=["qa"])
def qa_export(format: str = "json", qa_set: str | None = Query(None, alias="set", description="QA set id (default: the first set)")):
    items = storage.list_qa(qa_set)
    if format == "xlsx":
        docs = {d["id"]: d for d in storage.list_documents(include_text=True)}
        return Response(export_xlsx(items, docs),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": "attachment; filename=qa.xlsx"})
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
    set: str | None = None


@app.post("/api/qa/generate", tags=["qa"])
def qa_generate(req: GenerateReq):
    try:
        return runner.start_generate(req.document_ids, req.per_passage, req.passage_chars,
                                     req.max_questions, req.model or None, storage.resolve_set(req.set))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------- LLM settings ----------

@app.get("/api/settings", tags=["settings"])
def settings_get():
    return {"settings": llm.public_settings(), "presets": llm.PRESETS, "in_docker": llm.IN_DOCKER}


class SettingsIn(BaseModel):
    preset: str = "custom"
    provider: str
    base_url: str = ""
    api_key: str | None = None  # None keeps the saved key
    model: str = ""
    effort: str = "low"


def _resolve_settings(s: SettingsIn) -> dict:
    if s.provider not in ("anthropic", "openai"):
        raise HTTPException(400, "provider ต้องเป็น anthropic หรือ openai")
    if s.provider == "openai" and not s.base_url.strip():
        raise HTTPException(400, "ต้องใส่ base URL")
    old = storage.get_settings()
    new = s.model_dump()
    new["base_url"] = new["base_url"].strip().rstrip("/")
    new["model"] = new["model"].strip()
    if new["api_key"] is None:  # keep the saved key when the provider is unchanged
        new["api_key"] = old.get("api_key", "") if old.get("provider") == s.provider else ""
    if s.provider == "anthropic" and not new["api_key"] and not llm.settings()["api_key"]:
        raise HTTPException(400, "Claude ต้องใช้ API key")
    if s.provider == "anthropic" and not new["api_key"]:
        new["api_key"] = llm.settings()["api_key"]  # from .env
    return new


@app.put("/api/settings", tags=["settings"])
def settings_put(s: SettingsIn):
    storage.save_settings(_resolve_settings(s))
    return llm.public_settings()


@app.post("/api/settings/test", tags=["settings"])
def settings_test(s: SettingsIn):
    """Test the values in the form without saving them."""
    try:
        return llm.test_connection(_resolve_settings(s))
    except llm.LLMError as e:
        raise HTTPException(400, str(e))


# ---------- embedding providers (API) ----------

@app.get("/api/embedding-providers", tags=["settings"])
def emb_providers():
    """Saved embedding APIs (keys masked) and presets for Voyage, OpenAI and Ollama."""
    return {"providers": embed_api.list_providers(), "presets": embed_api.PRESETS}


class EmbProviderIn(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=60)
    kind: str  # voyage | openai
    base_url: str = ""
    api_key: str | None = None  # None keeps the saved key
    models: list[str] = []


def _emb_provider(p: EmbProviderIn) -> dict:
    if p.kind not in ("voyage", "openai"):
        raise HTTPException(400, "kind ต้องเป็น voyage หรือ openai")
    d = p.model_dump()
    if d["api_key"] is None and p.id:
        old = embed_api.get_provider(p.id) or {}
        d["api_key"] = old.get("api_key", "")
    d["base_url"] = (d["base_url"] or "").strip().rstrip("/")
    if p.kind == "openai" and not d["base_url"]:
        raise HTTPException(400, "ต้องใส่ base URL")
    return d


@app.put("/api/embedding-providers", tags=["settings"])
def emb_provider_save(p: EmbProviderIn):
    if not [m for m in p.models if m.strip()]:
        raise HTTPException(400, "ใส่ชื่อโมเดลอย่างน้อย 1 ตัว")
    return embed_api.save_provider(_emb_provider(p))


@app.post("/api/embedding-providers/test", tags=["settings"])
def emb_provider_test(p: EmbProviderIn):
    """Embed one short text with the first model, without saving. Returns the vector size."""
    d = _emb_provider(p)
    models = [m.strip() for m in p.models if m.strip()]
    if not models:
        raise HTTPException(400, "ใส่ชื่อโมเดลอย่างน้อย 1 ตัว")
    try:
        return embed_api.test(d, models[0])
    except embed_api.EmbedAPIError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/embedding-providers/{pid}", tags=["settings"])
def emb_provider_delete(pid: str):
    if not embed_api.delete_provider(pid):
        raise HTTPException(404, "ไม่พบ")
    return {"ok": True}


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
    model: str | None = None        # answers; defaults to the LLM in settings
    judge_model: str | None = None  # grades; defaults to the answer model


class RunReq(BaseModel):
    kind: str = Field("retrieval", description="retrieval: where the right chunk ranks · rag: answer accuracy judged by an LLM")
    name: str | None = None
    chunkings: list[ChunkCfg] = Field(min_length=1)
    retrievers: list[RetrieverCfg] = Field(min_length=1)
    k_max: int = Field(10, ge=1, le=20)
    sample: int | None = None
    qa_set: str | None = None
    generation: GenCfg = GenCfg()


# ---------- playground ----------

class ChatReq(BaseModel):
    question: str = Field(min_length=1)
    chunking: ChunkCfg
    retriever: RetrieverCfg
    top_k: int = Field(5, ge=1, le=20)
    answer: bool = True  # also ask the LLM, when one is configured


_chat_index: dict[tuple, tuple] = {}


@app.post("/api/chat", tags=["playground"])
def chat(req: ChatReq):
    """Ask one question against the documents with one config: the ranked chunks, their
    scores, the retrieval time, and the LLM's answer from the top chunks when configured.
    The index is built once per config and reused."""
    if req.chunking.strategy not in STRATEGIES:
        raise HTTPException(400, f"unknown strategy {req.chunking.strategy}")
    if req.retriever.type not in RETRIEVER_TYPES or (req.retriever.type != "bm25" and not req.retriever.model):
        raise HTTPException(400, "retriever ไม่ถูกต้อง")
    docs = storage.list_documents(include_text=True)
    if not docs:
        raise HTTPException(400, "ยังไม่มีเอกสาร")
    key = (req.chunking.strategy, req.chunking.size, req.chunking.overlap, req.retriever.type, req.retriever.model,
           tuple(sorted((d["id"], len(d["text"])) for d in docs)))
    index_ms = 0.0
    if key not in _chat_index:
        t0 = time.perf_counter()
        chunks = chunk_documents(docs, req.chunking.strategy, req.chunking.size, req.chunking.overlap)
        r = build_retriever(req.retriever.model_dump())
        r.index(chunks)
        index_ms = (time.perf_counter() - t0) * 1000
        if len(_chat_index) > 8:
            _chat_index.pop(next(iter(_chat_index)))
        _chat_index[key] = (r, chunks)
    retriever, chunks = _chat_index[key]
    hits, ms = timed_search(retriever, req.question, req.top_k)
    names = {d["id"]: d["name"] for d in docs}
    out = {
        "retrieval_ms": ms, "index_ms": index_ms, "n_chunks": len(chunks),
        "chunks": [{"id": chunks[i].id, "doc_id": chunks[i].doc_id, "doc_name": names.get(chunks[i].doc_id),
                    "number": int(chunks[i].id.rsplit(":", 1)[1]) + 1, "score": round(sc, 4), "text": chunks[i].text}
                   for i, sc in hits],
        "answer": None, "answer_ms": None, "answer_error": None, "model": None,
    }
    if req.answer and llm.available():
        try:
            out["answer"], out["answer_ms"] = llm.answer(req.question, [c["text"] for c in out["chunks"][:3]])
            out["model"] = llm.default_model()
        except llm.LLMError as e:
            out["answer_error"] = str(e)
    return out


@app.post("/api/runs", tags=["runs"])
def run_create(req: RunReq):
    if req.kind not in ("retrieval", "rag"):
        raise HTTPException(400, "kind ต้องเป็น retrieval หรือ rag")
    if req.kind == "rag":
        req.generation.enabled = True
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


class MapReq(BaseModel):
    result: int = Field(0, ge=0)
    method: str = Field("tsne", description="tsne (clusters) or pca (linear)")


@app.post("/api/runs/{run_id}/map", tags=["runs"])
def run_map(run_id: str, req: MapReq):
    """2D map of one dense/hybrid result: every chunk and every question embedded with
    the result's model, projected to x, y. Uses the current documents."""
    import numpy as np
    from .retrieval import DenseRetriever
    run = storage.get_run(run_id)
    if not run or req.result >= len(run.get("results", [])):
        raise HTTPException(404, "ไม่พบผล")
    res = run["results"][req.result]
    rcfg, ccfg = res["retriever"], res["chunking"]
    if rcfg["type"] == "bm25" or not rcfg.get("model"):
        raise HTTPException(400, "BM25 ไม่ใช้ embedding จึงไม่มีแผนที่")
    docs = storage.list_documents(include_text=True)
    chunks = chunk_documents(docs, ccfg["strategy"], ccfg["size"], ccfg.get("overlap", 0))
    per_q = res["per_question"]
    keep = {g for p in per_q for g in p.get("gold", [])} | {c.get("chunk") for p in per_q for c in p["retrieved"][:3]}
    if len(chunks) > 1500:  # keep the map readable and fast: the relevant chunks plus a sample
        import random
        rest = [c for c in chunks if c.id not in keep]
        chunks = [c for c in chunks if c.id in keep] + random.Random(0).sample(rest, max(0, 1500 - len(keep)))
    try:
        dense = DenseRetriever(rcfg["model"])
        dense.index(chunks)
        C = dense.matrix
        qtexts = [run.get("questions", {}).get(p["qa_id"], {}).get("question", "") for p in per_q]
        Q = np.stack([dense.embedder.query(t) for t in qtexts]) if qtexts else np.zeros((0, C.shape[1]))
    except Exception as e:
        raise HTTPException(400, f"สร้าง embedding ไม่ได้: {e}")
    # Query and passage embeddings sit in separate regions (the "modality gap", strong with
    # e5's query:/passage: prefixes). Centre each group on its own mean so questions land
    # among the chunks they match instead of in a cluster of their own.
    C = C - C.mean(axis=0)
    if len(Q):
        Q = Q - Q.mean(axis=0)
    X = np.vstack([C, Q]).astype(np.float64)
    X = X / np.clip(np.linalg.norm(X, axis=1, keepdims=True), 1e-12, None)
    n = len(X)
    if req.method == "pca" or n < 8:
        Xc = X - X.mean(axis=0)
        _, _, vt = np.linalg.svd(Xc, full_matrices=False)
        Y = Xc @ vt[:2].T
        method = "pca"
    else:
        from sklearn.manifold import TSNE
        Y = TSNE(n_components=2, perplexity=float(min(30, max(5, (n - 1) // 3))), init="pca",
                 metric="cosine", random_state=0).fit_transform(X)
        method = "tsne"
    Y = (Y - Y.min(axis=0)) / np.clip(Y.max(axis=0) - Y.min(axis=0), 1e-9, None)
    names = {d["id"]: d["name"] for d in docs}
    out_chunks = [{"id": c.id, "doc_id": c.doc_id, "doc_name": names.get(c.doc_id), "number": int(c.id.rsplit(":", 1)[1]) + 1,
                   "text": c.text[:160], "x": float(Y[i, 0]), "y": float(Y[i, 1])} for i, c in enumerate(chunks)]
    out_q = [{"qa_id": p["qa_id"], "question": qtexts[i], "hit_rank": p["hit_rank"], "gold": p.get("gold", []),
              "top": [c.get("chunk") for c in p["retrieved"][:3]],
              "x": float(Y[len(chunks) + i, 0]), "y": float(Y[len(chunks) + i, 1])} for i, p in enumerate(per_q)]
    return {"method": method, "model": rcfg["model"], "label": res["label"], "chunks": out_chunks, "questions": out_q,
            "docs": [{"id": d["id"], "name": d["name"]} for d in docs]}


@app.get("/api/runs", tags=["runs"])
def runs():
    return storage.list_runs()


@app.get("/api/runs/{run_id}", tags=["runs"])
def run_get(run_id: str):
    r = storage.get_run(run_id)
    if not r:
        raise HTTPException(404, "ไม่พบผลการรัน")
    return r


@app.delete("/api/runs/{run_id}", tags=["runs"])
def run_delete(run_id: str):
    return {"ok": storage.delete_run(run_id)}


@app.get("/api/jobs", tags=["jobs"])
def jobs():
    return runner.list_jobs()


@app.get("/api/jobs/{job_id}", tags=["jobs"])
def job(job_id: str):
    j = runner.get_job(job_id)
    if not j:
        raise HTTPException(404, "job not found (server restarted?)")
    return j


# ---------- frontend ----------
# The React app is built into frontend/dist (npm run build). In Docker it is served by
# nginx instead, and during development by Vite on :5173 with /api proxied here.

FRONTEND_DIST = storage.ROOT / "frontend" / "dist"

if (FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        f = FRONTEND_DIST / path
        if path and f.is_file() and FRONTEND_DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
