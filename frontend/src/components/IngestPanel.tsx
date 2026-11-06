import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { FileUp, X } from "lucide-react";
import { api } from "../api";
import { useStatus } from "../status";
import { Busy, useAction, useFeedback } from "../feedback";
import type { Job } from "../types";

/* Drop any file, see what was detected, adjust, start. FAQ-shaped tables become questions
   directly; other tables and documents go to the LLM. Runs as a background job and opens
   the new QA set when it finishes. */

interface SheetInfo {
  name: string; headers: string[]; n_rows: number; sample: string[][];
  mapping: { question: number | null; answer: number | null; context: number | null };
  mode: "faq" | "table"; truncated: boolean;
}
interface Preview {
  token: string; filename: string; size: number; max_mb: number; kind: "table" | "text";
  sheets?: SheetInfo[]; chars?: number; sample_text?: string;
}
type Mode = "faq" | "table" | "skip";

const ACCEPT = ".xlsx,.csv,.pdf,.docx,.txt,.md";
const mb = (b: number) => (b / 1024 / 1024).toFixed(b < 1024 * 1024 ? 2 : 1) + " MB";

export function IngestPanel({ onDone, onClose }: { onDone: (setId: string) => void; onClose: () => void }) {
  const { status } = useStatus();
  const { run, busy } = useAction();
  const { track, toast } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null);
  const [modes, setModes] = useState<Mode[]>([]);
  const [maps, setMaps] = useState<SheetInfo["mapping"][]>([]);
  const [setName, setSetName] = useState("");
  const [maxQ, setMaxQ] = useState(30);
  const llm = !!status?.llm_available;

  async function upload(f: File) {
    if (f.size > 20 * 1024 * 1024) { toast(`${f.name} ใหญ่ ${mb(f.size)} เกินขีดจำกัด 20 MB`, "error"); return; }
    const r = await run("preview", () => api.upload<Preview>("/ingest/preview", [f], "file"));
    if (!r) return;
    setPv(r);
    setSetName(r.filename.replace(/\.[^.]+$/, ""));
    setModes((r.sheets ?? []).map((s) => s.mode));
    setMaps((r.sheets ?? []).map((s) => ({ ...s.mapping })));
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) upload(f);
  }

  const needsLlm = pv?.kind === "text" || modes.some((m) => m === "table");
  const faqInvalid = (pv?.sheets ?? []).some((_, i) => modes[i] === "faq" && (maps[i].question == null || (maps[i].answer == null && maps[i].context == null)));
  const nothing = pv?.kind === "table" && modes.every((m) => m === "skip");

  async function start() {
    if (!pv) return;
    const job = await run("start", () => api.post<Job>(`/ingest/${pv.token}`, {
      set_name: setName, max_questions: maxQ,
      sheets: (pv.sheets ?? []).map((_, i) => ({ mode: modes[i], mapping: maps[i] })),
    }));
    if (!job) return;
    toast("เริ่มสร้างชุดคำถามแล้ว ดูความคืบหน้าที่มุมขวาล่าง", "info");
    track(job, (done) => { const id = (done.result as { set?: string } | undefined)?.set; if (id) onDone(id); });
    onClose();
  }

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>สร้างชุดคำถามจากไฟล์</h2>
        <button className="btn ghost sm icon-only" aria-label="ปิด" onClick={onClose}><X className="icon" /></button>
      </div>

      {!pv ? (
        <div className="card-pad">
          <div className={"dropzone" + (drag ? " over" : "")} onClick={() => fileRef.current?.click()}
               onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
               role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}>
            {busy("preview") ? <><span className="spin" />กำลังอ่านไฟล์</> : <><FileUp className="icon" style={{ width: 20, height: 20 }} />
              <div><b>ลากไฟล์มาวาง</b> หรือคลิกเพื่อเลือก</div>
              <div className="meta">.xlsx .csv .pdf .docx .txt .md · สูงสุด 20 MB · ตารางไม่เกิน 5,000 แถว</div></>}
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          <ul className="method-list small" style={{ marginTop: 16 }}>
            <li><b>ตารางที่มีคอลัมน์คำถามและคำตอบ</b> (เช่น “คำถาม”, “คำตอบ”, “question”, “answer”) เป็นคำถามได้ทันที ไม่ต้องใช้ LLM</li>
            <li><b>ตารางข้อมูลทั่วไป</b> เช่น รายการสินค้า แต่ละแถวกลายเป็นข้อความ แล้วให้ LLM เขียนคำถาม</li>
            <li><b>PDF, Word, ข้อความ</b> ให้ LLM อ่านแล้วเขียนคำถาม</li>
          </ul>
        </div>
      ) : (
        <div className="card-pad stack-16">
          <div className="row small sec" style={{ flexWrap: "wrap" }}>
            <span className="mono" style={{ color: "var(--text)" }}>{pv.filename}</span>
            <span className="meta">{mb(pv.size)} จาก {pv.max_mb} MB</span>
            <span className="grow" />
            <button className="btn ghost sm" onClick={() => setPv(null)}>เลือกไฟล์อื่น</button>
          </div>

          {pv.kind === "text" && (
            <div className="stack-8">
              <div className="small sec">เอกสาร {pv.chars?.toLocaleString("th-TH")} ตัวอักษร LLM จะอ่านทีละช่วงแล้วเขียนคำถาม</div>
              <pre className="formula" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--sans)", maxHeight: 160, overflow: "auto" }}>{pv.sample_text}…</pre>
            </div>
          )}

          {pv.sheets?.map((s, i) => (
            <div key={i} className="sheet-card stack-8">
              <div className="row" style={{ flexWrap: "wrap" }}>
                <b style={{ fontWeight: 500 }}>{s.name}</b>
                <span className="meta">{s.n_rows.toLocaleString("th-TH")} แถว{s.truncated ? " · ใช้ 5,000 แถวแรก" : ""}</span>
                <span className="grow" />
                <div className="seg">
                  {(["faq", "table", "skip"] as Mode[]).map((m) => (
                    <button key={m} className={modes[i] === m ? "on" : ""} onClick={() => setModes(modes.map((x, j) => (j === i ? m : x)))}>
                      {m === "faq" ? "มีคำถาม-คำตอบ" : m === "table" ? "ตารางข้อมูล ให้ LLM เขียน" : "ข้าม"}
                    </button>
                  ))}
                </div>
              </div>
              {modes[i] === "faq" && (
                <div className="form-grid">
                  {(["question", "answer", "context"] as const).map((role) => (
                    <label key={role} className="field">
                      <span>{role === "question" ? "คอลัมน์คำถาม" : role === "answer" ? "คอลัมน์คำตอบ" : "เนื้อหาอ้างอิง (ไม่บังคับ)"}</span>
                      <select className="input" value={maps[i][role] ?? ""} onChange={(e) => setMaps(maps.map((m, j) => (j === i ? { ...m, [role]: e.target.value === "" ? null : Number(e.target.value) } : m)))}>
                        <option value="">ไม่ใช้</option>
                        {s.headers.map((h, k) => <option key={k} value={k}>{h}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {modes[i] === "faq" && <div className="small muted">ข้อความที่ระบบจะค้นคือ {maps[i].context != null ? "คอลัมน์เนื้อหาอ้างอิง" : "คำถามกับคำตอบของแต่ละแถว"} ส่วน evidence คือ{maps[i].context != null ? "เนื้อหาอ้างอิง" : "คำตอบ"}</div>}
              {modes[i] !== "skip" && (
                <div className="table-wrap sample">
                  <table>
                    <thead><tr>{s.headers.map((h, k) => (
                      <th key={k} className={modes[i] === "faq" && Object.values(maps[i]).includes(k) ? "picked" : ""}>{h}</th>
                    ))}</tr></thead>
                    <tbody>{s.sample.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="small ellipsis" style={{ maxWidth: 240 }}>{c}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          <div className="form-grid">
            <label className="field"><span>ชื่อชุดคำถามใหม่</span><input className="input" value={setName} onChange={(e) => setSetName(e.target.value)} /></label>
            {needsLlm && <label className="field"><span>จำนวนคำถามที่ให้ LLM เขียนสูงสุด</span><input className="input mono" type="number" min={1} max={500} value={maxQ} onChange={(e) => setMaxQ(Number(e.target.value))} /></label>}
          </div>
          {needsLlm && !llm && <div className="notice">ส่วนนี้ต้องใช้ LLM เขียนคำถาม <Link to="/settings">ตั้งค่า LLM</Link> ก่อน หรือเลือก “มีคำถาม-คำตอบ” ถ้าตารางมีคอลัมน์เหล่านั้นอยู่แล้ว</div>}
          {faqInvalid && <div className="small" style={{ color: "var(--negative)" }}>ชีตแบบมีคำถาม-คำตอบต้องเลือกคอลัมน์คำถาม และคำตอบหรือเนื้อหาอ้างอิง</div>}
          <div className="actions">
            <button className="btn accent" onClick={start} disabled={busy("start") || faqInvalid || nothing || (needsLlm && !llm) || !setName.trim()}>
              <Busy busy={busy("start")} label="กำลังเริ่ม">สร้างชุดคำถาม</Busy>
            </button>
            <span className="small muted">ทำงานเบื้องหลัง เปลี่ยนหน้าได้ เสร็จแล้วจะเปิดชุดใหม่ให้</span>
          </div>
        </div>
      )}
    </div>
  );
}
