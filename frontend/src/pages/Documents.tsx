import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Trash2, Upload } from "lucide-react";
import { api, errorText } from "../api";
import { useStatus } from "../status";
import type { ChunkPreview, Doc, DocFull } from "../types";
import { num } from "../format";
import { Empty, ErrorNote, PageHead } from "../components/ui";
import { Busy, useAction, useFeedback } from "../feedback";
import type { Job } from "../types";
import { Sk, SkRows } from "../components/Skeleton";

export function DocumentsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useStatus();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { track, jobs } = useFeedback();
  const { run, busy } = useAction();
  const uploading = busy("upload") || jobs.some((j) => j.kind === "upload" && j.status === "running");

  const load = () => api.get<Doc[]>("/documents").then(setDocs).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, []);
  const selected = id ?? docs?.[0]?.id;

  async function loadSamples() {
    await run("samples", () => api.post<{ documents: number; qa: number }>("/samples"),
              (r) => r.documents || r.qa ? `เพิ่ม ${r.documents} เอกสาร และ ${r.qa} คำถามจากชุดตัวอย่าง` : "ชุดตัวอย่างโหลดไว้แล้ว");
    await load();
    refresh();
  }
  async function upload(files: File[]) {
    const job = await run("upload", () => api.upload<Job>("/documents", files));
    if (job) track(job, () => load()); // text extraction runs in the background; the tray shows progress
  }
  async function remove(docId: string) {
    if (!confirm("ลบเอกสารนี้? คำถามที่อ้างถึงเอกสารนี้จะถูกลบด้วย")) return;
    setDocs((ds) => ds?.filter((d) => d.id !== docId) ?? ds);
    if (id === docId) navigate("/documents");
    await run("del:" + docId, () => api.del("/documents/" + docId), "ลบเอกสารแล้ว");
    await load();
    refresh();
  }

  return (
    <div className="stack">
      <PageHead title="เอกสาร" sub="คลังเอกสารที่ RAG จะค้น เลือกเอกสารเพื่อดูว่าแต่ละวิธีตัด chunk ตรงไหน และตัดกลางคำกี่ครั้ง">
        <button className="btn" onClick={loadSamples} disabled={busy("samples")}><Busy busy={busy("samples")} label="กำลังโหลด">โหลดชุดตัวอย่าง</Busy></button>
        <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Busy busy={uploading} label="กำลังอัปโหลด"><Upload className="icon" />อัปโหลด</Busy>
        </button>
        <input ref={fileRef} type="file" multiple accept=".txt,.md,.pdf" hidden
               onChange={(e) => {
                 const files = [...(e.target.files ?? [])];
                 e.target.value = "";
                 if (files.length) upload(files);
               }} />
      </PageHead>
      <ErrorNote error={error} />

      {!docs && !error && (
        <div className="docs-layout">
          <div className="card"><SkRows rows={3} cols={[70, 30]} /></div>
          <div className="card card-pad stack-16"><Sk w="40%" h={16} /><Sk h={36} r={8} />{[90, 96, 80, 94, 70].map((w, i) => <Sk key={i} w={`${w}%`} h={12} />)}</div>
        </div>
      )}
      {docs && docs.length === 0 && (
        <div className="card">
          <Empty title="ยังไม่มีเอกสาร">
            <p>อัปโหลดไฟล์ .txt .md หรือ .pdf หรือเริ่มจากชุดตัวอย่าง เอกสารสมมติภาษาไทย 3 ฉบับพร้อมคำถาม 29 ข้อ</p>
            <button className="btn accent" onClick={loadSamples} disabled={busy("samples")}><Busy busy={busy("samples")} label="กำลังโหลด">โหลดชุดตัวอย่าง</Busy></button>
          </Empty>
        </div>
      )}

      {docs && docs.length > 0 && (
        <div className="docs-layout">
          <div className="card">
            {docs.map((d) => (
              <div key={d.id} className={"list-row clickable" + (d.id === selected ? " active" : "")}
                   onClick={() => navigate("/documents/" + d.id)}>
                <div className="grow">
                  <div className="ellipsis">{d.name}</div>
                  <div className="meta">{num(d.chars)} ตัวอักษร</div>
                </div>
                <button className="btn ghost sm icon-only" aria-label="ลบ"
                        onClick={(e) => { e.stopPropagation(); remove(d.id); }}>
                  <Trash2 className="icon" />
                </button>
              </div>
            ))}
          </div>
          {selected && <ChunkPreviewCard key={selected} id={selected} />}
        </div>
      )}
    </div>
  );
}

const STRATEGY_LABEL: Record<string, string> = {
  char: "char · ตามจำนวนตัวอักษร",
  word: "word · ขอบคำไทย",
  recursive: "recursive · ย่อหน้า → ประโยค → คำ",
};

function ChunkPreviewCard({ id }: { id: string }) {
  // Links from the QA page carry their chunking config and the chunk to highlight.
  const [params] = useSearchParams();
  const target = Number(params.get("chunk")) || null;
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [cfg, setCfg] = useState({
    strategy: params.get("strategy") ?? "char",
    size: Number(params.get("size")) || 400,
    overlap: Number(params.get("overlap") ?? 0),
  });
  useEffect(() => {
    if (!target || !res) return;
    document.getElementById(`chunk-${target}`)?.scrollIntoView({ block: "center" });
  });
  const [res, setRes] = useState<ChunkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<DocFull>("/documents/" + id).then(setDoc).catch((e) => setError(errorText(e))); }, [id]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.post<ChunkPreview>(`/documents/${id}/chunks`, cfg).then(setRes).catch((e) => setError(errorText(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [id, cfg]);

  // Render each chunk once; overlapping text stays with the earlier chunk.
  const parts = useMemo(() => {
    if (!doc || !res) return [];
    const out: { key: string; text: string; chunk?: number; mark?: { n: number; cut: boolean } }[] = [];
    let pos = 0;
    res.chunks.forEach((c, i) => {
      if (c.start >= pos) {
        if (c.start > pos) out.push({ key: `g${i}`, text: doc.text.slice(pos, c.start) });
        out.push({ key: `m${i}`, text: "", mark: { n: i + 1, cut: c.cut_start } });
      }
      const s = Math.max(c.start, pos);
      if (c.end > s) out.push({ key: `c${i}`, text: doc.text.slice(s, c.end), chunk: i });
      pos = Math.max(pos, c.end);
    });
    if (pos < doc.text.length) out.push({ key: "tail", text: doc.text.slice(pos) });
    return out;
  }, [doc, res]);

  const set = (k: keyof typeof cfg) => (e: { target: { value: string } }) =>
    setCfg({ ...cfg, [k]: k === "strategy" ? e.target.value : Number(e.target.value) });

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="ellipsis">{doc?.name ?? "…"}</h2>
        {res && (
          <span className="meta">
            {res.stats.n} chunks · เฉลี่ย {Math.round(res.stats.avg)} ตัวอักษร ·{" "}
            <span style={res.mid_word ? { color: "var(--negative)" } : undefined}>ตัดกลางคำ {res.mid_word}</span>
          </span>
        )}
      </div>
      <div className="card-pad form-grid" style={{ borderBottom: "1px solid var(--line)" }}>
        <label className="field">
          <span>วิธีตัด</span>
          <select className="input" value={cfg.strategy} onChange={set("strategy")}>
            {Object.entries(STRATEGY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          <span>ขนาด (ตัวอักษร)</span>
          <input className="input mono" type="number" min={50} step={50} value={cfg.size} onChange={set("size")} />
        </label>
        <label className="field">
          <span>overlap (ตัวอักษร)</span>
          <input className="input mono" type="number" min={0} step={10} value={cfg.overlap} onChange={set("overlap")} />
        </label>
      </div>
      <div className="card-pad legend" style={{ paddingTop: 12, paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
        <span><span className="key" style={{ background: "var(--chunk-a)" }} />chunk คี่</span>
        <span><span className="key" style={{ background: "var(--chunk-b)" }} />chunk คู่</span>
        <span><span className="tick" />จุดตัดที่อยู่กลางคำ</span>
      </div>
      <ErrorNote error={error} />
      <div className="page">
        {!res && <div className="stack-8">{[92, 98, 85, 96, 60, 94, 88].map((w, i) => <Sk key={i} w={`${w}%`} h={14} />)}</div>}
        <div className="page-text">
          {parts.map((p) =>
            p.mark ? (
              <span key={p.key} id={`chunk-${p.mark.n}`} className={"grad" + (p.mark.cut ? " cut" : "") + (p.mark.n === target ? " target" : "")} title={p.mark.cut ? `chunk ${p.mark.n} เริ่มกลางคำ` : `chunk ${p.mark.n}`}>
                <b>{p.mark.n}</b>
              </span>
            ) : p.chunk != null ? (
              <span key={p.key} className={"c " + (p.chunk % 2 ? "b" : "a") + (p.chunk + 1 === target ? " target" : "")}>{p.text}</span>
            ) : (
              <span key={p.key}>{p.text}</span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
