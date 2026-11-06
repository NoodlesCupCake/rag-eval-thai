import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Result } from "../types";
import { ms } from "../format";

/* Latency percentiles: four lines only (p50, p90, p95, p99), configs on the x axis from
   fastest to slowest by p95, ms on a log axis because BM25 (~0.2 ms) and dense retrieval
   (~20 ms) differ by two orders of magnitude. p95 carries the accent; the other lines are
   neutral steps that darken toward the tail. Values come from each question's latency, so
   runs saved before p90 existed still work. */

export const PERCENTILES = [
  { p: 50, key: "p50", color: "var(--quiet-series)", width: 1.5, dash: undefined },
  { p: 90, key: "p90", color: "var(--muted)", width: 1.5, dash: undefined },
  { p: 95, key: "p95", color: "var(--accent)", width: 2.5, dash: undefined },
  { p: 99, key: "p99", color: "var(--text)", width: 1.5, dash: "4 3" },
] as const;

/** numpy-style linear-interpolated percentile */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

const M = { l: 56, r: 48, t: 16, b: 80 };
const H = 336;
const SLOT = 96; // min width per config, the chart scrolls sideways below this

export function LatencyChart({ results, lead, focus, onFocus }: { results: (Result & { run?: string })[]; lead: number; focus: number | null; onFocus: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(760);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCw(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = results
    .map((r, i) => ({ i, label: r.label, run: r.run, v: Object.fromEntries(PERCENTILES.map((s) => [s.key, percentile(r.latencies, s.p)])) as Record<string, number> }))
    .sort((a, b) => a.v.p95 - b.v.p95);
  const n = rows.length;
  const W = Math.max(cw, M.l + M.r + n * SLOT);
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  // log axis on decades and half-decades (1, 3, 10, 30 …)
  const all = rows.flatMap((r) => Object.values(r.v)).filter((v) => v > 0);
  const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...all))));
  const hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...all))));
  const ticks: number[] = [];
  for (let d = lo; d <= hi * 1.0001; d *= 10) ticks.push(d, d * 3);
  const yTicks = ticks.filter((t) => t >= lo && t <= hi);
  const y = (v: number) => M.t + ih - ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * ih;
  const x = (j: number) => M.l + (n === 1 ? iw / 2 : (j / (n - 1)) * iw);

  function move(e: MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / iw) * (n - 1)))));
  }

  const h = hover != null ? rows[hover] : null;
  // end-of-line labels, pushed apart so close lines don't print on top of each other
  const ends = PERCENTILES.map((s) => ({ key: s.key, y: n ? y(rows[n - 1].v[s.key]) : 0 })).sort((a, b) => b.y - a.y);
  for (let i = 1; i < ends.length; i++) if (ends[i - 1].y - ends[i].y < 14) ends[i].y = ends[i - 1].y - 14;
  const endY = Object.fromEntries(ends.map((e) => [e.key, e.y]));
  const tipLeft = hover != null ? (x(hover) / W) * 100 : 0;

  return (
    <div className="chart" ref={box} style={{ overflowX: W > cw ? "auto" : undefined }}>
      <div style={{ position: "relative", width: W > cw ? W : "100%" }}>
        <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={move} onMouseLeave={() => setHover(null)} role="img"
             aria-label="Retrieval latency percentiles p50, p90, p95 and p99 for each configuration">
          <g className="grid">{yTicks.map((t) => <line key={t} x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />)}</g>
          <g className="axis">
            {yTicks.map((t) => <text key={t} x={M.l - 10} y={y(t) + 4} textAnchor="end">{t >= 1 ? t : t.toFixed(t < 0.1 ? 2 : 1)}</text>)}
            <text className="axis-title" x={12} y={M.t + ih / 2} transform={`rotate(-90 12 ${M.t + ih / 2})`} textAnchor="middle">ms (log)</text>
            {rows.map((r, j) => {
              const [chunk, ret] = r.label.split(" · ");
              const isLead = r.i === lead;
              const style = isLead ? { fill: "var(--accent-ink)" } : r.i === focus ? { fill: "var(--text)" } : undefined;
              return (
                <g key={r.i} onClick={() => onFocus(r.i)} style={{ cursor: "pointer" }}>
                  <line x1={x(j)} x2={x(j)} y1={M.t + ih} y2={M.t + ih + 6} stroke="var(--line-strong)" />
                  <text x={x(j)} y={M.t + ih + 22} textAnchor="middle" style={style}>{chunk}</text>
                  <text x={x(j)} y={M.t + ih + 38} textAnchor="middle" style={style}>{(ret ?? "").replace("multilingual-", "")}</text>
                  {r.run && <text x={x(j)} y={M.t + ih + 54} textAnchor="middle" style={{ fill: "var(--muted)", font: "11px var(--sans)" }}>{r.run}</text>}
                </g>
              );
            })}
          </g>
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} stroke="var(--line-strong)" />}
          {PERCENTILES.map((s) => (
            <g key={s.key}>
              <polyline points={rows.map((r, j) => `${x(j)},${y(r.v[s.key])}`).join(" ")} fill="none" stroke={s.color}
                        strokeWidth={s.width} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
              {rows.map((r, j) => (
                <circle key={r.i} cx={x(j)} cy={y(r.v[s.key])} r={hover === j ? 4.5 : 3} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              ))}
              {/* direct label at the right end of each line */}
              <text x={x(n - 1) + 10} y={endY[s.key] + 4}
                    style={{ fill: s.key === "p95" ? "var(--accent-ink)" : "var(--text-2)", font: "500 12px var(--mono)" }}>{s.key}</text>
            </g>
          ))}
        </svg>
        {h && (
          <div className="tip" style={{ top: 8, left: tipLeft > 55 ? `calc(${tipLeft}% - 220px)` : `calc(${tipLeft}% + 12px)` }}>
            <div className="t">{h.run ? `${h.run} · ` : ""}{h.label}</div>
            {[...PERCENTILES].reverse().map((s) => (
              <div className="r" key={s.key}>
                <span className={s.key === "p95" ? "lead" : ""}>{s.key}</span>
                <b>{ms(h.v[s.key])}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
