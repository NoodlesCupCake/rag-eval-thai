import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Plus, X } from "lucide-react";
import { api } from "../api";
import { Busy, useAction, useFeedback } from "../feedback";
import { useStatus } from "../status";
import type { ChunkCfg, Job, QASet } from "../types";
import { num } from "../format";
import { ErrorNote, JobProgress, PageHead } from "../components/ui";
import { Term } from "../components/Term";

interface RetRow { type: string; model: string }

const DEFAULT_CHUNKS: ChunkCfg[] = [
  { strategy: "char", size: 400, overlap: 0 },
  { strategy: "word", size: 400, overlap: 50 },
  { strategy: "recursive", size: 400, overlap: 50 },
];
const DEFAULT_RETRIEVERS: RetRow[] = [
  { type: "bm25", model: "" },
  { type: "dense", model: "intfloat/multilingual-e5-small" },
  { type: "hybrid", model: "intfloat/multilingual-e5-small" },
];

export function BenchPage() {
  const { status, refresh } = useStatus();
  const navigate = useNavigate();
  const [chunks, setChunks] = useState(DEFAULT_CHUNKS);
  const [rets, setRets] = useState(DEFAULT_RETRIEVERS);
  // "embedding": hold chunking fixed and compare models, so the model is the only variable
  const [mode, setMode] = useState<"chunking" | "embedding">("chunking");
  const [models, setModels] = useState<string[]>(["intfloat/multilingual-e5-small", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"]);
  const [baseline, setBaseline] = useState(true);
  const [custom, setCustom] = useState("");
  const applyModels = (ms: string[], withBm25 = baseline) => {
    setModels(ms);
    setRets([...(withBm25 ? [{ type: "bm25", model: "" }] : []), ...ms.map((m) => ({ type: "dense", model: m }))]);
  };
  function switchMode(m: "chunking" | "embedding") {
    setMode(m);
    if (m === "embedding") {
      setChunks([{ strategy: "recursive", size: 400, overlap: 50 }]);
      applyModels(models);
      if (!name) setName("เทียบ embedding");
    } else {
      setChunks(DEFAULT_CHUNKS);
      setRets(DEFAULT_RETRIEVERS);
    }
  }
  const [name, setName] = useState("");
  const [kMax, setKMax] = useState(10);
  const [sample, setSample] = useState("");
  const [gen, setGen] = useState({ enabled: false, top_k: 3 });
  const [jobId, setJobId] = useState<string | null>(null);
  const [error] = useState<string | null>(null);
  const { track, jobs } = useFeedback();
  const { run: act, busy } = useAction();
  const job: Job | null = jobs.find((j) => j.id === jobId) ?? null;

  const [sets, setSets] = useState<QASet[]>([]);
  const [setId, setSetId] = useState("");
  useEffect(() => { api.get<QASet[]>("/qa-sets").then((s) => { setSets(s); setSetId((cur) => cur || s[0]?.id || ""); }); }, []);
  const nq = sets.find((s) => s.id === setId)?.count ?? 0;
  const nUsed = sample ? Math.min(Number(sample), nq) : nq;
  const nConfigs = chunks.length * rets.length;
  const running = busy("run") || job?.status === "running";

  const editChunk = (i: number, patch: Partial<ChunkCfg>) => setChunks(chunks.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const editRet = (i: number, patch: Partial<RetRow>) => setRets(rets.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function run() {
    const j = await act("run", () => api.post<Job>("/runs", {
        name: name || null,
        chunkings: chunks,
        retrievers: rets.map((r) => ({ type: r.type, model: r.type === "bm25" ? null : r.model })),
        k_max: kMax,
        qa_set: setId || null,
        sample: sample ? Number(sample) : null,
        generation: gen,
      }));
    if (!j) return;
    refresh();
    setJobId(j.id);
    // runs in the background; open the result when it finishes (if still on this page it navigates)
    track(j, () => navigate("/runs/" + j.run_id));
  }

  return (
    <div className="stack">
      <PageHead title="Benchmark" sub="รันทุกคู่ระหว่างวิธีตัด chunk กับ retriever แล้ววัด Hit@k, MRR, coverage และ latency ต่อคำถาม" />
      <div className="split">
        <div className="stack">
          <div className="card card-pad stack-16">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <h2 className="method-title" style={{ fontSize: 15 }}>อยากรู้อะไร</h2>
              <div className="seg">
                <button className={mode === "chunking" ? "on" : ""} onClick={() => switchMode("chunking")}>เทียบวิธีตัด chunk</button>
                <button className={mode === "embedding" ? "on" : ""} onClick={() => switchMode("embedding")}>เทียบ embedding model</button>
              </div>
            </div>
            {mode === "embedding" && (
              <>
                <p className="small sec" style={{ margin: 0 }}>
                  ตัด chunk แบบเดียว แล้วค้นด้วยแต่ละโมเดล ดูว่า chunk ที่ตอบคำถามได้จริงอยู่อันดับเท่าไร
                  ยิ่งอยู่ต้น ๆ ยิ่งแปลว่า embedding ดี ผลจะมีตาราง “เทียบ embedding model” ให้ดูอันดับ p50 / p95 คู่กับความเร็ว
                </p>
                <div className="stack-8">
                  {(status?.suggested_models ?? []).map((m) => (
                    <label key={m.id} className="check small">
                      <input type="checkbox" checked={models.includes(m.id)}
                             onChange={(e) => applyModels(e.target.checked ? [...models, m.id] : models.filter((x) => x !== m.id))} />
                      <span className="mono">{m.id}</span><span className="muted">{m.note}</span>
                    </label>
                  ))}
                  {models.filter((m) => !status?.suggested_models.some((x) => x.id === m)).map((m) => (
                    <label key={m} className="check small">
                      <input type="checkbox" checked onChange={() => applyModels(models.filter((x) => x !== m))} />
                      <span className="mono">{m}</span><span className="muted">เพิ่มเอง</span>
                    </label>
                  ))}
                  <form className="row" onSubmit={(e) => { e.preventDefault(); const m = custom.trim(); if (m && !models.includes(m)) applyModels([...models, m]); setCustom(""); }}>
                    <input className="input mono" style={{ height: 32 }} placeholder="Hugging Face model id อื่น เช่น BAAI/bge-small-en-v1.5" value={custom} onChange={(e) => setCustom(e.target.value)} />
                    <button className="btn sm" type="submit" disabled={!custom.trim()}><Plus className="icon" />เพิ่ม</button>
                  </form>
                  <label className="check small">
                    <input type="checkbox" checked={baseline} onChange={(e) => { setBaseline(e.target.checked); applyModels(models, e.target.checked); }} />
                    รวม BM25 เป็นเส้นฐาน (ไม่ใช้ embedding) เพื่อดูว่าโมเดลช่วยได้แค่ไหน
                  </label>
                </div>
                {models.length < 2 && <div className="small muted">เลือกอย่างน้อย 2 โมเดลเพื่อให้มีตารางเทียบ</div>}
              </>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h2>วิธีตัด chunk</h2><span className="hint">ขนาดวัดเป็นตัวอักษรทุกวิธี เทียบกันได้ตรง ๆ</span></div>
            <div className="card-pad stack-16">
              <div className="cfg-table chunks">
                <span className="th"><Term k="strategy">วิธี</Term></span><span className="th"><Term k="size">ขนาด</Term></span><span className="th"><Term k="overlap">overlap</Term></span><span />
                {chunks.map((c, i) => (
                  <Row key={i} onRemove={chunks.length > 1 ? () => setChunks(chunks.filter((_, j) => j !== i)) : undefined}>
                    <select className="input" aria-label="วิธี" value={c.strategy} onChange={(e) => editChunk(i, { strategy: e.target.value })}>
                      {(status?.strategies ?? ["char", "word", "recursive"]).map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <input className="input mono" aria-label="ขนาด" type="number" min={50} step={50} value={c.size} onChange={(e) => editChunk(i, { size: Number(e.target.value) })} />
                    <input className="input mono" aria-label="overlap" type="number" min={0} step={10} value={c.overlap} onChange={(e) => editChunk(i, { overlap: Number(e.target.value) })} />
                  </Row>
                ))}
              </div>
              <div><button className="btn sm" onClick={() => setChunks([...chunks, { ...chunks[chunks.length - 1] }])}><Plus className="icon" />เพิ่ม</button></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Retriever</h2><span className="hint">hybrid คือ dense กับ BM25 รวมด้วย reciprocal rank fusion</span></div>
            <div className="card-pad stack-16">
              <datalist id="models">
                {status?.suggested_models.map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}
              </datalist>
              <div className="cfg-table rets">
                <span className="th"><Term k="bm25">bm25</Term> · <Term k="dense">dense</Term> · <Term k="hybrid">hybrid</Term></span><span className="th">Embedding model จาก Hugging Face</span><span />
                {rets.map((r, i) => (
                  <Row key={i} onRemove={rets.length > 1 ? () => setRets(rets.filter((_, j) => j !== i)) : undefined}>
                    <select className="input" aria-label="ชนิด" value={r.type}
                            onChange={(e) => editRet(i, { type: e.target.value, model: r.model || "intfloat/multilingual-e5-small" })}>
                      <option value="bm25">bm25</option><option value="dense">dense</option><option value="hybrid">hybrid</option>
                    </select>
                    <input className="input mono" aria-label="model" list="models" disabled={r.type === "bm25"}
                           value={r.type === "bm25" ? "ตัดคำด้วย PyThaiNLP" : r.model} onChange={(e) => editRet(i, { model: e.target.value })} />
                  </Row>
                ))}
              </div>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <button className="btn sm" onClick={() => setRets([...rets, { type: "dense", model: "BAAI/bge-m3" }])}><Plus className="icon" />เพิ่ม</button>
                <span className="small muted">โมเดลดาวน์โหลดครั้งแรกที่ใช้ bge-m3 ประมาณ 2.3 GB</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card card-pad stack-16" style={{ position: "sticky", top: 32 }}>
          <label className="field"><span>ชุดคำถาม</span>
            <select className="input" value={setId} onChange={(e) => setSetId(e.target.value)}>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.count} ข้อ</option>)}
            </select>
          </label>
          <label className="field"><span>ชื่อรอบนี้</span><input className="input" placeholder="ลองขนาด 400" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label className="field"><span><Term k="k_max">k สูงสุด</Term></span><input className="input mono" type="number" min={1} max={20} value={kMax} onChange={(e) => setKMax(Number(e.target.value))} /></label>
            <label className="field"><span>สุ่มคำถาม</span><input className="input mono" type="number" min={1} placeholder="ทั้งหมด" value={sample} onChange={(e) => setSample(e.target.value)} /></label>
          </div>
          <hr className="rule" />
          <label className="check">
            <input type="checkbox" checked={gen.enabled} disabled={!status?.llm_available} onChange={(e) => setGen({ ...gen, enabled: e.target.checked })} />
            ให้ LLM ตอบและให้คะแนนคำตอบ
          </label>
          {!status?.llm_available && <div className="small muted"><Link to="/settings">ตั้งค่า LLM</Link> ก่อน การวัด retrieval ไม่ต้องใช้</div>}
          {gen.enabled && (
            <>
              <label className="field"><span>ส่ง top k ให้ LLM</span>
                <input className="input mono" type="number" min={1} max={10} value={gen.top_k} onChange={(e) => setGen({ ...gen, top_k: Number(e.target.value) })} />
              </label>
              <div className="small muted">เรียก <span className="mono">{status?.llm.model}</span> {num(nUsed * nConfigs * 2)} ครั้ง ตอบและตัดสินต่อคำถามต่อ config</div>
            </>
          )}
          <hr className="rule" />
          <div className="small sec"><span className="mono">{nConfigs}</span> configs × <span className="mono">{nUsed}</span> คำถาม</div>
          <JobProgress job={job} />
          <ErrorNote error={error} />
          <button className="btn accent big" onClick={run} disabled={running || !nq}>
            <Busy busy={running} label="กำลังรัน · เปลี่ยนหน้าได้"><Play className="icon" />เริ่ม benchmark</Busy>
          </button>
          {!nq && <div className="small muted">ต้องมีคำถามในชุดคำถามก่อน</div>}
        </div>
      </div>
    </div>
  );
}

function Row({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <>
      {children}
      <button className="btn ghost icon-only" aria-label="ลบแถว" disabled={!onRemove} onClick={onRemove}><X className="icon" /></button>
    </>
  );
}
