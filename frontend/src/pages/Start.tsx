import { useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Upload } from "lucide-react";
import { api, errorText, pollJob } from "../api";
import { useStatus } from "../status";
import type { Job, Status } from "../types";
import { ErrorNote, JobProgress } from "../components/ui";
import { Busy, useFeedback } from "../feedback";
import { Term } from "../components/Term";

/* First-run setup: four steps from an empty app to a first benchmark result. Each step
   can be done in place. The LLM step is optional and can be skipped, and the whole
   flow can be dismissed; the sidebar keeps a link back with progress. */

const SKIP_LLM = "rag-eval-skip-llm";
export const DISMISSED = "rag-eval-onboarding-dismissed";

const read = (k: string) => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };
const write = (k: string, v: boolean) => { try { v ? localStorage.setItem(k, "1") : localStorage.removeItem(k); } catch { /* ignore */ } };

export function setupSteps(status: Status | null, llmSkipped = read(SKIP_LLM)) {
  const c = status?.counts;
  return [
    { key: "docs", done: !!c?.documents },
    { key: "qa", done: !!c?.qa },
    { key: "llm", done: !!status?.llm_available || llmSkipped, optional: true },
    { key: "run", done: !!c?.runs },
  ];
}

export const isDismissed = () => read(DISMISSED);

const QUICK_RUN = {
  name: "รอบแรก",
  chunkings: [
    { strategy: "char", size: 400, overlap: 0 },
    { strategy: "word", size: 400, overlap: 50 },
    { strategy: "recursive", size: 400, overlap: 50 },
  ],
  retrievers: [
    { type: "bm25", model: null },
    { type: "dense", model: "intfloat/multilingual-e5-small" },
    { type: "hybrid", model: "intfloat/multilingual-e5-small" },
  ],
  k_max: 10,
};

export function StartPage() {
  const { status, refresh } = useStatus();
  const navigate = useNavigate();
  const [llmSkipped, setLlmSkipped] = useState(read(SKIP_LLM));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast, track } = useFeedback();
  const [what, setWhat] = useState<string | null>(null);

  const steps = setupSteps(status, llmSkipped);
  const current = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const c = status?.counts;

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setWhat(key);
    setError(null);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "kind" in r) track(r as Job, () => refresh()); // background job
      else if (ok) toast(ok);
      refresh();
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
    setWhat(null);
  }
  const skipLlm = (v: boolean) => { write(SKIP_LLM, v); setLlmSkipped(v); };
  const dismiss = () => { write(DISMISSED, true); navigate("/documents"); };

  async function quickRun() {
    setError(null);
    try {
      const j = await api.post<Job>("/runs", QUICK_RUN);
      refresh();
      const done = await pollJob(j.id, setJob);
      if (done.status === "failed") setError(done.error);
      else { write(DISMISSED, true); navigate("/runs/" + j.run_id); }
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1>เริ่มต้นใช้งาน</h1>
          <p>4 ขั้นจากแอปว่าง ๆ ไปถึงผล benchmark แรก วัดว่า RAG ของคุณค้นเจอข้อความที่ตอบคำถามได้บ่อยแค่ไหน และเร็วแค่ไหน</p>
        </div>
        <div className="actions">
          <span className="meta">{doneCount}/4 เสร็จ</span>
          <button className="btn ghost" onClick={dismiss}>ข้ามไปก่อน</button>
        </div>
      </div>
      <ErrorNote error={error} />

      <ol className="stepper">
        <Step n={1} title="เพิ่มเอกสาร" done={steps[0].done} open={current === 0}
              summary={c?.documents ? `${c.documents} เอกสาร` : undefined}>
          <p>เอกสารที่ RAG จะค้นหาคำตอบ เช่น ระเบียบบริษัท คู่มือ หรือ FAQ รองรับ .txt .md และ .pdf ถ้ายังไม่มี เริ่มจากชุดตัวอย่างได้ เป็นเอกสารภาษาไทยสมมติ 3 ฉบับพร้อมคำถาม 29 ข้อ ทำให้ขั้นที่ 2 เสร็จไปด้วย</p>
          <div className="actions">
            <button className="btn accent" disabled={busy} onClick={() => act("samples", () => api.post("/samples"), "โหลดชุดตัวอย่างแล้ว")}>
              <Busy busy={what === "samples"} label="กำลังโหลด">โหลดชุดตัวอย่าง</Busy>
            </button>
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Busy busy={what === "upload"} label="กำลังอัปโหลด"><Upload className="icon" />อัปโหลดเอกสารของฉัน</Busy>
            </button>
            <input ref={fileRef} type="file" multiple accept=".txt,.md,.pdf" hidden
                   onChange={(e) => {
                     const files = [...(e.target.files ?? [])];
                     e.target.value = "";
                     if (files.length) act("upload", () => api.upload("/documents", files));
                   }} />
          </div>
        </Step>

        <Step n={2} title="สร้างชุดคำถาม" done={steps[1].done} open={current === 1}
              summary={c?.qa ? `${c.qa} คำถาม` : undefined}>
          <p>แต่ละข้อคือคำถามที่ผู้ใช้จริงจะถาม คู่กับ evidence คือข้อความในเอกสารที่ใช้ตอบ ระบบเช็กว่า chunk ที่ค้นได้มี evidence นี้หรือไม่ ควรมีอย่างน้อย 30 ข้อ ถ้าจะใช้ตัดสินใจจริงควรมี 100 ข้อขึ้นไป</p>
          <div className="actions">
            <Link className="btn primary" to="/qa">นำเข้า CSV หรือเพิ่มเอง</Link>
            {status?.llm_available
              ? <Link className="btn" to="/qa">ให้ LLM สร้างจากเอกสาร</Link>
              : <span className="small muted">หรือตั้งค่า LLM ในขั้นที่ 3 แล้วให้ LLM สร้างให้</span>}
          </div>
        </Step>

        <Step n={3} title="ตั้งค่า LLM" done={steps[2].done} open={current === 2} optional
              summary={status?.llm_available ? status.llm.model : llmSkipped ? "ข้ามแล้ว" : undefined}>
          <p>ใช้ Claude, Ollama, LM Studio หรือ server ที่รองรับ OpenAI API เพื่อสร้างชุดคำถามอัตโนมัติ และให้คะแนนคำตอบ การวัด retrieval ในขั้นที่ 4 ไม่ต้องใช้ LLM จึงข้ามได้</p>
          <div className="actions">
            <Link className="btn primary" to="/settings">ตั้งค่า LLM</Link>
            <button className="btn ghost" onClick={() => skipLlm(true)}>ข้ามขั้นนี้</button>
          </div>
        </Step>

        <Step n={4} title="รัน benchmark แรก" done={steps[3].done} open={current === 3}
              summary={c?.runs ? `${c.runs} รอบ` : undefined}>
          <p>
            รันแบบเร็วด้วยค่าที่แนะนำ ตัด chunk 3 วิธีที่ขนาด 400 ตัวอักษร คู่กับ retriever 3 แบบ รวม 9 config
            แล้วดู <Term k="hit@3">Hit@3</Term>, <Term k="mrr">MRR</Term> และ <Term k="latency_p95_ms">latency p95</Term> ของแต่ละแบบ
            ครั้งแรกจะดาวน์โหลด embedding model ประมาณ 470 MB
          </p>
          <JobProgress job={job} />
          <div className="actions">
            <button className="btn accent" onClick={quickRun} disabled={job?.status === "running" || !c?.qa}>
              <Busy busy={job?.status === "running"} label="กำลังรัน">รันแบบเร็ว</Busy>
            </button>
            <Link className="btn" to="/bench">ตั้งค่าเอง</Link>
            {!c?.qa && <span className="small muted">ต้องมีคำถามก่อน</span>}
          </div>
        </Step>
      </ol>

      {current === -1 && (
        <div className="card card-pad stack-16 enter">
          <div className="step done"><span className="n"><Check className="icon" style={{ width: 12, height: 12 }} /></span><h2>พร้อมแล้ว</h2></div>
          <p className="small sec" style={{ margin: 0 }}>ลองเปลี่ยนขนาด chunk หรือ embedding model แล้วรันอีกรอบ จากนั้นเลือกหลายรอบในหน้าผลลัพธ์เพื่อเปรียบเทียบ</p>
          <div className="actions">
            <Link className="btn accent" to="/runs" onClick={() => write(DISMISSED, true)}>ดูผลลัพธ์</Link>
            <Link className="btn" to="/bench">รันอีกรอบ</Link>
          </div>
        </div>
      )}
      {llmSkipped && !status?.llm_available && (
        <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => skipLlm(false)}>ยกเลิกการข้ามขั้นตั้งค่า LLM</button>
      )}
    </div>
  );
}

function Step({ n, title, done, open, optional, summary, children }: {
  n: number; title: string; done: boolean; open: boolean; optional?: boolean; summary?: string; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const show = open || expanded;
  return (
    <li className={"stepper-item" + (done ? " done" : "") + (open ? " current" : "")}>
      <span className="stepper-dot">{done ? <Check className="icon" style={{ width: 12, height: 12 }} /> : n}</span>
      <div className="card stepper-card">
        <button className="stepper-head" onClick={() => !open && setExpanded(!expanded)} aria-expanded={show}>
          <span className="stepper-title">{title}</span>
          {optional && <span className="meta">ไม่บังคับ</span>}
          <span className="grow" />
          {summary && <span className="meta">{summary}</span>}
        </button>
        {show && <div className="stepper-body">{children}</div>}
      </div>
    </li>
  );
}
