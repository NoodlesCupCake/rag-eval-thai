import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Database, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useStatus } from "../status";
import { Busy, useAction, useFeedback } from "../feedback";
import type { Job } from "../types";
import { date } from "../format";
import { Empty, PageHead } from "../components/ui";
import { Term } from "../components/Term";

/* The embedding store: one index per (documents, chunking, model). Build one, then open
   it to see every chunk on an x/y map and search it. */

export interface IndexMeta {
  id: string; model: string; chunking: { strategy: string; size: number; overlap: number };
  n_chunks: number; dim: number; size_bytes: number; created_at: number; encode_seconds: number;
  device: string; stale: boolean; docs: { id: string; name: string }[];
}

const kb = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
export const shortModel = (m: string) => (m.startsWith("api:") ? m.split(":").slice(1).join(" · ") : m.split("/").pop() ?? m);

/** Open the index for a config, building it first if needed. */
export function useOpenIndex() {
  const navigate = useNavigate();
  const { track, toast } = useFeedback();
  const { run, busy } = useAction();
  async function open(chunking: IndexMeta["chunking"], model: string) {
    const r = await run("index", () => api.post<Job & { existing?: string }>("/indexes", { chunking, model }));
    if (!r) return;
    if (r.existing) { navigate("/indexes/" + r.existing); return; }
    toast("กำลังสร้าง index ดูความคืบหน้าที่มุมขวาล่าง", "info");
    track(r, (done) => { const id = (done.result as { index?: string } | undefined)?.index; if (id) navigate("/indexes/" + id); });
  }
  return { open, busy: busy("index") };
}

export function IndexesPage() {
  const { status } = useStatus();
  const navigate = useNavigate();
  const { run } = useAction();
  const { open, busy } = useOpenIndex();
  const [list, setList] = useState<IndexMeta[] | null>(null);
  const [form, setForm] = useState(false);
  const [chunking, setChunking] = useState({ strategy: "recursive", size: 400, overlap: 50 });
  const [model, setModel] = useState("intfloat/multilingual-e5-small");
  const load = () => api.get<IndexMeta[]>("/indexes").then(setList);
  useEffect(() => { load(); }, []);

  async function remove(m: IndexMeta) {
    if (!confirm(`ลบ index ${shortModel(m.model)} (${m.n_chunks} chunks)?`)) return;
    setList((l) => l?.filter((x) => x.id !== m.id) ?? l);
    await run("del", () => api.del("/indexes/" + m.id), "ลบ index แล้ว");
    load();
  }

  return (
    <div className="stack">
      <PageHead title="คลัง Embedding" sub="เก็บเวกเตอร์ของทุก chunk ตามเอกสาร วิธีตัด chunk และโมเดล เปิดดูเป็นแผนที่ x, y และลองค้นได้ เหมือนดูข้างใน vector database">
        <button className="btn primary" onClick={() => setForm(!form)}><Plus className="icon" />สร้าง index</button>
      </PageHead>

      {form && (
        <div className="card card-pad stack-16 enter">
          <div className="form-grid">
            <label className="field"><span><Term k="strategy">วิธีตัด</Term></span>
              <select className="input" value={chunking.strategy} onChange={(e) => setChunking({ ...chunking, strategy: e.target.value })}>
                <option>char</option><option>word</option><option>recursive</option></select></label>
            <label className="field"><span><Term k="size">ขนาด</Term></span>
              <input className="input mono" type="number" min={50} step={50} value={chunking.size} onChange={(e) => setChunking({ ...chunking, size: Number(e.target.value) })} /></label>
            <label className="field"><span><Term k="overlap">overlap</Term></span>
              <input className="input mono" type="number" min={0} step={10} value={chunking.overlap} onChange={(e) => setChunking({ ...chunking, overlap: Number(e.target.value) })} /></label>
          </div>
          <label className="field"><span>Embedding model · Hugging Face หรือ API ที่เพิ่มไว้ในหน้าตั้งค่า</span>
            <input className="input mono" list="idx-models" value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id="idx-models">{status?.suggested_models.map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}</datalist></label>
          <div className="actions">
            <button className="btn accent" onClick={() => { open(chunking, model); setForm(false); }} disabled={busy || !model.trim()}>
              <Busy busy={busy} label="กำลังเริ่ม">สร้างและเปิด</Busy>
            </button>
            <span className="small muted">ใช้เอกสารทั้งหมดตอนนี้ {status?.counts.documents ?? 0} ฉบับ</span>
          </div>
        </div>
      )}

      <div className="card">
        {list && !list.length && (
          <Empty title="ยังไม่มี index">
            <p>สร้าง index จากเอกสารที่มี หรือกด “เปิดในคลัง” จากหน้าผลประเมิน Embedding</p>
            <button className="btn accent" onClick={() => setForm(true)}><Plus className="icon" />สร้าง index แรก</button>
          </Empty>
        )}
        {!!list?.length && (
          <div className="idx-grid">
            {list.map((m) => (
              <div key={m.id} className="idx-card" role="link" tabIndex={0} onClick={() => navigate("/indexes/" + m.id)} onKeyDown={(e) => e.key === "Enter" && navigate("/indexes/" + m.id)}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <Database className="icon" style={{ color: "var(--accent-ink)" }} />
                  {m.stale && <span className="kind-badge" title="เอกสารเปลี่ยนหลังสร้าง index นี้">เอกสารเปลี่ยนแล้ว</span>}
                </div>
                <div className="idx-model">{shortModel(m.model)}</div>
                <div className="meta">{m.model.startsWith("api:") ? "API" : m.model.split("/")[0]}</div>
                <div className="idx-stats">
                  <span><b>{m.n_chunks}</b> chunks</span>
                  <span><b>{m.dim}</b> มิติ</span>
                  <span><b>{kb(m.size_bytes)}</b></span>
                </div>
                <div className="row meta" style={{ justifyContent: "space-between" }}>
                  <span>{m.chunking.strategy}·{m.chunking.size}{m.chunking.overlap ? `/${m.chunking.overlap}` : ""} · {date(m.created_at)}</span>
                  <button className="btn ghost sm icon-only" aria-label="ลบ" onClick={(e) => { e.stopPropagation(); remove(m); }}><Trash2 className="icon" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="small muted">ไฟล์เก็บที่ <code>data/indexes/</code> · ถ้าเพิ่มหรือแก้เอกสาร index เดิมจะขึ้นว่า “เอกสารเปลี่ยนแล้ว” ให้สร้างใหม่ · ประเมินแบบเต็มที่ <Link to="/bench">ประเมิน Embedding</Link></div>
    </div>
  );
}
