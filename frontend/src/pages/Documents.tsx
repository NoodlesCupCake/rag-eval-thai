import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trash2, Upload } from "lucide-react";
import { api, errorText } from "../api";
import { useStatus } from "../status";
import type { ChunkPreview, Doc, DocFull } from "../types";
import { num } from "../format";
import { Empty, ErrorNote, PageHead } from "../components/ui";

export function DocumentsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useStatus();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.get<Doc[]>("/documents").then(setDocs).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, []);
  const selected = id ?? docs?.[0]?.id;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  }

  const loadSamples = () => act(() => api.post("/samples"));
  async function remove(docId: string) {
    if (!confirm("ลบเอกสารนี้? คำถามที่อ้างถึงเอกสารนี้จะถูกลบด้วย")) return;
    await act(() => api.del("/documents/" + docId));
    if (id === docId) navigate("/documents");
  }

  return (
    <div className="stack">
      <PageHead title="เอกสาร" sub="คลังเอกสารที่ RAG จะค้น เลือกเอกสารเพื่อดูว่าแต่ละวิธีตัด chunk ตรงไหน และตัดกลางคำกี่ครั้ง">
        <button className="btn" onClick={loadSamples} disabled={busy}>โหลดชุดตัวอย่าง</button>
        <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="icon" />อัปโหลด
        </button>
        <input ref={fileRef} type="file" multiple accept=".txt,.md,.pdf" hidden
               onChange={(e) => {
                 const files = [...(e.target.files ?? [])];
                 e.target.value = "";
                 if (files.length) act(() => api.upload("/documents", files));
               }} />
      </PageHead>
      <ErrorNote error={error} />

      {docs && docs.length === 0 && (
        <div className="card">
          <Empty title="ยังไม่มีเอกสาร">
            <p>อัปโหลดไฟล์ .txt .md หรือ .pdf หรือเริ่มจากชุดตัวอย่าง เอกสารสมมติภาษาไทย 3 ฉบับพร้อมคำถาม 29 ข้อ</p>
            <button className="btn accent" onClick={loadSamples} disabled={busy}>โหลดชุดตัวอย่าง</button>
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
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [cfg, setCfg] = useState({ strategy: "char", size: 400, overlap: 0 });
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
        <div className="page-text">
          {parts.map((p) =>
            p.mark ? (
              <span key={p.key} className={"grad" + (p.mark.cut ? " cut" : "")} title={p.mark.cut ? `chunk ${p.mark.n} เริ่มกลางคำ` : `chunk ${p.mark.n}`}>
                <b>{p.mark.n}</b>
              </span>
            ) : p.chunk != null ? (
              <span key={p.key} className={"c " + (p.chunk % 2 ? "b" : "a")}>{p.text}</span>
            ) : (
              <span key={p.key}>{p.text}</span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
