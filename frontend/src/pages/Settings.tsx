import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import { useStatus } from "../status";
import type { ConnectionTest, LLMSettings, Preset } from "../types";
import { ErrorNote, PageHead } from "../components/ui";
import { Busy, useFeedback } from "../feedback";
import { EmbeddingProviders } from "../components/EmbeddingProviders";
import { PageSkeleton } from "../components/Skeleton";

interface Form {
  preset: string;
  provider: LLMSettings["provider"];
  base_url: string;
  model: string;
  effort: string;
  api_key: string;
}

function Step({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className={"step" + (done ? " done" : "")}>
      <span className="n">{n}</span>
      <h2>{title}</h2>
    </div>
  );
}

export function SettingsPage() {
  const { refresh } = useStatus();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [inDocker, setInDocker] = useState(false);
  const [saved, setSaved] = useState<LLMSettings | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useFeedback();

  useEffect(() => {
    api.get<{ settings: LLMSettings; presets: Preset[]; in_docker: boolean }>("/settings").then((r) => {
      setPresets(r.presets);
      setInDocker(r.in_docker);
      setSaved(r.settings);
      setF({ ...r.settings, api_key: "" });
    });
  }, []);
  if (!f) return <PageSkeleton variant="form" />;

  const isClaude = f.provider === "anthropic";
  const keyKept = !!saved && saved.provider === f.provider && saved.api_key_set;
  const edit = (patch: Partial<Form>) => { setF({ ...f, ...patch }); setResult(null); setError(null); };
  const choose = (p: Preset) => edit({ preset: p.id, provider: p.provider, base_url: p.base_url, model: p.model, api_key: "" });
  const body = () => ({ ...f, api_key: f.api_key ? f.api_key : keyKept ? null : "" });
  const models = result?.models ?? [];

  async function testAndSave() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<ConnectionTest>("/settings/test", body());
      setResult(r);
      if (r.ok) {
        setSaved(await api.put<LLMSettings>("/settings", body()));
        toast(`เชื่อมต่อ ${r.model} ได้ บันทึกแล้ว`);
        setF((cur) => (cur ? { ...cur, api_key: "" } : cur));
        refresh();
      }
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  }

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHead title="ตั้งค่า" sub="ใช้สร้างชุดคำถาม ตอบคำถามจาก chunk ที่ค้นเจอ และให้คะแนนคำตอบ การวัด retrieval ไม่ต้องใช้ LLM" />

      <div className="card card-pad stack-16">
        <Step n={1} title="ผู้ให้บริการ" done />
        <div className="seg">
          {presets.map((p) => (
            <button key={p.id} className={f.preset === p.id ? "on" : ""} onClick={() => choose(p)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card card-pad stack-16">
        <Step n={2} title="การเชื่อมต่อ" done={!!result?.ok} />
        <label className="field">
          <span>Base URL {isClaude ? "· ว่างไว้เพื่อใช้ api.anthropic.com" : "· Ollama และ LM Studio ลงท้ายด้วย /v1"}</span>
          <input className="input mono" value={f.base_url} onChange={(e) => edit({ base_url: e.target.value })}
                 placeholder={isClaude ? "https://api.anthropic.com" : "http://localhost:11434/v1"} />
        </label>
        <label className="field">
          <span>API key {isClaude ? "" : "· Ollama และ LM Studio ไม่ต้องใส่"}</span>
          <input className="input mono" type="password" autoComplete="off" value={f.api_key} onChange={(e) => edit({ api_key: e.target.value })}
                 placeholder={keyKept ? `บันทึกไว้แล้ว ${saved!.api_key_hint} · พิมพ์ใหม่เพื่อเปลี่ยน` : isClaude ? "sk-ant-…" : "ไม่บังคับ"} />
        </label>
        <div className="form-grid" style={{ gridTemplateColumns: isClaude ? "2fr 1fr" : "1fr" }}>
          <label className="field">
            <span>Model {models.length ? `· server มี ${models.length} โมเดล` : "· เว้นว่างแล้วกดทดสอบเพื่อดึงรายชื่อ"}</span>
            {models.length ? (
              <select className="input mono" value={models.includes(f.model) ? f.model : ""} onChange={(e) => setF({ ...f, model: e.target.value })}>
                <option value="">เลือกโมเดล</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input mono" value={f.model} onChange={(e) => edit({ model: e.target.value })}
                     placeholder={isClaude ? "claude-opus-5-5" : "qwen2.5:7b"} />
            )}
          </label>
          {isClaude && (
            <label className="field">
              <span>Effort</span>
              <select className="input" value={f.effort} onChange={(e) => edit({ effort: e.target.value })}>
                {["low", "medium", "high"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
          )}
        </div>
        {inDocker && !isClaude && (
          <div className="small muted">แอปรันใน Docker: Ollama หรือ LM Studio บนเครื่องนี้เข้าถึงได้ที่ <code>host.docker.internal</code> ไม่ใช่ localhost</div>
        )}
        {f.preset === "ollama" && <div className="small muted">ยังไม่มีโมเดล รัน <code>ollama pull qwen2.5:7b</code> บนเครื่องก่อน</div>}
        <ErrorNote error={error} />
        {result && !result.ok && <div className="notice">{result.note}</div>}
        <div className="actions">
          <button className="btn primary" onClick={testAndSave} disabled={busy || (!isClaude && !f.base_url)}>
            <Busy busy={busy} label="กำลังทดสอบ">ทดสอบการเชื่อมต่อ</Busy>
          </button>
          <span className="small muted">ผ่านแล้วจะบันทึกให้อัตโนมัติ</span>
        </div>
      </div>

      {result?.ok ? (
        <div className="card card-pad stack-16 enter">
          <Step n={3} title="พร้อมใช้งาน" done />
          <div className="small sec">
            <span className="mono">{result.model}</span> ตอบว่า “{result.reply}” ใน <span className="mono">{Math.round(result.ms ?? 0)} ms</span> บันทึกแล้ว
          </div>
          <div className="actions">
            <Link className="btn accent" to="/qa">สร้างชุดคำถามด้วย LLM</Link>
            <Link className="btn" to="/bench">ไปที่ Benchmark</Link>
          </div>
        </div>
      ) : saved?.model ? (
        <div className="small muted">
          ใช้อยู่ตอนนี้ <span className="mono">{saved.provider} · {saved.model}{saved.base_url ? ` · ${saved.base_url}` : ""}</span> เก็บใน <code>data/settings.json</code> บนเครื่องนี้
        </div>
      ) : null}
      <EmbeddingProviders />
      <div className="small muted">ถ้าใช้โมเดลเดียวกันทั้งตอบและให้คะแนน โมเดลอาจให้คะแนนตัวเองสูงเกินจริง โมเดลเล็กที่รันในเครื่องมักตัดสินภาษาไทยได้ไม่แม่น ควรสุ่มอ่านผลประกอบ</div>
    </div>
  );
}
