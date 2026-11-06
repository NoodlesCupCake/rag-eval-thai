import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { Search } from "lucide-react";
import { api, errorText } from "../api";
import { Busy, useAction } from "../feedback";
import { date, ms } from "../format";
import { ErrorNote, PageHead } from "../components/ui";
import { shortModel, type IndexMeta } from "./Indexes";
import { PageSkeleton } from "../components/Skeleton";

/* One index from the store: every chunk on an x/y map coloured by document, a search
   box that drops the query onto the map with lines to its nearest chunks, and a panel
   for the chunk you click with its nearest neighbours. */

interface IdxChunk { id: string; doc_id: string; doc_name: string; number: number; start: number; end: number; text: string; pca: [number, number]; tsne: [number, number] }
interface Full extends IndexMeta { chunks: IdxChunk[] }
interface Hit { id: string; score: number }
interface SearchRes { ms: number; hits: Hit[]; pos: { pca: [number, number]; tsne: [number, number] } }

const DOC_COLORS = ["#2a78d6", "#1baf7a", "#6250d6", "#e87ba4", "#eda100", "#008300", "#e34948"];
const H = 560, PAD = 28;

export function IndexDetailPage() {
  const { id = "" } = useParams();
  const [idx, setIdx] = useState<Full | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"tsne" | "pca">("tsne");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<(SearchRes & { query: string }) | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [near, setNear] = useState<Hit[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; c: IdxChunk } | null>(null);
  const [W, setW] = useState(900);
  const box = useRef<HTMLDivElement>(null);
  const { run, busy } = useAction();

  useEffect(() => { api.get<Full>("/indexes/" + id).then(setIdx).catch((e) => setError(errorText(e))); }, [id]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [idx]);
  useEffect(() => {
    if (!sel) { setNear([]); return; }
    api.get<Hit[]>(`/indexes/${id}/neighbors/${encodeURIComponent(sel)}`).then(setNear).catch(() => setNear([]));
  }, [sel, id]);

  if (error) return <ErrorNote error={error} />;
  if (!idx) return <PageSkeleton variant="map" />;

  const byId = new Map(idx.chunks.map((c) => [c.id, c]));
  const docIndex = new Map(idx.docs.map((d, i) => [d.id, i]));
  const color = (docId: string) => DOC_COLORS[docIndex.get(docId) ?? 0] ?? "var(--quiet-series)";
  const px = (v: number) => PAD + v * (W - PAD * 2);
  const py = (v: number) => PAD + (1 - v) * (H - PAD * 2);
  const P = (c: IdxChunk) => c[method];
  const hitIds = new Set(res?.hits.map((h) => h.id));
  const nearIds = new Set(near.map((h) => h.id));
  const focus = res ? hitIds : sel ? new Set([sel, ...nearIds]) : null;
  const selected = sel ? byId.get(sel) : null;

  async function search(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setSel(null);
    const r = await run("search", () => api.post<SearchRes>(`/indexes/${id}/search`, { query, k: 5 }));
    if (r) setRes({ ...r, query });
  }
  const hover = (e: MouseEvent, c: IdxChunk) => setTip({ x: e.clientX, y: e.clientY, c });

  return (
    <div className="stack">
      <PageHead back={{ to: "/indexes", label: "คลัง Embedding" }} title={shortModel(idx.model)}
                sub={<span className="mono small">{idx.model} · {idx.chunking.strategy}·{idx.chunking.size}{idx.chunking.overlap ? `/${idx.chunking.overlap}` : ""} · {idx.n_chunks} chunks · {idx.dim} มิติ · {date(idx.created_at)}</span>} />
      {idx.stale && <div className="notice">เอกสารเปลี่ยนหลังสร้าง index นี้ แผนที่และผลค้นอาจไม่ตรงเอกสารปัจจุบัน สร้างใหม่ได้ที่ <Link to="/indexes">คลัง Embedding</Link></div>}

      <form className="card idx-search" onSubmit={search}>
        <Search className="icon" />
        <input className="input" style={{ border: 0, boxShadow: "none" }} placeholder="พิมพ์คำถามเพื่อดูว่าตกอยู่ตรงไหนบนแผนที่ และใกล้ chunk ไหน" value={q} onChange={(e) => setQ(e.target.value)} />
        {res && <button type="button" className="btn ghost sm" onClick={() => { setRes(null); setQ(""); }}>ล้าง</button>}
        <button className="btn primary sm" type="submit" disabled={busy("search") || !q.trim()}><Busy busy={busy("search")}>ค้น</Busy></button>
      </form>

      <div className="idx-layout">
        <div className="card">
          <div className="card-head">
            <div className="map-legend" style={{ padding: 0 }}>
              {idx.docs.filter((d) => idx.chunks.some((c) => c.doc_id === d.id)).map((d) => (
                <span key={d.id}><i className="sq" style={{ background: color(d.id) }} />{d.name.replace(/\.(md|txt|pdf|docx)$/, "")}</span>
              ))}
              {res && <span><i className="ci solid" style={{ background: "var(--text)" }} />คำถาม</span>}
            </div>
            <div className="seg">
              <button className={method === "tsne" ? "on" : ""} onClick={() => setMethod("tsne")}>t-SNE</button>
              <button className={method === "pca" ? "on" : ""} onClick={() => setMethod("pca")}>PCA</button>
            </div>
          </div>
          <div ref={box} className="map-box" style={{ marginBottom: 16 }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} onClick={() => setSel(null)} role="img"
                 aria-label={`${idx.n_chunks} chunks projected to 2D with ${method}`}>
              <defs><pattern id="idx-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="map-grid-dot" /></pattern></defs>
              <rect width={W} height={H} fill="url(#idx-dots)" />
              <line x1={W / 2} x2={W / 2} y1={PAD / 2} y2={H - PAD / 2} className="map-axis" />
              <line x1={PAD / 2} x2={W - PAD / 2} y1={H / 2} y2={H / 2} className="map-axis" />
              <text x={W - PAD / 2} y={H / 2 - 6} textAnchor="end" className="map-axis-label">x</text>
              <text x={W / 2 + 6} y={PAD / 2 + 10} className="map-axis-label">y</text>

              {res && res.hits.map((h, i) => byId.get(h.id) && (
                <line key={h.id} x1={px(res.pos[method][0])} y1={py(res.pos[method][1])} x2={px(P(byId.get(h.id)!)[0])} y2={py(P(byId.get(h.id)!)[1])}
                      className={"map-line " + (i === 0 ? "gold" : "top")} />
              ))}
              {selected && near.map((h) => byId.get(h.id) && (
                <line key={h.id} x1={px(P(selected)[0])} y1={py(P(selected)[1])} x2={px(P(byId.get(h.id)!)[0])} y2={py(P(byId.get(h.id)!)[1])} className="map-line top" />
              ))}

              {idx.chunks.map((c) => {
                const on = focus?.has(c.id);
                const big = c.id === sel || (res && res.hits[0]?.id === c.id);
                return (
                  <rect key={c.id} x={px(P(c)[0]) - (big ? 6.5 : 4.5)} y={py(P(c)[1]) - (big ? 6.5 : 4.5)} width={big ? 13 : 9} height={big ? 13 : 9} rx={2}
                        fill={color(c.doc_id)} className={"map-chunk idx-pt" + (focus ? (on ? " on" : " dim") : "") + (big ? " gold" : "")}
                        onClick={(e) => { e.stopPropagation(); setRes(null); setSel(c.id === sel ? null : c.id); }}
                        onMouseMove={(e) => hover(e, c)} onMouseLeave={() => setTip(null)} />
                );
              })}
              {res && (
                <g className="idx-query">
                  <circle cx={px(res.pos[method][0])} cy={py(res.pos[method][1])} r={9} />
                  <text x={px(res.pos[method][0]) + 14} y={py(res.pos[method][1]) + 4}>คำถาม</text>
                </g>
              )}
            </svg>
          </div>
        </div>

        <aside className="card idx-panel">
          {res ? (
            <>
              <div className="card-head"><h2>ใกล้ “{res.query}” ที่สุด</h2><span className="meta">{ms(res.ms)}</span></div>
              <div className="idx-hits">
                {res.hits.map((h, i) => { const c = byId.get(h.id)!; return (
                  <button key={h.id} className={"idx-hit" + (i === 0 ? " first" : "")} onClick={() => { setRes(null); setSel(h.id); }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="mono small"><i className="sq" style={{ background: color(c.doc_id) }} />#{i + 1} · chunk {c.number}</span>
                      <span className="num small">{h.score.toFixed(3)}</span>
                    </div>
                    <p>{c.text}</p>
                  </button>
                ); })}
              </div>
              <div className="small muted" style={{ padding: "0 16px 16px" }}>ตำแหน่งของคำถามบนแผนที่วางตามความคล้ายกับ chunk ที่ใกล้ที่สุด จึงเป็นค่าประมาณ ส่วนคะแนนคือ cosine จริง</div>
            </>
          ) : selected ? (
            <>
              <div className="card-head"><h2><i className="sq" style={{ background: color(selected.doc_id) }} />chunk {selected.number}</h2><span className="meta">{selected.end - selected.start} ตัวอักษร</span></div>
              <div className="card-pad stack-16">
                <div className="meta">{selected.doc_name}</div>
                <p className="idx-text">{selected.text}</p>
                <Link className="small" to={`/documents/${selected.doc_id}?strategy=${idx.chunking.strategy}&size=${idx.chunking.size}&overlap=${idx.chunking.overlap}&chunk=${selected.number}`}>เปิดในเอกสาร</Link>
                <div className="small sec">ใกล้เคียงที่สุด 5 อันดับ</div>
                <div className="idx-hits" style={{ padding: 0 }}>
                  {near.map((h) => { const c = byId.get(h.id)!; return (
                    <button key={h.id} className="idx-hit" onClick={() => setSel(h.id)}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="mono small"><i className="sq" style={{ background: color(c.doc_id) }} />chunk {c.number}</span>
                        <span className="num small">{h.score.toFixed(3)}</span>
                      </div>
                      <p>{c.text}</p>
                    </button>
                  ); })}
                </div>
              </div>
            </>
          ) : (
            <div className="card-pad stack-16">
              <h2 className="method-title" style={{ fontSize: 15 }}>ดูข้างใน index</h2>
              <p className="small sec" style={{ margin: 0 }}>แต่ละจุดคือหนึ่ง chunk สีตามเอกสาร chunk ที่ความหมายใกล้กันจะอยู่ใกล้กันบนแผนที่ คลิกจุดเพื่ออ่านข้อความและดู chunk ที่ใกล้เคียงที่สุด หรือพิมพ์คำถามด้านบนเพื่อดูว่าโมเดลจะดึง chunk ไหน</p>
              <div className="idx-facts">
                <div><b>{idx.n_chunks}</b><span>chunks</span></div>
                <div><b>{idx.dim}</b><span>มิติต่อเวกเตอร์</span></div>
                <div><b>{(idx.size_bytes / 1024).toFixed(0)} KB</b><span>ขนาดเวกเตอร์</span></div>
                <div><b>{idx.encode_seconds ? `${Math.round(idx.n_chunks / idx.encode_seconds)}` : "–"}</b><span>chunk/วินาที · {idx.device}</span></div>
              </div>
              <div className="small muted">{method === "tsne" ? "t-SNE เน้นให้เห็นกลุ่ม ระยะห่างระหว่างกลุ่มอาจไม่ตรงความจริง" : "PCA ย่อแบบเส้นตรง ระยะโดยรวมตรงกว่า"}</div>
            </div>
          )}
        </aside>
      </div>
      {tip && createPortal(
        <div className="term-card" style={{ left: Math.min(tip.x + 14, innerWidth - 340), top: tip.y + 14 }}>
          <div className="term-title"><span>{tip.c.doc_name.replace(/\.(md|txt|pdf|docx)$/, "")} · chunk {tip.c.number}</span></div>
          <div>{tip.c.text.slice(0, 160)}{tip.c.text.length > 160 ? "…" : ""}</div>
        </div>, document.body)}
    </div>
  );
}
