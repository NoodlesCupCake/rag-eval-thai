import { useMemo, useState } from "react";
import type { Result } from "../types";
import { median, ms, pct, pts } from "../format";
import { CfgLabel } from "./ui";
import { HitCurve } from "./HitCurve";
import { LatencyChart, percentile } from "./LatencyChart";
import { RankDistribution } from "./Ruler";
import { Term } from "./Term";
import { EmbeddingTable } from "./EmbeddingTable";

/* Stats, charts and the comparison table for a set of results: one run, or several runs
   on the compare page (then each row also carries its run name). */

export interface Row extends Result {
  run?: string;
}

type Col = { key: string; label: string; fmt: (v: number | undefined) => string; lowerIsBetter?: boolean; extra?: boolean; delta?: "pt" | "ratio" | "ms" | "count" };

const p = (v: number | undefined) => pct(v);
const f3 = (v: number | undefined) => (v == null ? "–" : v.toFixed(3));

/** Smallest k at which at least `target` of the questions have the answer chunk in the
 *  top k: how many chunks you need to send the LLM. undefined when not reached by k max. */
export function kNeeded(r: Result, target: number): number | undefined {
  const ranks = r.per_question.map((q) => q.hit_rank);
  const n = ranks.length;
  const kMax = Math.max(0, ...Object.keys(r.metrics).filter((k) => k.startsWith("hit@")).map((k) => Number(k.slice(4))));
  for (let k = 1; k <= kMax; k++) if (ranks.filter((x) => x != null && x <= k).length / n >= target - 1e-9) return k;
  return undefined;
}

export function metric(r: Result, key: string): number | undefined {
  if (key === "latency_p90_ms" && r.metrics[key] == null) return percentile(r.latencies, 90);
  if (key === "k@95") return kNeeded(r, 0.95);
  if (key === "rank@50") return kNeeded(r, 0.5);
  if (key === "ctx@95") { const k = kNeeded(r, 0.95); return k == null ? undefined : k * r.avg_chunk_chars; }
  return r.metrics[key];
}

export function ResultsView({ results, kMax, focus, setFocus, baseline, setBaseline }: {
  results: Row[];
  kMax: number;
  focus: number | null;
  setFocus: (i: number) => void;
  baseline?: number | null;
  setBaseline?: (i: number | null) => void;
}) {
  const R = results;
  const [sort, setSort] = useState({ key: "mrr", dir: -1 });
  const [extra, setExtra] = useState(false);
  const [allLines, setAllLines] = useState(false);

  const lead = useMemo(() => R.reduce((bi, r, i) => ((r.metrics.mrr ?? 0) > (R[bi].metrics.mrr ?? 0) ? i : bi), 0), [R]);
  const f = focus ?? lead;
  const hasGen = R.some((r) => r.metrics.answer_correctness != null);
  const hasNdcg = R.some((r) => r.metrics["ndcg@10"] != null);
  const top3 = useMemo(() => R.map((r, i) => ({ i, m: r.metrics.mrr ?? 0 })).sort((a, b) => b.m - a.m).slice(0, 3).map((x) => x.i), [R]);

  const all: Col[] = [
    ...[1, 3, 5].filter((k) => k <= kMax).map((k): Col => ({ key: `hit@${k}`, label: `Hit@${k}`, fmt: p, delta: "pt" })),
    { key: "mrr", label: "MRR", fmt: f3, delta: "ratio" } as Col,
    ...(hasNdcg ? [{ key: "ndcg@10", label: "nDCG@10", fmt: f3, delta: "ratio" } as Col] : []),
    { key: "rank@50", label: "อันดับ p50", fmt: (v) => (v == null ? `> ${kMax}` : String(v)), lowerIsBetter: true, delta: "count" } as Col,
    { key: "k@95", label: "อันดับ p95", fmt: (v) => (v == null ? `> ${kMax}` : String(v)), lowerIsBetter: true, delta: "count" } as Col,
    { key: "ctx@95", label: "context p95", extra: true, fmt: (v) => (v == null ? "–" : Math.round(v).toLocaleString("th-TH")), lowerIsBetter: true, delta: "count" } as Col,
    { key: "coverage@3", label: "Coverage@3", fmt: p, extra: true, delta: "pt" } as Col,
    { key: "latency_p50_ms", label: "p50", fmt: ms, lowerIsBetter: true, extra: true, delta: "ms" } as Col,
    { key: "latency_p90_ms", label: "p90", fmt: ms, lowerIsBetter: true, extra: true, delta: "ms" } as Col,
    { key: "latency_p95_ms", label: "p95", fmt: ms, lowerIsBetter: true, extra: true, delta: "ms" } as Col,
    { key: "latency_p99_ms", label: "p99", fmt: ms, lowerIsBetter: true, extra: true, delta: "ms" } as Col,
    ...(hasGen ? [
      { key: "answer_correctness", label: "ตอบถูก", fmt: p, delta: "pt" } as Col,
      { key: "faithfulness", label: "อิงเอกสาร", fmt: p, delta: "pt" } as Col,
    ] : []),
  ];
  const cols = all.filter((c) => extra || !c.extra);

  const bestOf: Record<string, number> = {};
  cols.forEach((c) => {
    const vals = R.map((r) => metric(r, c.key)).filter((v): v is number => v != null);
    bestOf[c.key] = c.lowerIsBetter ? Math.min(...vals) : Math.max(...vals);
  });
  const sorted = R.map((r, i) => ({ r, i })).sort((a, b) => sort.dir * ((metric(a.r, sort.key) ?? 0) - (metric(b.r, sort.key) ?? 0)));
  const base = baseline != null ? R[baseline] : null;

  function cell(r: Row, c: Col) {
    const v = metric(r, c.key);
    if (!base || r === base || v == null) return c.fmt(v);
    const b = metric(base, c.key);
    if (b == null) return c.fmt(v);
    const d = v - b;
    const good = c.lowerIsBetter ? d < 0 : d > 0;
    const sign = d >= 0 ? "+" : "−";
    const txt = c.delta === "pt" ? pts(d) : c.delta === "ms" ? `${sign}${ms(Math.abs(d))}`
      : c.delta === "count" ? `${sign}${Math.round(Math.abs(d)).toLocaleString("th-TH")}` : `${sign}${Math.abs(d).toFixed(3)}`;
    return (
      <span title={`baseline ${c.fmt(b)}`}>
        {c.fmt(v)} <span className="small" style={{ color: Math.abs(d) < 1e-9 ? "var(--muted)" : good ? "var(--positive)" : "var(--negative)" }}>{txt}</span>
      </span>
    );
  }

  return (
    <>
      <Stats results={R} lead={lead} hasGen={hasGen} hasNdcg={hasNdcg} />

      <div className="card">
        <div className="card-head">
          <h2><Term k="hit@k">Hit@k</Term></h2>
          <div className="row" style={{ gap: 12 }}>
            <span className="hint">คลิกเส้นเพื่อดูรายข้อ</span>
            {R.length > 3 && (
              <div className="seg">
                <button className={!allLines ? "on" : ""} onClick={() => setAllLines(false)}>3 อันดับแรก</button>
                <button className={allLines ? "on" : ""} onClick={() => setAllLines(true)}>ทั้งหมด {R.length}</button>
              </div>
            )}
          </div>
        </div>
        <div className="card-pad">
          <HitCurve results={R} kMax={kMax} lead={lead} focus={f !== lead ? f : null} onFocus={setFocus} show={allLines ? undefined : top3} />
        </div>
      </div>

      <EmbeddingTable results={R} kMax={kMax} showSpeed={extra} />

      <div className="card">
        <div className="card-head">
          <h2>เทียบทุก config</h2>
          <div className="row" style={{ gap: 12 }}>
            {base && <span className="hint">เทียบกับ baseline <CfgLabel label={base.label} /></span>}
            <button className="btn ghost sm" onClick={() => setExtra(!extra)}>{extra ? "ซ่อนค่าเพิ่มเติม" : "แสดงเพิ่ม · coverage, latency"}</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {R.some((r) => r.run) && <th>รอบ</th>}
                <th>Config</th>
                <th><Term k="dist">อันดับที่เจอ</Term></th>
                {extra && <th className="num"><Term k="chunks">chunks</Term></th>}
                {cols.map((c) => (
                  <th key={c.key} className={"num sortable" + (sort.key === c.key ? " sorted" : "")}
                      onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? -sort.dir : c.lowerIsBetter ? 1 : -1 })}>
                    <Term k={c.key}>{c.label}</Term>{sort.key === c.key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                  </th>
                ))}
                {setBaseline && <th />}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ r, i }) => (
                <tr key={i} className={"clickable" + (i === lead ? " lead" : "") + (i === f && i !== lead ? " focus" : "")} onClick={() => setFocus(i)}>
                  {R.some((x) => x.run) && <td className="small ellipsis" style={{ maxWidth: 160 }}>{r.run}</td>}
                  <td><CfgLabel label={r.label} /></td>
                  <td><RankDistribution ranks={r.per_question.map((q) => q.hit_rank)} k={kMax} /></td>
                  {extra && <td className="num">{r.n_chunks}</td>}
                  {cols.map((c) => (
                    <td key={c.key} className={"num" + (R.length > 1 && metric(r, c.key) === bestOf[c.key] ? " strong" : "")}>{cell(r, c)}</td>
                  ))}
                  {setBaseline && (
                    <td className="num">
                      <button className={"btn sm" + (baseline === i ? " primary" : " ghost")}
                              onClick={(e) => { e.stopPropagation(); setBaseline(baseline === i ? null : i); }}>
                        {baseline === i ? "baseline" : "ตั้งเป็น baseline"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {extra && (
        <div className="card">
          <div className="card-head">
            <h2><Term k="latency">Latency การค้นหา</Term></h2>
            <span className="hint">เวลาค้น chunk ต่อคำถาม ไม่รวม LLM · เรียงจากเร็วไปช้าตาม p95 · แกนตั้งเป็น log</span>
          </div>
          <div className="card-pad">
            <LatencyChart results={R} lead={lead} focus={f !== lead ? f : null} onFocus={setFocus} />
          </div>
        </div>
      )}
    </>
  );
}

function Stats({ results, lead, hasGen, hasNdcg }: { results: Row[]; lead: number; hasGen: boolean; hasNdcg: boolean }) {
  const L = results[lead].metrics;
  const vsMedian = (key: string, ratio = false) => {
    if (results.length < 2) return <>config เดียว</>;
    const m = median(results.map((r) => r.metrics[key] ?? 0));
    const d = (L[key] ?? 0) - m;
    return ratio
      ? <>ค่ากลางของทุก config {m.toFixed(3)}</>
      : <><span className={d > 0 ? "up" : ""}>{pts(d)}</span> เทียบค่ากลาง {pct(m)}</>;
  };
  const fig = (v: number | undefined) => <div className="fig">{v == null ? "–" : (v * 100).toFixed(1)}<small>%</small></div>;

  return (
    <div className="stack-16">
      <div className="row small sec" style={{ flexWrap: "wrap" }}>
        ดีที่สุดตาม <Term k="mrr">MRR</Term>
        {results[lead].run && <span className="muted">{results[lead].run} ·</span>}
        <CfgLabel label={results[lead].label} />
      </div>
      <div className="stats">
        <div className="card stat"><div className="label"><Term k="hit@3">Hit@3</Term></div>{fig(L["hit@3"])}<div className="cmp">{vsMedian("hit@3")}</div></div>
        <div className="card stat"><div className="label"><Term k="mrr">MRR</Term></div><div className="fig">{(L.mrr ?? 0).toFixed(3)}</div><div className="cmp">{vsMedian("mrr", true)}</div></div>
        {hasGen ? (
          <div className="card stat"><div className="label"><Term k="answer_correctness">LLM ตอบถูก</Term></div>{fig(L.answer_correctness)}<div className="cmp">อิงเอกสาร {pct(L.faithfulness)} · {L.n_judged} ข้อ</div></div>
        ) : hasNdcg ? (
          <div className="card stat"><div className="label"><Term k="ndcg@10">nDCG@10</Term></div><div className="fig">{(L["ndcg@10"] ?? 0).toFixed(3)}</div><div className="cmp">{vsMedian("ndcg@10", true)}</div></div>
        ) : (
          <div className="card stat"><div className="label"><Term k="hit@1">Hit@1</Term></div>{fig(L["hit@1"])}<div className="cmp">{vsMedian("hit@1")}</div></div>
        )}
        <NeededCard r={results[lead]} />
      </div>
    </div>
  );
}

/* Percentiles of the rank where the right chunk is found: p95 = 2 means 95% of the
   questions have it within the top 2, which is also how many chunks to send the LLM. */
function NeededCard({ r }: { r: Result }) {
  const k95 = kNeeded(r, 0.95), k50 = kNeeded(r, 0.5), k100 = kNeeded(r, 1);
  const kMax = Math.max(...Object.keys(r.metrics).filter((k) => k.startsWith("hit@")).map((k) => Number(k.slice(4))));
  const chars = (k?: number) => (k == null ? "–" : `≈ ${Math.round(k * r.avg_chunk_chars).toLocaleString("th-TH")} ตัวอักษร`);
  return (
    <div className="card stat">
      <div className="label"><Term k="k@95">อันดับที่เจอ p95</Term></div>
      <div className="fig"><small style={{ marginLeft: 0, marginRight: 4 }}>≤</small>{k95 ?? `>${kMax}`}</div>
      <div className="cmp">95% ของคำถามเจอ chunk ที่ถูกภายในอันดับนี้ · ส่ง {k95 ?? "–"} chunk {chars(k95)}</div>
      <div className="cmp">p50 อันดับ {k50 ?? `>${kMax}`} · ทุกข้อภายในอันดับ {k100 ?? `>${kMax}`}</div>
    </div>
  );
}
