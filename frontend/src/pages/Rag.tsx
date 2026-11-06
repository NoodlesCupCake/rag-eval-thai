import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { api } from "../api";
import { useStatus } from "../status";
import { Busy, useAction, useFeedback } from "../feedback";
import type { Job, QASet, Run, RunSummary } from "../types";
import { num } from "../format";
import { JobProgress, PageHead } from "../components/ui";
import { Term } from "../components/Term";

/* RAG evaluation: one retrieval config, the top k chunks go to an LLM that answers, and
   a judge LLM grades each answer against the reference. Result: % correct, % grounded,
   and why each wrong answer went wrong. */

export function RagPage() {
  const { status, refresh } = useStatus();
  const navigate = useNavigate();
  const { track, jobs } = useFeedback();
  const { run, busy } = useAction();
  const [sets, setSets] = useState<QASet[]>([]);
  const [setId, setSetId] = useState("");
  const [chunking, setChunking] = useState({ strategy: "recursive", size: 400, overlap: 50 });
  const [retriever, setRetriever] = useState({ type: "dense", model: "intfloat/multilingual-e5-small" });
  const [fromRun, setFromRun] = useState<string | null>(null);
  const [topK, setTopK] = useState(3);
  const [model, setModel] = useState("");
  const [judge, setJudge] = useState("");
  const [sample, setSample] = useState("");
  const [name, setName] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const job: Job | null = jobs.find((j) => j.id === jobId) ?? null;

  useEffect(() => {
    api.get<QASet[]>("/qa-sets").then((s) => { setSets(s); setSetId((c) => c || s[0]?.id || ""); });
    // start from the best config of the latest embedding evaluation
    api.get<RunSummary[]>("/runs").then(async (rs) => {
      const last = rs.find((r) => r.kind === "retrieval" && r.status === "done");
      if (!last) return;
      const full = await api.get<Run>("/runs/" + last.id);
      const best = full.results.reduce((a, b) => ((b.metrics.mrr ?? 0) > (a.metrics.mrr ?? 0) ? b : a), full.results[0]);
      if (!best) return;
      setChunking({ strategy: best.chunking.strategy, size: best.chunking.size, overlap: best.chunking.overlap });
      setRetriever({ type: best.retriever.type, model: best.retriever.model ?? "" });
      setFromRun(`${full.name} · ${best.label}`);
    });
  }, []);

  const nq = sets.find((s) => s.id === setId)?.count ?? 0;
  const used = sample ? Math.min(Number(sample), nq) : nq;
  const running = busy("run") || job?.status === "running";
  const llm = !!status?.llm_available;

  async function start() {
    const j = await run("run", () => api.post<Job>("/runs", {
      kind: "rag", name: name || null, qa_set: setId || null, k_max: Math.max(10, topK),
      chunkings: [chunking], retrievers: [{ type: retriever.type, model: retriever.type === "bm25" ? null : retriever.model }],
      sample: sample ? Number(sample) : null,
      generation: { enabled: true, top_k: topK, model: model || null, judge_model: judge || null },
    }));
    if (!j) return;
    refresh();
    setJobId(j.id);
    track(j, () => navigate("/runs/" + j.run_id));
  }

  return (
    <div className="stack">
      <PageHead title="ประเมิน RAG"
                sub="ค้น chunk ด้วย config ที่เลือก ส่ง top k ให้ LLM ตอบ แล้วให้ LLM อีกตัวตรวจว่าตอบถูกไหมเทียบกับคำตอบอ้างอิง และอิงเอกสารจริงไหม" />
      <div className="split">
        <div className="stack">
          <div className="card card-pad stack-16">
            <h2 className="method-title" style={{ fontSize: 15 }}>1 · ค้น chunk ด้วย</h2>
            {fromRun && <div className="small muted">ตั้งจาก config ที่ดีที่สุดของ {fromRun} เปลี่ยนได้</div>}
            <div className="form-grid">
              <label className="field"><span><Term k="strategy">วิธีตัด</Term></span>
                <select className="input" value={chunking.strategy} onChange={(e) => setChunking({ ...chunking, strategy: e.target.value })}>
                  <option>char</option><option>word</option><option>recursive</option></select></label>
              <label className="field"><span><Term k="size">ขนาด</Term></span>
                <input className="input mono" type="number" min={50} step={50} value={chunking.size} onChange={(e) => setChunking({ ...chunking, size: Number(e.target.value) })} /></label>
              <label className="field"><span><Term k="overlap">overlap</Term></span>
                <input className="input mono" type="number" min={0} step={10} value={chunking.overlap} onChange={(e) => setChunking({ ...chunking, overlap: Number(e.target.value) })} /></label>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: "140px 1fr" }}>
              <label className="field"><span>Retriever</span>
                <select className="input" value={retriever.type} onChange={(e) => setRetriever({ ...retriever, type: e.target.value })}>
                  <option value="bm25">bm25</option><option value="dense">dense</option><option value="hybrid">hybrid</option></select></label>
              <label className="field"><span>Embedding model</span>
                <input className="input mono" list="rag-models" disabled={retriever.type === "bm25"} value={retriever.type === "bm25" ? "–" : retriever.model}
                       onChange={(e) => setRetriever({ ...retriever, model: e.target.value })} />
                <datalist id="rag-models">{status?.suggested_models.map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}</datalist></label>
            </div>
            <label className="field" style={{ maxWidth: 200 }}><span>ส่ง top k ให้ LLM</span>
              <input className="input mono" type="number" min={1} max={10} value={topK} onChange={(e) => setTopK(Number(e.target.value))} /></label>
          </div>

          <div className="card card-pad stack-16">
            <h2 className="method-title" style={{ fontSize: 15 }}>2 · LLM ที่ตอบ และ LLM ที่ตรวจ</h2>
            {!llm && <div className="notice">ต้อง <Link to="/settings">ตั้งค่า LLM</Link> ก่อน</div>}
            <div className="form-grid">
              <label className="field"><span>โมเดลที่ตอบ</span>
                <input className="input mono" placeholder={status?.llm.model} value={model} onChange={(e) => setModel(e.target.value)} /></label>
              <label className="field"><span>โมเดลที่ตรวจ (judge)</span>
                <input className="input mono" placeholder={model || status?.llm.model} value={judge} onChange={(e) => setJudge(e.target.value)} /></label>
            </div>
            <div className="small muted">
              ใช้ผู้ให้บริการจากหน้าตั้งค่า ({status?.llm.provider === "anthropic" ? "Claude" : status?.llm.base_url || "–"}) ควรให้โมเดลที่ตรวจเก่งกว่าหรือต่างจากโมเดลที่ตอบ ไม่อย่างนั้นมักให้คะแนนตัวเองสูงเกินจริง
            </div>
          </div>
        </div>

        <div className="card card-pad stack-16" style={{ position: "sticky", top: 32 }}>
          <label className="field"><span>ชุดคำถาม</span>
            <select className="input" value={setId} onChange={(e) => setSetId(e.target.value)}>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.count} ข้อ</option>)}</select></label>
          <label className="field"><span>ชื่อรอบนี้</span><input className="input" placeholder="เช่น e5-small + Claude" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>สุ่มคำถาม · ลดค่าใช้จ่ายตอนลองครั้งแรก</span>
            <input className="input mono" type="number" min={1} placeholder="ทั้งหมด" value={sample} onChange={(e) => setSample(e.target.value)} /></label>
          <hr className="rule" />
          <div className="small sec">เรียก LLM <span className="mono">{num(used * 2)}</span> ครั้ง · ตอบ {used} และตรวจ {used}</div>
          <JobProgress job={job} />
          <button className="btn accent big" onClick={start} disabled={running || !llm || !nq}>
            <Busy busy={running} label="กำลังรัน · เปลี่ยนหน้าได้"><Play className="icon" />เริ่มประเมิน RAG</Busy>
          </button>
          <div className="small muted">ยังไม่รู้ว่าจะใช้ config ไหน ลอง <Link to="/bench">ประเมิน Embedding</Link> ก่อน ฟรีและเร็ว</div>
        </div>
      </div>
    </div>
  );
}
