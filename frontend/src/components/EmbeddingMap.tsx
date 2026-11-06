import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Busy, useAction } from "../feedback";
import type { Result } from "../types";
import { CfgLabel } from "./ui";

/* Where the embedding puts things: every chunk (square, coloured by document) and every
   question (circle) projected to x, y. A good model puts each question next to the chunk
   that answers it. Click a question to draw its right chunk and what was retrieved. */

interface MapChunk { id: string; doc_id: string; doc_name: string; number: number; text: string; x: number; y: number }
interface MapQ { qa_id: string; question: string; hit_rank: number | null; gold: string[]; top: string[]; x: number; y: number }
interface MapData { method: string; model: string; label: string; chunks: MapChunk[]; questions: MapQ[]; docs: { id: string; name: string }[] }

// categorical slots in fixed order (the amber accent is kept for selection, so orange is skipped)
const DOC_COLORS = ["#2a78d6", "#1baf7a", "#6250d6", "#e87ba4", "#eda100", "#008300", "#e34948"];
const H = 520, PAD = 28;

export function EmbeddingMap({ runId, index, result }: { runId: string; index: number; result: Result }) {
  const [data, setData] = useState<MapData | null>(null);
  const [method, setMethod] = useState<"tsne" | "pca">("tsne");
  const [sel, setSel] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; body: string } | null>(null);
  const [W, setW] = useState(900);
  const box = useRef<HTMLDivElement>(null);
  const { run, busy } = useAction();

  useEffect(() => { setData(null); setSel(null); }, [runId, index]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  if (result.retriever.type === "bm25") return null;

  async function build(m = method) {
    setMethod(m);
    const d = await run("map", () => api.post<MapData>(`/runs/${runId}/map`, { result: index, method: m }));
    if (d) setData(d);
  }

  const px = (v: number) => PAD + v * (W - PAD * 2);
  const py = (v: number) => PAD + (1 - v) * (H - PAD * 2);
  const docIndex = new Map((data?.docs ?? []).map((d, i) => [d.id, i]));
  const color = (docId: string) => DOC_COLORS[docIndex.get(docId) ?? 0] ?? "var(--quiet-series)";
  const byId = new Map((data?.chunks ?? []).map((c) => [c.id, c]));
  const q = data?.questions.find((x) => x.qa_id === sel) ?? null;
  const show = (e: React.MouseEvent, title: string, body: string) => setTip({ x: e.clientX, y: e.clientY, title, body });

  return (
    <div className="card">
      <div className="card-head">
        <h2>แผนที่ embedding</h2>
        <div className="row" style={{ gap: 12 }}>
          {data && (
            <div className="seg">
              <button className={method === "tsne" ? "on" : ""} onClick={() => build("tsne")} disabled={busy("map")}>t-SNE</button>
              <button className={method === "pca" ? "on" : ""} onClick={() => build("pca")} disabled={busy("map")}>PCA</button>
            </div>
          )}
        </div>
      </div>
      {!data ? (
        <div className="card-pad stack-16">
          <p className="small sec" style={{ margin: 0 }}>
            แปลงทุก chunk และทุกคำถามเป็น embedding ด้วยโมเดลของ <CfgLabel label={result.label} /> แล้วย่อเหลือ 2 มิติ (x, y)
            คำถามที่อยู่ใกล้ chunk ที่ตอบมันได้ แปลว่าโมเดลเข้าใจความหมายตรงกัน
          </p>
          <div><button className="btn primary" onClick={() => build()} disabled={busy("map")}><Busy busy={busy("map")} label="กำลังคำนวณ">สร้างแผนที่</Busy></button></div>
        </div>
      ) : (
        <>
          <div className="map-legend">
            {data.docs.filter((d) => data.chunks.some((c) => c.doc_id === d.id)).map((d) => (
              <span key={d.id}><i className="sq" style={{ background: color(d.id) }} />{d.name.replace(/\.(md|txt|pdf|docx)$/, "")}</span>
            ))}
            <span><i className="ci solid" />คำถาม เจอที่อันดับ 1</span>
            <span><i className="ci ring" />เจออันดับอื่น</span>
            <span><i className="ci miss">×</i>ไม่เจอ</span>
          </div>
          <div ref={box} className="map-box">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} onClick={() => setSel(null)} role="img"
                 aria-label={`2D ${data.method} map of ${data.chunks.length} chunks and ${data.questions.length} questions`}>
              {/* lines for the selected question: solid to the right chunk, dashed to what was retrieved */}
              {q && q.top.map((cid, i) => byId.get(cid) && !q.gold.includes(cid) && (
                <line key={cid} x1={px(q.x)} y1={py(q.y)} x2={px(byId.get(cid)!.x)} y2={py(byId.get(cid)!.y)} className="map-line top">
                  <title>อันดับ {i + 1}</title>
                </line>
              ))}
              {q && q.gold.map((cid) => byId.get(cid) && (
                <line key={cid} x1={px(q.x)} y1={py(q.y)} x2={px(byId.get(cid)!.x)} y2={py(byId.get(cid)!.y)} className="map-line gold" />
              ))}
              {data.chunks.map((c) => {
                const on = q && (q.gold.includes(c.id) || q.top.includes(c.id));
                return (
                  <rect key={c.id} x={px(c.x) - 5} y={py(c.y) - 5} width={10} height={10} rx={2} fill={color(c.doc_id)}
                        className={"map-chunk" + (q ? (on ? " on" : " dim") : "") + (q?.gold.includes(c.id) ? " gold" : "")}
                        onMouseMove={(e) => show(e, `${c.doc_name} · chunk ${c.number}`, c.text)} onMouseLeave={() => setTip(null)} />
                );
              })}
              {data.questions.map((x) => {
                const cls = x.hit_rank === 1 ? "solid" : x.hit_rank ? "ring" : "miss";
                const on = sel === x.qa_id;
                return x.hit_rank ? (
                  <circle key={x.qa_id} cx={px(x.x)} cy={py(x.y)} r={on ? 8 : 6} className={`map-q ${cls}` + (on ? " on" : sel ? " dim" : "")}
                          onClick={(e) => { e.stopPropagation(); setSel(on ? null : x.qa_id); }}
                          onMouseMove={(e) => show(e, x.hit_rank === 1 ? "เจอที่อันดับ 1" : `เจอที่อันดับ ${x.hit_rank}`, x.question)} onMouseLeave={() => setTip(null)} />
                ) : (
                  <g key={x.qa_id} className={"map-q miss" + (on ? " on" : sel ? " dim" : "")} onClick={(e) => { e.stopPropagation(); setSel(on ? null : x.qa_id); }}
                     onMouseMove={(e) => show(e, "ไม่เจอใน top k", x.question)} onMouseLeave={() => setTip(null)}>
                    <circle cx={px(x.x)} cy={py(x.y)} r={8} fill="transparent" />
                    <path d={`M${px(x.x) - 5} ${py(x.y) - 5} L${px(x.x) + 5} ${py(x.y) + 5} M${px(x.x) + 5} ${py(x.y) - 5} L${px(x.x) - 5} ${py(x.y) + 5}`} />
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="card-pad small muted" style={{ paddingTop: 8 }}>
            {q ? <>“{q.question}” · เส้นทึบไปที่ chunk ที่มีคำตอบ · เส้นประไปที่ chunk ที่ระบบดึงมา 3 อันดับแรก · คลิกพื้นที่ว่างเพื่อยกเลิก</>
              : <>คลิกจุดคำถามเพื่อดูว่ามันอยู่ใกล้ chunk ที่ถูกแค่ไหน · {data.method === "tsne" ? "t-SNE เน้นให้เห็นกลุ่ม ระยะห่างระหว่างกลุ่มอาจไม่ตรงความจริง" : "PCA ย่อแบบเส้นตรง ระยะโดยรวมตรงกว่าแต่กลุ่มอาจซ้อนกัน"} · การย่อเหลือ 2 มิติบิดระยะเสมอ ตัวเลขในตารางคือผลวัดจริง</>}
          </div>
        </>
      )}
      {tip && createPortal(
        <div className="term-card" style={{ left: Math.min(tip.x + 14, innerWidth - 340), top: tip.y + 14 }}>
          <div className="term-title"><span>{tip.title}</span></div>
          <div>{tip.body}</div>
        </div>, document.body)}
    </div>
  );
}
