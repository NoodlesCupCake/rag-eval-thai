import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useStatus } from "../status";
import { Busy, useAction } from "../feedback";
import { ErrorNote } from "./ui";

/* Embedding models served over an API (Voyage, OpenAI, Ollama, any OpenAI-compatible
   /v1/embeddings). Saved providers' models show up in the benchmark model list. */

interface Provider { id: string; name: string; kind: "voyage" | "openai"; base_url: string; models: string[]; api_key_set: boolean; api_key_hint: string }
interface Preset { id: string; label: string; kind: "voyage" | "openai"; base_url: string; models: string; needs_key: boolean }
interface Form { id?: string; name: string; kind: "voyage" | "openai"; base_url: string; api_key: string; models: string; preset: string }

export function EmbeddingProviders() {
  const { refresh } = useStatus();
  const { run, busy } = useAction();
  const [list, setList] = useState<Provider[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [f, setF] = useState<Form | null>(null);
  const [test, setTest] = useState<{ dim: number; ms: number; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<{ providers: Provider[]; presets: Preset[] }>("/embedding-providers").then((r) => { setList(r.providers); setPresets(r.presets); });
  useEffect(() => { load(); }, []);

  const pick = (p: Preset) => { setF({ preset: p.id, name: p.label, kind: p.kind, base_url: p.base_url, api_key: "", models: p.models }); setTest(null); setError(null); };
  const body = () => f && ({ id: f.id, name: f.name, kind: f.kind, base_url: f.base_url, api_key: f.api_key || (f.id ? null : ""),
                             models: f.models.split(",").map((m) => m.trim()).filter(Boolean) });

  async function testAndSave() {
    setError(null); setTest(null);
    try {
      const t = await api.post<{ dim: number; ms: number; model: string }>("/embedding-providers/test", body());
      setTest(t);
      const saved = await run("save", () => api.put<Provider>("/embedding-providers", body()), `บันทึก ${f!.name} แล้ว ใช้ได้ในหน้าประเมิน Embedding`);
      if (saved) { setF(null); load(); refresh(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function remove(p: Provider) {
    if (!confirm(`ลบ ${p.name}? ผลการรันเดิมยังอยู่`)) return;
    await run("del", () => api.del(`/embedding-providers/${p.id}`), "ลบแล้ว");
    load(); refresh();
  }

  return (
    <div className="card card-pad stack-16">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 className="method-title" style={{ fontSize: 15 }}>Embedding ผ่าน API</h2>
        <span className="small muted">โมเดลจาก Hugging Face ไม่ต้องตั้งค่า ใช้ได้เลย</span>
      </div>
      <p className="small sec" style={{ margin: 0 }}>เพิ่ม Voyage, OpenAI หรือ Ollama เพื่อเทียบกับโมเดลที่รันในเครื่อง เอกสารจะถูกส่งไปที่ผู้ให้บริการ และคิดเงินตามการใช้งาน</p>

      {list.map((p) => (
        <div key={p.id} className="list-row" style={{ padding: "8px 0" }}>
          <div className="grow">
            <div style={{ color: "var(--text)" }}>{p.name} <span className="meta">{p.kind === "voyage" ? "Voyage API" : "OpenAI-compatible"} · {p.base_url}</span></div>
            <div className="meta">{p.models.join(", ")}{p.api_key_set ? ` · key ${p.api_key_hint}` : ""}</div>
          </div>
          <button className="btn ghost sm" onClick={() => { setF({ id: p.id, preset: "", name: p.name, kind: p.kind, base_url: p.base_url, api_key: "", models: p.models.join(", ") }); setTest(null); }}>แก้ไข</button>
          <button className="btn ghost sm icon-only" aria-label="ลบ" onClick={() => remove(p)}><Trash2 className="icon" /></button>
        </div>
      ))}

      {!f ? (
        <div className="actions">
          {presets.map((p) => <button key={p.id} className="btn sm" onClick={() => pick(p)}><Plus className="icon" />{p.label}</button>)}
        </div>
      ) : (
        <div className="stack-16 sheet-card">
          <div className="form-grid">
            <label className="field"><span>ชื่อ</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field"><span>Base URL</span><input className="input mono" value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} /></label>
          </div>
          <div className="form-grid">
            <label className="field"><span>API key {f.kind === "openai" && f.base_url.includes("localhost") ? "· Ollama ไม่ต้องใส่" : ""}</span>
              <input className="input mono" type="password" autoComplete="off" value={f.api_key} placeholder={f.id ? "เว้นว่างเพื่อใช้ key เดิม" : ""}
                     onChange={(e) => setF({ ...f, api_key: e.target.value })} /></label>
            <label className="field"><span>Models · คั่นด้วยจุลภาค</span><input className="input mono" value={f.models} onChange={(e) => setF({ ...f, models: e.target.value })} /></label>
          </div>
          <ErrorNote error={error} />
          {test && <div className="notice">เชื่อมต่อได้ · <span className="mono">{test.model}</span> ได้เวกเตอร์ {test.dim.toLocaleString("th-TH")} มิติ ใน {Math.round(test.ms)} ms</div>}
          <div className="actions">
            <button className="btn primary" onClick={testAndSave} disabled={busy("save") || !f.name.trim() || !f.models.trim()}>
              <Busy busy={busy("save")} label="กำลังทดสอบ">ทดสอบและบันทึก</Busy>
            </button>
            <button className="btn ghost" onClick={() => setF(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
}
