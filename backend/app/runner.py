"""Background jobs: benchmark runs and QA generation."""
from __future__ import annotations

import random
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from . import llm, storage
from .chunking import chunk_documents, chunk_text, label as chunk_label
from .metrics import aggregate, gold_chunks, ndcg, score_question
from .qa import locate_evidence, parse_upload, read_document_file, resolve_row
from .retrieval import _emb_cache, build_retriever, retriever_label, timed_search

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def get_job(job_id: str) -> dict | None:
    with _jobs_lock:
        j = _jobs.get(job_id)
        return dict(j) if j else None


def list_jobs(limit: int = 20) -> list[dict]:
    with _jobs_lock:
        jobs = sorted(_jobs.values(), key=lambda j: j["started_at"], reverse=True)[:limit]
        return [dict(j) for j in jobs]


def _job(kind: str, total: int, title: str = "") -> dict:
    j = {"id": storage.new_id("job"), "kind": kind, "title": title, "status": "running", "done": 0, "total": total,
         "message": "", "error": None, "result": None, "started_at": storage.now()}
    with _jobs_lock:
        _jobs[j["id"]] = j
    return j


def _update(j: dict, **kw) -> None:
    with _jobs_lock:
        j.update(kw)


# ---------- benchmark ----------

def start_run(spec: dict) -> dict:
    set_id = storage.resolve_set(spec.get("qa_set"))
    qa_set = storage.get_set(set_id)
    qa = storage.list_qa(set_id)
    docs = storage.list_documents(include_text=True)
    if not qa:
        raise ValueError("ยังไม่มีชุดคำถาม เพิ่มคำถามก่อนรัน")
    if not docs:
        raise ValueError("ยังไม่มีเอกสาร")
    gen = spec.get("generation") or {}
    if gen.get("enabled") and not llm.available():
        raise ValueError("ตั้งค่า LLM ในหน้าตั้งค่าก่อนเปิดการประเมินคำตอบ")
    if gen.get("enabled"):
        ls = llm.settings()
        gen["model"] = gen.get("model") or ls["model"]
        gen["judge_model"] = gen.get("judge_model") or gen["model"]
        gen["provider"], gen["base_url"] = ls["provider"], ls["base_url"]
    if spec.get("sample") and spec["sample"] < len(qa):
        qa = random.Random(0).sample(qa, spec["sample"])

    configs = [(c, r) for c in spec["chunkings"] for r in spec["retrievers"]]
    kind = spec.get("kind") or ("rag" if gen.get("enabled") else "retrieval")
    run = {"id": storage.new_id("run"), "kind": kind,
           "name": spec.get("name") or (("RAG " if kind == "rag" else "Embedding ") + time.strftime("%d %b %H:%M")),
           "status": "running", "created_at": storage.now(), "finished_at": None, "spec": spec,
           "n_questions": len(qa), "results": [], "error": None,
           "qa_set": {"id": set_id, "name": qa_set["name"] if qa_set else set_id},
           "doc_names": {d["id"]: d["name"] for d in docs},
           "questions": {q["id"]: {k: q[k] for k in ("question", "answer", "evidence")} for q in qa}}
    storage.save_run(run)
    job = _job("run", len(configs) * len(qa), f"Benchmark · {run['name']}")
    job["run_id"] = run["id"]
    threading.Thread(target=_run_benchmark, args=(job, run, configs, docs, qa), daemon=True).start()
    return job


def _run_benchmark(job, run, configs, docs, qa):
    k_max = int(run["spec"].get("k_max", 10))
    gen = run["spec"].get("generation") or {}
    encoded: dict[str, dict] = {}  # first encoding per model, so speed is measured once per run
    _emb_cache.clear()             # measure encoding speed fresh in every run
    try:
        for ccfg, rcfg in configs:
            lbl = f"{chunk_label(ccfg)} · {retriever_label(rcfg)}"
            _update(job, message=f"{lbl}: chunking + indexing")
            chunks = chunk_documents(docs, ccfg["strategy"], ccfg["size"], ccfg.get("overlap", 0))
            t0 = time.perf_counter()
            retriever = build_retriever(rcfg)
            retriever.index(chunks)
            index_s = time.perf_counter() - t0
            retriever.search(qa[0]["question"], k_max)  # warm-up, excluded from latency

            per_q = []
            _update(job, message=f"{lbl}: querying")
            for q in qa:
                hits, ms = timed_search(retriever, q["question"], k_max)
                retrieved = [chunks[i] for i, _ in hits]
                s = score_question(retrieved, q["evidence"], k_max)
                gold = gold_chunks(chunks, q["evidence"])
                per_q.append({"qa_id": q["id"], "latency_ms": ms, **s, "gold": gold,
                              "ndcg": ndcg(retrieved, q["evidence"], len(gold), min(10, k_max)),
                              "retrieved": [{"chunk": c.id, "doc_id": c.doc_id, "start": c.start, "end": c.end,
                                             "score": round(sc, 4)} for c, (_, sc) in zip(retrieved, hits)],
                              "_chunks": retrieved})
                _update(job, done=job["done"] + 1)

            if gen.get("enabled"):
                _update(job, message=f"{lbl}: LLM answering + judging")
                _generate(per_q, qa, gen)

            for p in per_q:
                p.pop("_chunks", None)
            sizes = [c.end - c.start for c in chunks]
            run["results"].append({
                "label": lbl, "chunking": ccfg, "retriever": rcfg,
                "n_chunks": len(chunks), "avg_chunk_chars": sum(sizes) / max(len(sizes), 1),
                "index_seconds": index_s, "metrics": aggregate(per_q, k_max),
                "embedding": _embedding_stats(retriever, len(chunks), encoded, ccfg),
                "latencies": [round(p["latency_ms"], 3) for p in per_q], "per_question": per_q,
            })
            storage.save_run(run)
        run["status"] = "done"
        _update(job, status="done", message="เสร็จแล้ว")
    except Exception as e:  # surface the error in the UI instead of a silent dead thread
        traceback.print_exc()
        run["status"], run["error"] = "failed", str(e)
        _update(job, status="failed", error=str(e))
    finally:
        run["finished_at"] = storage.now()
        storage.save_run(run)


def _embedding_stats(retriever, n_chunks: int, encoded: dict, ccfg: dict) -> dict | None:
    if not hasattr(retriever, "stats"):
        return None
    st = retriever.stats(n_chunks)
    key = f"{st['model']}|{ccfg['strategy']}|{ccfg['size']}|{ccfg.get('overlap', 0)}"
    if not st["cached"]:
        encoded[key] = st
    elif key in encoded:  # e.g. hybrid reusing the vectors dense just made
        st = encoded[key] | {"cached": True}
    return st


def _generate(per_q, qa, gen):
    by_id = {q["id"]: q for q in qa}
    model, top_k = gen.get("model") or None, int(gen.get("top_k", 3))

    def work(p):
        q = by_id[p["qa_id"]]
        ctx = [c.text for c in p["_chunks"][:top_k]]
        try:
            ans, ms = llm.answer(q["question"], ctx, model)
            p["answer"], p["gen_latency_ms"] = ans, ms
            p["judge"] = llm.judge(q["question"], q["answer"], ans, ctx, gen.get("judge_model") or model)
        except llm.LLMError as e:
            p["gen_error"] = str(e)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(work, per_q))


# ---------- QA generation ----------

def start_generate(doc_ids: list[str], per_passage: int, passage_chars: int, max_questions: int, model: str | None, set_id: str) -> dict:
    if not llm.available():
        raise ValueError("ตั้งค่า LLM ในหน้าตั้งค่าก่อนสร้างคำถามอัตโนมัติ")
    docs = [d for d in storage.list_documents(include_text=True) if not doc_ids or d["id"] in doc_ids]
    passages = _passages(docs, passage_chars, per_passage, max_questions)
    job = _job("generate", len(passages), "สร้างคำถามด้วย LLM")
    threading.Thread(target=_generate_qa, args=(job, passages, per_passage, max_questions, model, set_id), daemon=True).start()
    return job


def _passages(docs: list[dict], passage_chars: int, per_passage: int, max_questions: int) -> list[tuple]:
    """Passages to write questions from, spread over the documents at random."""
    passages = []
    for d in docs:
        for c in chunk_text(d["id"], d["text"], "recursive", passage_chars, 0):
            if len(c.text) > min(passage_chars * 0.3, 120):
                passages.append((d, c))
    random.Random(1).shuffle(passages)
    return passages[: max(1, -(-max_questions // per_passage))]


def _generate_qa(job, passages, per_passage, max_questions, model, set_id):
    added, dropped = [], 0
    lock = threading.Lock()

    def work(item):
        nonlocal dropped
        d, c = item
        try:
            gen = llm.generate_qa(c.text, per_passage, model)
        except llm.LLMError as e:
            _update(job, message=str(e))
            gen = []
        for g in gen:
            ev = locate_evidence(g["evidence"], [d], hint=c.start)
            with lock:
                if ev and len(added) < max_questions:
                    added.append({"question": g["question"].strip(), "answer": g["answer"].strip(),
                                  "evidence": [ev], "source": "generated", "model": model or llm.default_model()})
                else:
                    dropped += 1
        _update(job, done=job["done"] + 1)

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(work, passages))
        storage.add_qa(set_id, added)
        _update(job, status="done", result={"added": len(added), "dropped": dropped},
                message=f"เพิ่ม {len(added)} คำถาม" + (f" · ตัดทิ้ง {dropped} ข้อที่หา evidence ในเอกสารไม่เจอ" if dropped else ""))
    except Exception as e:
        traceback.print_exc()
        _update(job, status="failed", error=str(e))


# ---------- QA import ----------

def start_import(filename: str, raw: bytes, mode: str, set_id: str) -> dict:
    """Import a QA file in the background. mode = "merge" updates rows whose id exists and
    adds the rest; "replace" makes the file the whole QA set."""
    job = _job("import", 0, f"นำเข้า {filename}")
    threading.Thread(target=_import, args=(job, filename, raw, mode, set_id), daemon=True).start()
    return job


def _import(job, filename, raw, mode, set_id):
    try:
        _update(job, message="กำลังอ่านไฟล์")
        rows = parse_upload(filename, raw)
        used = [(n, r) for n, r in enumerate(rows, 2) if r.get("use", True)]
        _update(job, total=len(used), message=f"ตรวจ evidence {len(used)} แถว" + (f" · ข้าม {len(rows) - len(used)} แถวที่ use = no" if len(rows) > len(used) else ""))
        docs = storage.list_documents(include_text=True)
        ok, errors = [], []
        for n, r in used:
            item, err = resolve_row(n, r, docs)
            (ok.append(item) if item else errors.append(err))
            _update(job, done=job["done"] + 1)

        _update(job, message="กำลังบันทึก")
        current = storage.list_qa(set_id)
        by_id = {q["id"]: q for q in current}
        added = updated = 0
        if mode == "replace":
            new = []
            for it in ok:
                old = by_id.get(it.get("id", ""))
                if old:
                    updated += 1
                    new.append(old | {k: it[k] for k in ("question", "answer", "evidence")})
                else:
                    added += 1
                    it.pop("id", None)
                    new.append(it | {"id": storage.new_id("qa"), "created_at": storage.now()})
            removed = len(current) - updated
            storage.save_qa(set_id, new)
        else:
            fresh = []
            for it in ok:
                old = by_id.get(it.get("id", ""))
                if old:
                    updated += 1
                    old.update({k: it[k] for k in ("question", "answer", "evidence")})
                else:
                    added += 1
                    it.pop("id", None)
                    fresh.append(it)
            storage.save_qa(set_id, current)
            storage.add_qa(set_id, fresh)
            removed = 0
        parts = [f"เพิ่ม {added}", f"อัปเดต {updated}"] + ([f"ลบ {removed}"] if removed else []) + ([f"ข้อผิดพลาด {len(errors)}"] if errors else [])
        _update(job, status="done", message=" · ".join(parts),
                result={"added": added, "updated": updated, "removed": removed, "skipped": len(rows) - len(used), "errors": errors[:50]})
    except Exception as e:
        traceback.print_exc()
        _update(job, status="failed", error=f"อ่านไฟล์ไม่ได้: {e}")


# ---------- document upload ----------

def start_doc_upload(files: list[tuple[str, bytes]]) -> dict:
    job = _job("upload", len(files), f"อัปโหลด {len(files)} เอกสาร")
    threading.Thread(target=_doc_upload, args=(job, files), daemon=True).start()
    return job


def _doc_upload(job, files):
    added, errors = [], []
    for name, raw in files:
        _update(job, message=f"กำลังอ่าน {name}")
        try:
            text = read_document_file(name, raw)
            if text:
                added.append(storage.add_document(name, text)["id"])
            else:
                errors.append({"file": name, "error": "ไม่มีข้อความ (PDF ที่เป็นภาพสแกนต้อง OCR ก่อน)"})
        except Exception as e:
            errors.append({"file": name, "error": str(e)})
        _update(job, done=job["done"] + 1)
    msg = f"เพิ่ม {len(added)} เอกสาร" + (f" · ไม่สำเร็จ {len(errors)}: " + ", ".join(f"{x['file']} ({x['error']})" for x in errors[:3]) if errors else "")
    _update(job, status="done" if added or not errors else "failed", message=msg,
            error=None if added or not errors else msg, result={"added": added, "errors": errors})


# ---------- any file -> documents + QA set ----------

def start_ingest(token: str, opts: dict) -> dict:
    """opts: set_name, and per sheet {mode: faq|table|skip, mapping, columns}; for text and
    table modes also max_questions, per_passage, passage_chars. Needs an LLM unless every
    sheet is an FAQ."""
    from . import ingest
    up = ingest.peek(token)  # keep the upload if we refuse, so the person can fix and retry
    needs_llm = "text" in up or any(s.get("mode", "faq") in ("table", "text") for s in opts.get("sheets", []))
    if needs_llm and not llm.available():
        raise ValueError("ไฟล์นี้ต้องให้ LLM เขียนคำถาม ตั้งค่า LLM ในหน้าตั้งค่าก่อน")
    up = ingest.take(token)
    job = _job("ingest", 0, f"สร้างชุดคำถามจาก {up['filename']}")
    threading.Thread(target=_ingest, args=(job, up, opts), daemon=True).start()
    return job


def _ingest(job, up, opts):
    from . import ingest
    try:
        st = storage.create_set(opts.get("set_name") or up["filename"].rsplit(".", 1)[0])
        _update(job, message="กำลังสร้างเอกสาร", result={"set": st["id"]})
        base = up["filename"].rsplit(".", 1)[0]
        faq_items, gen_docs = [], []
        if "text" in up:
            gen_docs.append(storage.add_document(up["filename"], up["text"]))
        for i, sheet in enumerate(up.get("sheets", [])):
            o = (opts.get("sheets") or [{}] * (i + 1))[i] if i < len(opts.get("sheets") or []) else {}
            mode = o.get("mode", "faq")
            if mode == "skip":
                continue
            name = f"{base} · {sheet['name']}.md" if len(up["sheets"]) > 1 else f"{base}.md"
            if mode == "faq":
                text, items = ingest.faq_to_document(sheet, o.get("mapping") or ingest.detect_mapping(sheet["headers"]))
                doc = storage.add_document(name, text)
                for it in items:
                    s, e = it.pop("evidence_span")
                    faq_items.append(it | {"evidence": [{"doc_id": doc["id"], "start": s, "end": e}], "source": "file"})
            else:
                gen_docs.append(storage.add_document(name, ingest.table_to_document(sheet, o.get("columns"))))
        if faq_items:
            storage.add_qa(st["id"], faq_items)
        if not gen_docs:
            _update(job, status="done", total=1, done=1, message=f"เพิ่ม {len(faq_items)} คำถามจากตาราง เข้าชุด “{st['name']}”",
                    result={"set": st["id"], "added": len(faq_items)})
            return
        max_q = int(opts.get("max_questions", 30))
        per = int(opts.get("per_passage", 2))
        passages = _passages(gen_docs, int(opts.get("passage_chars", 800)), per, max_q)
        _update(job, total=len(passages), done=0, message=f"LLM กำลังเขียนคำถามจาก {len(passages)} ช่วง")
        _generate_qa(job, passages, per, max_q, None, st["id"])
        with _jobs_lock:
            job["result"] = (job.get("result") or {}) | {"set": st["id"]}
            if faq_items:
                job["message"] = f"{job['message']} · จากตาราง {len(faq_items)} ข้อ"
    except Exception as e:
        traceback.print_exc()
        _update(job, status="failed", error=str(e))
