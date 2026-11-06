import { useEffect, useState } from "react";
import { api } from "../api";
import { useStatus } from "../status";
import { Busy, useAction } from "../feedback";

/* Query / passage prompts per embedding model. Known families come with their documented
   prompt; any model can be overridden here. Results and indexes record what they used. */

interface Prompt { model: string; query: string; passage: string; source: "default" | "custom" | "none"; note: string; default: { query: string; passage: string; note: string } }

export function ModelPrompts() {
  const { status } = useStatus();
  const { run, busy } = useAction();
  const [model, setModel] = useState("intfloat/multilingual-e5-small");
  const [p, setP] = useState<Prompt | null>(null);
  const [q, setQ] = useState("");
  const [d, setD] = useState("");

  useEffect(() => {
    if (!model.trim()) return;
    const t = setTimeout(() => api.get<Prompt>(`/model-prompts?model=${encodeURIComponent(model.trim())}`).then((r) => { setP(r); setQ(r.query); setD(r.passage); }), 250);
    return () => clearTimeout(t);
  }, [model]);

  async function save() {
    const r = await run("save", () => api.put<Prompt>("/model-prompts", { model: model.trim(), query: q, passage: d }), "บันทึก prompt แล้ว ใช้กับการรันและ index ครั้งถัดไป");
    if (r) setP(r);
  }
  async function reset() {
    const r = await run("reset", () => api.del<Prompt>(`/model-prompts?model=${encodeURIComponent(model.trim())}`), "กลับไปใช้ค่าแนะนำแล้ว");
    if (r) { setP(r); setQ(r.query); setD(r.passage); }
  }
  const changed = p && (q !== p.query || d !== p.passage);

  return (
    <div className="card card-pad stack-16">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 className="method-title" style={{ fontSize: 15 }}>Prompt ของ embedding model</h2>
        {p && <span className={"kind-badge" + (p.source === "custom" ? " rag" : "")}>{p.source === "custom" ? "ตั้งเอง" : p.source === "default" ? "ค่าแนะนำ" : "ไม่มี prompt"}</span>}
      </div>
      <p className="small sec" style={{ margin: 0 }}>
        หลายโมเดลถูกฝึกให้มีคำนำหน้า ถ้าไม่ใส่คะแนนจะต่ำกว่าความจริง เช่น e5 ใช้ <code>query:</code> / <code>passage:</code>
        และ Qwen3-Embedding ใช้คำสั่งเฉพาะฝั่งคำถาม ระบบใส่ค่าแนะนำให้อัตโนมัติ แก้ได้ที่นี่
      </p>
      <label className="field"><span>Model</span>
        <input className="input mono" list="prompt-models" value={model} onChange={(e) => setModel(e.target.value)} />
        <datalist id="prompt-models">{status?.suggested_models.map((m) => <option key={m.id} value={m.id} />)}</datalist></label>
      <div className="form-grid">
        <label className="field"><span>คำนำหน้าคำถาม (query)</span>
          <textarea className="input mono" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ไม่มี" /></label>
        <label className="field"><span>คำนำหน้า chunk (passage)</span>
          <textarea className="input mono" rows={3} value={d} onChange={(e) => setD(e.target.value)} placeholder="ไม่มี" /></label>
      </div>
      {p && <div className="small muted">ค่าแนะนำ: {p.default.note}{p.default.query || p.default.passage ? <> · query <code>{JSON.stringify(p.default.query)}</code> · passage <code>{JSON.stringify(p.default.passage)}</code></> : null}</div>}
      <div className="actions">
        <button className="btn primary" onClick={save} disabled={!changed || busy("save")}><Busy busy={busy("save")}>บันทึก</Busy></button>
        {p?.source === "custom" && <button className="btn ghost" onClick={reset} disabled={busy("reset")}>กลับไปใช้ค่าแนะนำ</button>}
        <span className="small muted">เปลี่ยน prompt แล้ว index เดิมในคลังจะไม่ถูกใช้ซ้ำ ระบบสร้างใหม่ให้</span>
      </div>
    </div>
  );
}
