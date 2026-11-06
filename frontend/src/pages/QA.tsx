import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChunkMap } from "../components/ChunkMap";
import { Download, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { api, errorText } from "../api";
import { Busy, useAction, useFeedback } from "../feedback";
import { useStatus } from "../status";
import type { ChunkCfg, Doc, Job, QA } from "../types";
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
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "map" ? "map" : "table";
  const setView = (v: "table" | "map") => setParams(v === "map" ? { view: "map" } : {}, { replace: true });
  const [cfg, setCfg] = useState<ChunkCfg>({ strategy: "recursive", size: 400, overlap: 50 });
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importJob, setImportJob] = useState<Job | null>(null);
  const { track, jobs, toast } = useFeedback();
  const { run, busy } = useAction();

  const load = () =>
    api.get<QA[]>(`/qa?strategy=${cfg.strategy}&size=${cfg.size}&overlap=${cfg.overlap}`).then(setItems).catch((e) => setError(errorText(e)));
  const reload = () => { load(); refresh(); };
  useEffect(() => { api.get<Doc[]>("/documents").then(setDocs); }, []);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [cfg.strategy, cfg.size, cfg.overlap]);
  const docName = (id: string) => docs.find((d) => d.id === id)?.name ?? "";
  const chunkHref = (docId: string, n: number) =>
    `/documents/${docId}?strategy=${cfg.strategy}&size=${cfg.size}&overlap=${cfg.overlap}&chunk=${n}`;

  // Imports run as a background job; the tray shows progress, this page shows the result.
  async function importFile(f: File, mode: "merge" | "replace") {
    if (mode === "replace" && items?.length && !confirm(`แทนที่คำถามทั้งหมด ${items.length} ข้อด้วยไฟล์นี้? คำถามที่ไม่อยู่ในไฟล์จะถูกลบ`)) return;
    setPendingFile(null);
    setNote(null);
    const job = await run("import", () => api.upload<Job>(`/qa/import?mode=${mode}`, [f], "file"));
    if (!job) return;
    setImportJob(job);
    track(job, (done) => {
      const r = done.result as { errors: { row: number; error: string }[] } | undefined;
      if (r?.errors.length) setNote(`แถวที่นำเข้าไม่ได้: ${r.errors.slice(0, 5).map((x) => `แถว ${x.row} ${x.error}`).join(" · ")}${r.errors.length > 5 ? ` และอีก ${r.errors.length - 5} แถว` : ""}`);
      reload();
    });
  }
  const liveImport = importJob ? jobs.find((j) => j.id === importJob.id) ?? null : null;

  async function remove(id: string) {
    setItems((xs) => xs?.filter((q) => q.id !== id) ?? xs); // show it gone right away
    const ok = await run("del:" + id, () => api.del("/qa/" + id), "ลบคำถามแล้ว");
    if (ok === undefined) load();
    refresh();
  }
  async function clearAll() {
    if (!items || !confirm(`ลบคำถามทั้งหมด ${items.length} ข้อ?`)) return;
    setItems([]);
    await run("clear", () => api.del("/qa"), "ลบคำถามทั้งหมดแล้ว");
    reload();
  }
  function download(format: "xlsx" | "csv") {
    window.location.href = `/api/qa/export?format=${format}`;
    toast(format === "xlsx" ? "กำลังดาวน์โหลด qa.xlsx" : "กำลังดาวน์โหลด qa.csv", "info");
  }

  const shown = (items ?? []).filter((q) => !query || q.question.includes(query) || q.answer.includes(query) || q.evidence_text.includes(query));
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);

  return (
    <div className="stack">
      <PageHead title="ชุดคำถาม" sub="แต่ละข้อมีคำถาม คำตอบอ้างอิง และ evidence คือข้อความในเอกสารที่ใช้ตอบ ระบบเทียบตำแหน่ง evidence กับ chunk ที่ค้นเจอ ชุดเดียวจึงใช้ได้กับทุกวิธีตัด chunk">
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={liveImport?.status === "running"}>
          <Busy busy={busy("import") || liveImport?.status === "running"} label="กำลังนำเข้า"><Upload className="icon" />นำเข้า</Busy>
        </button>
        <button className="btn" onClick={() => download("xlsx")} disabled={!items?.length}><Download className="icon" />Excel</button>
        <button className="btn ghost" onClick={() => download("csv")} disabled={!items?.length}>CSV</button>
        <button className="btn" onClick={() => toggle("generate")}>สร้างด้วย LLM</button>
        <button className="btn primary" onClick={() => toggle("add")}><Plus className="icon" />เพิ่มคำถาม</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.json" hidden
               onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setPendingFile(f); }} />
      </PageHead>
      <ErrorNote error={error} />
      {pendingFile && (
        <div className="card card-pad import-bar enter">
          <span className="grow">นำเข้า <span className="mono">{pendingFile.name}</span> แถวที่มี id ตรงกับคำถามเดิมจะถูกอัปเดต แถวที่ใส่ use = no จะถูกข้าม</span>
          <button className="btn primary" onClick={() => importFile(pendingFile, "merge")}>รวมกับชุดเดิม</button>
          <button className="btn" onClick={() => importFile(pendingFile, "replace")}>แทนที่ทั้งชุด</button>
          <button className="btn ghost icon-only" aria-label="ยกเลิก" onClick={() => setPendingFile(null)}><X className="icon" /></button>
        </div>
      )}
      {liveImport && liveImport.status === "running" && (
        <div className="card card-pad stack-8">
          <div className="small sec">{liveImport.title}</div>
          <JobProgress job={liveImport} unit="แถว" />
        </div>
      )}
      {note && <div className="notice">{note}</div>}
      {panel === "add" && <AddQA docs={docs} onDone={() => { setPanel(null); reload(); }} />}
      {panel === "generate" && <GenerateQA docs={docs} onDone={(m) => { setNote(m); reload(); }} />}

      <div className="card">
        <div className="card-head" style={{ alignItems: "center" }}>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <h2>{items ? `${items.length} คำถาม` : "…"}</h2>
            <div className="seg">
              <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>ตาราง</button>
              <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>แผนผัง chunk</button>
            </div>
            <ChunkCfgPicker cfg={cfg} onChange={setCfg} />
          </div>
          <div className="actions">
            {view === "table" && <div style={{ position: "relative" }}>
              <Search className="icon" style={{ position: "absolute", left: 10, top: 8, color: "var(--muted)" }} />
              <input className="input" style={{ width: 220, height: 32, paddingLeft: 32 }} placeholder="ค้นหา"
                     value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>}
            {!!items?.length && <button className="btn ghost sm" onClick={clearAll} disabled={busy("clear")}><Busy busy={busy("clear")}>ลบทั้งหมด</Busy></button>}
          </div>
        </div>
        {items && items.length === 0 && (
          <Empty title="ยังไม่มีคำถาม">
            <p>นำเข้า CSV ที่มีคอลัมน์ <code>question, answer, evidence, document</code> ให้ LLM สร้างจากเอกสาร หรือโหลดชุดตัวอย่างในหน้าเอกสาร</p>
          </Empty>
        )}
        {view === "map" && !!items?.length && <ChunkMap cfg={cfg} docs={docs} items={items} />}
        {view === "table" && shown.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th style={{ width: "34%" }}>คำถาม · คำตอบอ้างอิง</th><th>Evidence</th><th title="chunk ที่ครอบ evidence ตาม config ที่เลือกด้านบน">อยู่ใน chunk</th><th>ที่มา</th><th /></tr>
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
                    <td style={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                      {q.chunks?.length ? (
                        <div className="stack-8" style={{ gap: 2 }}>
                          {q.chunks.map((c) => (
                            <Link key={c.id} className="mono small" to={chunkHref(c.doc_id, c.number)} title={docName(c.doc_id)}>#{c.number}</Link>
                          ))}
                        </div>
                      ) : <span className="small" style={{ color: "var(--negative)" }} title="ไม่มี chunk ไหนครอบ evidence ได้ครึ่งหนึ่ง">ไม่มี</span>}
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
  const [saving, setSaving] = useState(false);
  const { toast } = useFeedback();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api.post("/qa", { ...f, document_id: f.document_id || null });
      toast("เพิ่มคำถามแล้ว");
      onDone();
    } catch (e) {
      setError(errorText(e)); // shown next to the form, since it is usually about the evidence text
    }
    setSaving(false);
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
      <div className="actions"><button className="btn primary" onClick={save} disabled={saving || !f.question || !f.evidence}><Busy busy={saving} label="กำลังบันทึก">บันทึก</Busy></button></div>
    </div>
  );
}

function GenerateQA({ docs, onDone }: { docs: Doc[]; onDone: (msg: string) => void }) {
  const { status } = useStatus();
  const [f, setF] = useState({ max_questions: 20, per_passage: 2, passage_chars: 800 });
  const [picked, setPicked] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { track, jobs } = useFeedback();
  const { run, busy } = useAction();
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const ready = !!status?.llm_available;
  const running = busy("gen") || job?.status === "running";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value) });

  async function start() {
    setError(null);
    const j = await run("gen", () => api.post<Job>("/qa/generate", { ...f, document_ids: picked }));
    if (!j) return;
    setJobId(j.id);
    track(j, (done) => onDone(done.message)); // keeps running in the background if you leave the page
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
        <button className="btn primary" onClick={start} disabled={!ready || running}><Busy busy={running} label="กำลังสร้าง">สร้างคำถาม</Busy></button>
      </div>
    </div>
  );
}

function ChunkCfgPicker({ cfg, onChange }: { cfg: ChunkCfg; onChange: (c: ChunkCfg) => void }) {
  return (
    <div className="row" title="config ที่ใช้คำนวณว่าคำถามอยู่ใน chunk ไหน">
      <select className="input" style={{ height: 32, width: 120 }} aria-label="วิธีตัด chunk" value={cfg.strategy}
              onChange={(e) => onChange({ ...cfg, strategy: e.target.value })}>
        <option>char</option><option>word</option><option>recursive</option>
      </select>
      <input className="input mono" style={{ height: 32, width: 76 }} type="number" min={50} step={50} aria-label="ขนาด"
             value={cfg.size} onChange={(e) => onChange({ ...cfg, size: Number(e.target.value) })} />
      <span className="meta">/</span>
      <input className="input mono" style={{ height: 32, width: 64 }} type="number" min={0} step={10} aria-label="overlap"
             value={cfg.overlap} onChange={(e) => onChange({ ...cfg, overlap: Number(e.target.value) })} />
    </div>
  );
}
