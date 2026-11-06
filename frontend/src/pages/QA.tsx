import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Plus, Search, Trash2, Upload } from "lucide-react";
import { api, errorText, pollJob } from "../api";
import { useStatus } from "../status";
import type { Doc, Job, QA } from "../types";
import { Empty, ErrorNote, JobProgress, PageHead } from "../components/ui";

type Panel = null | "add" | "generate";

export function QAPage() {
  const { refresh } = useStatus();
  const [items, setItems] = useState<QA[] | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.get<QA[]>("/qa").then(setItems).catch((e) => setError(errorText(e)));
  const reload = () => { load(); refresh(); };
  useEffect(() => { load(); api.get<Doc[]>("/documents").then(setDocs); }, []);

  async function importFile(f: File) {
    setError(null);
    setNote(null);
    try {
      const r = await api.upload<{ added: number; errors: { row: number; error: string }[] }>("/qa/import", [f], "file");
      const skipped = r.errors.length ? ` · ข้าม ${r.errors.length} แถว: ${r.errors.slice(0, 3).map((x) => `แถว ${x.row} ${x.error}`).join(", ")}` : "";
      setNote(`นำเข้า ${r.added} ข้อ${skipped}`);
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function remove(id: string) { await api.del("/qa/" + id); reload(); }
  async function clearAll() {
    if (items && confirm(`ลบคำถามทั้งหมด ${items.length} ข้อ?`)) { await api.del("/qa"); reload(); }
  }

  const shown = (items ?? []).filter((q) => !query || q.question.includes(query) || q.answer.includes(query) || q.evidence_text.includes(query));
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);

  return (
    <div className="stack">
      <PageHead title="ชุดคำถาม" sub="แต่ละข้อมีคำถาม คำตอบอ้างอิง และ evidence คือข้อความในเอกสารที่ใช้ตอบ ระบบเทียบตำแหน่ง evidence กับ chunk ที่ค้นเจอ ชุดเดียวจึงใช้ได้กับทุกวิธีตัด chunk">
        <button className="btn" onClick={() => fileRef.current?.click()}><Upload className="icon" />นำเข้า</button>
        <a className="btn" href="/api/qa/export?format=csv"><Download className="icon" />CSV</a>
        <button className="btn" onClick={() => toggle("generate")}>สร้างด้วย LLM</button>
        <button className="btn primary" onClick={() => toggle("add")}><Plus className="icon" />เพิ่มคำถาม</button>
        <input ref={fileRef} type="file" accept=".csv,.json" hidden
               onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
      </PageHead>
      <ErrorNote error={error} />
      {note && <div className="notice">{note}</div>}
      {panel === "add" && <AddQA docs={docs} onDone={() => { setPanel(null); reload(); }} />}
      {panel === "generate" && <GenerateQA docs={docs} onDone={(m) => { setNote(m); reload(); }} />}

      <div className="card">
        <div className="card-head">
          <h2>{items ? `${items.length} คำถาม` : "…"}</h2>
          <div className="actions">
            <div style={{ position: "relative" }}>
              <Search className="icon" style={{ position: "absolute", left: 10, top: 8, color: "var(--muted)" }} />
              <input className="input" style={{ width: 220, height: 32, paddingLeft: 32 }} placeholder="ค้นหา"
                     value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {!!items?.length && <button className="btn ghost sm" onClick={clearAll}>ลบทั้งหมด</button>}
          </div>
        </div>
        {items && items.length === 0 && (
          <Empty title="ยังไม่มีคำถาม">
            <p>นำเข้า CSV ที่มีคอลัมน์ <code>question, answer, evidence, document</code> ให้ LLM สร้างจากเอกสาร หรือโหลดชุดตัวอย่างในหน้าเอกสาร</p>
          </Empty>
        )}
        {shown.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th style={{ width: "38%" }}>คำถาม · คำตอบอ้างอิง</th><th>Evidence</th><th>ที่มา</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((q) => (
                  <tr key={q.id}>
                    <td style={{ verticalAlign: "top" }}>
                      <div style={{ color: "var(--text)" }}>{q.question}</div>
                      <div className="small sec">{q.answer}</div>
                    </td>
                    <td className="small" style={{ verticalAlign: "top" }}>
                      <div>{q.evidence_text}</div>
                      <div className="meta" style={{ marginTop: 4 }}>{q.doc_name}</div>
                    </td>
                    <td className="meta" style={{ verticalAlign: "top" }}>{q.source}</td>
                    <td className="num" style={{ verticalAlign: "top" }}>
                      <button className="btn ghost sm icon-only" aria-label="ลบ" onClick={() => remove(q.id)}><Trash2 className="icon" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AddQA({ docs, onDone }: { docs: Doc[]; onDone: () => void }) {
  const [f, setF] = useState({ question: "", answer: "", evidence: "", document_id: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError(null);
    try {
      await api.post("/qa", { ...f, document_id: f.document_id || null });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="card card-pad stack-16 enter">
      <div className="form-grid">
        <label className="field"><span>คำถาม</span><input className="input" value={f.question} onChange={set("question")} /></label>
        <label className="field"><span>คำตอบอ้างอิง</span><input className="input" value={f.answer} onChange={set("answer")} /></label>
      </div>
      <div className="form-grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <label className="field">
          <span>Evidence · คัดลอกข้อความจากเอกสารมาตรงตัว</span>
          <textarea className="input" rows={3} value={f.evidence} onChange={set("evidence")} />
        </label>
        <label className="field">
          <span>เอกสาร</span>
          <select className="input" value={f.document_id} onChange={set("document_id")}>
            <option value="">ค้นหาทุกเอกสาร</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="actions"><button className="btn primary" onClick={save} disabled={!f.question || !f.evidence}>บันทึก</button></div>
    </div>
  );
}

function GenerateQA({ docs, onDone }: { docs: Doc[]; onDone: (msg: string) => void }) {
  const { status } = useStatus();
  const [f, setF] = useState({ max_questions: 20, per_passage: 2, passage_chars: 800 });
  const [picked, setPicked] = useState<string[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = !!status?.llm_available;
  const running = job?.status === "running";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value) });

  async function start() {
    setError(null);
    try {
      const j = await api.post<Job>("/qa/generate", { ...f, document_ids: picked });
      const done = await pollJob(j.id, setJob);
      if (done.status === "failed") setError(done.error);
      else onDone(done.message);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="card card-pad stack-16 enter">
      {!ready && <div className="notice">ยังไม่ได้ตั้งค่า LLM <Link to="/settings">ไปที่หน้าตั้งค่า</Link></div>}
      <p className="small sec" style={{ margin: 0 }}>
        LLM อ่านเอกสารทีละช่วง เขียนคำถามแบบที่ผู้ใช้จริงจะถาม และคัดลอก evidence จากเอกสารตรงตัว ข้อที่หา evidence ไม่เจอจะถูกตัดทิ้ง ควรอ่านตรวจก่อนใช้เป็นชุดทดสอบจริง
        {ready && <> ใช้ <span className="mono">{status!.llm.model}</span></>}
      </p>
      <div className="form-grid">
        <label className="field"><span>จำนวนคำถามสูงสุด</span><input className="input mono" type="number" min={1} value={f.max_questions} onChange={set("max_questions")} /></label>
        <label className="field"><span>คำถามต่อช่วง</span><input className="input mono" type="number" min={1} max={5} value={f.per_passage} onChange={set("per_passage")} /></label>
        <label className="field"><span>ความยาวช่วง (ตัวอักษร)</span><input className="input mono" type="number" min={200} step={100} value={f.passage_chars} onChange={set("passage_chars")} /></label>
      </div>
      <div className="actions" style={{ gap: 16 }}>
        {docs.map((d) => {
          const all = picked.length ? picked : docs.map((x) => x.id);
          return (
            <label className="check small" key={d.id}>
              <input type="checkbox" checked={all.includes(d.id)}
                     onChange={(e) => setPicked(e.target.checked ? [...all, d.id] : all.filter((x) => x !== d.id))} />
              {d.name}
            </label>
          );
        })}
      </div>
      <JobProgress job={job} unit="ช่วง" />
      <ErrorNote error={error} />
      <div className="actions">
        <button className="btn primary" onClick={start} disabled={!ready || running}>{running ? "กำลังสร้าง" : "สร้างคำถาม"}</button>
      </div>
    </div>
  );
}
