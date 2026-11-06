import type { Result } from "../types";
import { ms, pct } from "../format";
import { kNeeded } from "./ResultsView";
import { Term } from "./Term";
import { aligned, meanCI, pairedDiff, propCI, rr } from "../stats";

/* One row per embedding model, using the plain dense configs so the model is the only
   thing that differs: quality next to speed and vector size. Shown when a run (or a
   comparison) has two or more models under the same chunking. */

export function embeddingGroups(results: (Result & { run?: string })[]) {
  const groups = new Map<string, (Result & { run?: string })[]>();
  results.forEach((r) => {
    if (r.retriever.type !== "dense" || !r.retriever.model) return;
    const c = r.chunking;
    const key = `${c.strategy}·${c.size}${c.overlap ? `/${c.overlap}` : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });
  return [...groups.entries()].filter(([, rs]) => new Set(rs.map((r) => r.retriever.model)).size >= 2);
}

export function EmbeddingTable({ results, kMax, showSpeed = false }: { results: (Result & { run?: string })[]; kMax: number; showSpeed?: boolean }) {
  const groups = embeddingGroups(results);
  if (!groups.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>เทียบ embedding model</h2>
        <span className="hint">เฉพาะ config แบบ dense ที่ตัด chunk เหมือนกัน จึงต่างกันแค่โมเดล · อันดับยิ่งน้อยยิ่งดี</span>
      </div>
      {groups.map(([chunking, rs]) => {
        const best = rs.reduce((a, b) => ((b.metrics.mrr ?? 0) > (a.metrics.mrr ?? 0) ? b : a));
        const sorted = [...rs].sort((a, b) => (b.metrics.mrr ?? 0) - (a.metrics.mrr ?? 0));
        return (
          <div key={chunking}>
            {groups.length > 1 && <div className="meta" style={{ padding: "12px 24px 0" }}>chunk {chunking}</div>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="num"><Term k="hit@1">Hit@1</Term></th>
                    <th className="num"><Term k="hit@3">Hit@3</Term></th>
                    <th className="num"><Term k="mrr">MRR</Term></th>
                    <th className="num"><Term k="ndcg@10">nDCG@10</Term></th>
                    <th className="num"><Term k="rank@50">อันดับ p50</Term></th>
                    <th className="num"><Term k="k@95">อันดับ p95</Term></th>
                    {showSpeed && <>
                      <th className="num"><Term k="query_ms">ต่อคำถาม p50</Term></th>
                      <th className="num"><Term k="latency_p95_ms">p95</Term></th>
                      <th className="num"><Term k="chunks_per_sec">index</Term></th>
                    </>}
                    <th className="num"><Term k="dim">มิติ</Term></th>
                    <th><Term k="vs_best">ต่างจากอันดับ 1</Term></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const e = r.embedding;
                    const k = kNeeded(r, 0.95), k50 = kNeeded(r, 0.5);
                    return (
                      <tr key={i} className={r === best ? "lead" : ""}>
                        <td>
                          <div className="cfg-label" title={r.retriever.model ?? ""}>{r.retriever.model?.split("/").pop()}</div>
                          <div className="meta">{r.retriever.model?.includes("/") ? r.retriever.model.split("/")[0] : ""}</div>
                          {(e?.query_prompt || e?.passage_prompt) && (
                            <div className="meta ellipsis" style={{ maxWidth: 260 }} title={`query: ${JSON.stringify(e?.query_prompt ?? "")}\npassage: ${JSON.stringify(e?.passage_prompt ?? "")}`}>
                              prompt {JSON.stringify((e?.query_prompt ?? "").slice(0, 24))}
                            </div>
                          )}
                          {r.run && <div className="meta">{r.run}</div>}
                        </td>
                        <td className={"num" + (r === best ? " strong" : "")}>{pct(r.metrics["hit@1"])}<div className="ci">±{(propCI(r.metrics["hit@1"] ?? 0, r.per_question.length) * 100).toFixed(0)}</div></td>
                        <td className="num">{pct(r.metrics["hit@3"])}</td>
                        <td className={"num" + (r === best ? " strong" : "")}>{(r.metrics.mrr ?? 0).toFixed(3)}<div className="ci">±{meanCI(r.per_question.map(rr)).toFixed(3)}</div></td>
                        <td className="num">{r.metrics["ndcg@10"] != null ? r.metrics["ndcg@10"]!.toFixed(3) : "–"}</td>
                        <td className="num">{k50 ?? `>${kMax}`}</td>
                        <td className={"num" + (r === best ? " strong" : "")}>{k ?? `>${kMax}`}</td>
                        {showSpeed && <>
                          <td className="num">{ms(r.metrics.latency_p50_ms)}</td>
                          <td className="num">{ms(r.metrics.latency_p95_ms)}</td>
                          <td className="num" title={e?.encode_seconds ? `${r.n_chunks} chunks ใน ${e.encode_seconds.toFixed(1)} s` : "ใช้ embedding ที่มีอยู่แล้ว ไม่ได้วัด"}>
                            {e?.chunks_per_sec ? `${Math.round(e.chunks_per_sec)} chunk/s` : "–"}
                          </td>
                        </>}
                        <td className="num">{e?.dim?.toLocaleString("th-TH") ?? "–"}</td>
                        <td>{r === best ? <span className="small muted">อันดับ 1</span> : (() => {
                          const [a, b] = aligned(r.per_question, best.per_question, rr);
                          const t = pairedDiff(a, b);
                          return <span className={"small " + (t.clear ? "diff-clear" : "muted")} title={`MRR ต่างกัน ${t.diff.toFixed(3)} (95%: ${t.lo.toFixed(3)} ถึง ${t.hi.toFixed(3)}) จาก ${a.length} คำถามเดียวกัน`}>
                            {t.clear ? `แย่กว่าชัดเจน ${t.diff.toFixed(3)}` : "ไม่ชัด · อาจเท่ากัน"}
                          </span>;
                        })()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
