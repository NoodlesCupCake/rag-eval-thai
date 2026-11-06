import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUp } from "lucide-react";
import { api } from "../api";
import { useStatus } from "../status";
import { useAction } from "../feedback";
import { ms } from "../format";
import { PageHead } from "../components/ui";
import { Term } from "../components/Term";

/* Try one config by hand: ask a question, see which chunks come back with their scores
   and timing, and the LLM's answer from the top 3 when an LLM is set up. */

interface ChatChunk { id: string; doc_id: string; doc_name: string; number: number; score: number; text: string }
interface ChatRes {
  retrieval_ms: number; index_ms: number; n_chunks: number; chunks: ChatChunk[];
  answer: string | null; answer_ms: number | null; answer_error: string | null; model: string | null;
}
interface Turn { q: string; cfg: string; res?: ChatRes; error?: string }

export function ChatPage() {
  const { status } = useStatus();
  const { run, busy } = useAction();
  const [chunking, setChunking] = useState({ strategy: "recursive", size: 400, overlap: 50 });
  const [retriever, setRetriever] = useState({ type: "hybrid", model: "intfloat/multilingual-e5-small" });
  const [topK, setTopK] = useState(5);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [turns]);

  const cfgLabel = `${chunking.strategy}·${chunking.size}${chunking.overlap ? `/${chunking.overlap}` : ""} · ${retriever.type === "bm25" ? "bm25" : `${retriever.type}:${retriever.model.split("/").pop()}`}`;

  async function ask(e: FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy("ask")) return;
    setQ("");
    const turn: Turn = { q: question, cfg: cfgLabel };
    setTurns((t) => [...t, turn]); // show the question immediately
    const res = await run("ask", () => api.post<ChatRes>("/chat", {
      question, chunking, top_k: topK,
      retriever: { type: retriever.type, model: retriever.type === "bm25" ? null : retriever.model },
    }));
    setTurns((t) => t.map((x) => (x === turn ? { ...x, res, error: res ? undefined : "ค้นไม่สำเร็จ" } : x)));
  }

  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <PageHead title="ลองถาม" sub="ถามคำถามกับเอกสารด้วย config ที่เลือก ดูว่าค้นเจอ chunk ไหน คะแนนเท่าไร ใช้เวลาเท่าไร และ LLM ตอบว่าอะไร" />

      <div className="card card-pad form-grid" style={{ gridTemplateColumns: "1fr 90px 90px 1fr 1.6fr 80px" }}>
        <label className="field"><span><Term k="strategy">วิธีตัด</Term></span>
          <select className="input" value={chunking.strategy} onChange={(e) => setChunking({ ...chunking, strategy: e.target.value })}>
            <option>char</option><option>word</option><option>recursive</option>
          </select></label>
        <label className="field"><span><Term k="size">ขนาด</Term></span>
          <input className="input mono" type="number" min={50} step={50} value={chunking.size} onChange={(e) => setChunking({ ...chunking, size: Number(e.target.value) })} /></label>
        <label className="field"><span><Term k="overlap">overlap</Term></span>
          <input className="input mono" type="number" min={0} step={10} value={chunking.overlap} onChange={(e) => setChunking({ ...chunking, overlap: Number(e.target.value) })} /></label>
        <label className="field"><span>Retriever</span>
          <select className="input" value={retriever.type} onChange={(e) => setRetriever({ ...retriever, type: e.target.value })}>
            <option value="bm25">bm25</option><option value="dense">dense</option><option value="hybrid">hybrid</option>
          </select></label>
        <label className="field"><span>Embedding model</span>
          <input className="input mono" list="chat-models" disabled={retriever.type === "bm25"} value={retriever.type === "bm25" ? "–" : retriever.model}
                 onChange={(e) => setRetriever({ ...retriever, model: e.target.value })} />
          <datalist id="chat-models">{status?.suggested_models.map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}</datalist>
        </label>
        <label className="field"><span>top k</span>
          <input className="input mono" type="number" min={1} max={20} value={topK} onChange={(e) => setTopK(Number(e.target.value))} /></label>
      </div>

      {!status?.llm_available && (
        <div className="notice">ยังไม่ได้ตั้งค่า LLM จะเห็นเฉพาะ chunk ที่ค้นได้ <Link to="/settings">ตั้งค่า LLM</Link> เพื่อดูคำตอบด้วย</div>
      )}

      <div className="stack-16">
        {turns.length === 0 && (
          <div className="card empty">
            <h3>ลองถามอะไรก็ได้เกี่ยวกับเอกสาร</h3>
            <p>เช่น “ลาป่วยกี่วันต้องมีใบรับรองแพทย์” หรือ “หนังสือสำรองยืมได้กี่วัน” ครั้งแรกของแต่ละ config ต้องสร้าง index ก่อน จะช้ากว่าครั้งถัดไป</p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="stack-8 enter">
            <div className="chat-q"><span>{t.q}</span><span className="meta">{t.cfg}</span></div>
            <div className="card">
              {!t.res && !t.error && <div className="card-pad row small sec"><span className="spin" />กำลังค้น{status?.llm_available ? "และให้ LLM ตอบ" : ""}</div>}
              {t.error && <div className="card-pad small" style={{ color: "var(--negative)" }}>{t.error}</div>}
              {t.res && (
                <>
                  {(t.res.answer || t.res.answer_error) && (
                    <div className="card-pad stack-8" style={{ borderBottom: "1px solid var(--line)" }}>
                      <div className="meta">{t.res.model} · ตอบจาก chunk 3 อันดับแรก · {ms(t.res.answer_ms)}</div>
                      {t.res.answer ? <div style={{ whiteSpace: "pre-wrap", color: "var(--text)" }}>{t.res.answer}</div>
                        : <div className="small" style={{ color: "var(--negative)" }}>{t.res.answer_error}</div>}
                    </div>
                  )}
                  <div className="card-pad stack-8">
                    <div className="meta">
                      ค้นใน {t.res.n_chunks} chunks · {ms(t.res.retrieval_ms)}{t.res.index_ms ? ` · สร้าง index ${Math.round(t.res.index_ms)} ms` : ""}
                    </div>
                    <div className="hits">
                      {t.res.chunks.map((c, j) => (
                        <div key={c.id} className={"hit-row" + (j < 3 && t.res!.answer ? " is-hit" : "")}>
                          <span className="mono muted">#{j + 1}</span>
                          <span>
                            <Link className="mono muted" style={{ marginRight: 8 }} title={c.doc_name}
                                  to={`/documents/${c.doc_id}?strategy=${chunking.strategy}&size=${chunking.size}&overlap=${chunking.overlap}&chunk=${c.number}`}>
                              {c.doc_name.replace(/\.(md|txt|pdf)$/, "").slice(0, 24)} · chunk {c.number}
                            </Link>
                            {c.text}
                          </span>
                          <span className="num muted">{c.score.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <form className="chat-box card" onSubmit={ask}>
        <input className="input" style={{ border: 0, boxShadow: "none" }} placeholder="พิมพ์คำถาม" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary icon-only" type="submit" aria-label="ถาม" disabled={!q.trim() || busy("ask")}>
          {busy("ask") ? <span className="spin" /> : <ArrowUp className="icon" />}
        </button>
      </form>
    </div>
  );
}
