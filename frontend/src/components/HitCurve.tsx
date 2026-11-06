import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Result } from "../types";
import { pct } from "../format";

/* Hit@k drawn like a graduated instrument: the leading config in amber with its readings
   at k = 1, 3 and 5 marked on the scale, the focused config in ink, the rest quiet. */

const M = { l: 52, r: 24, t: 20, b: 48 };
const MARKS = [1, 3, 5];

interface Props {
  results: Result[];
  kMax: number;
  lead: number;
  focus: number | null;
  onFocus: (i: number) => void;
  /** indices to draw; the rest are left out to keep the chart readable */
  show?: number[];
}

export function HitCurve({ results, kMax, lead, focus, onFocus, show }: Props) {
  const visible = new Set(show ?? results.map((_, i) => i));
  visible.add(lead);
  if (focus != null) visible.add(focus);
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hoverK, setHoverK] = useState<number | null>(null);
  // Draw at the container's real width so labels stay at their set size on phones.
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 560 ? 280 : 340;
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const hit = (r: Result, k: number) => r.metrics[`hit@${k}`] ?? 0;

  // Start the scale just below the weakest Hit@1 so the curves use the full height.
  const low = Math.min(...results.filter((_, i) => visible.has(i)).map((r) => hit(r, 1)));
  const y0 = Math.max(0, Math.floor((low - 0.05) * 10) / 10);
  const ks = Array.from({ length: kMax }, (_, i) => i + 1);
  const x = (k: number) => M.l + (kMax === 1 ? iw / 2 : ((k - 1) / (kMax - 1)) * iw);
  const y = (v: number) => M.t + (1 - (v - y0) / (1 - y0)) * ih;
  const yTicks = Array.from({ length: Math.round((1 - y0) / 0.1) + 1 }, (_, i) => +(y0 + i * 0.1).toFixed(2));

  const order = results.map((_, i) => i).filter((i) => visible.has(i) && i !== lead && i !== focus);
  if (focus != null && focus !== lead) order.push(focus);
  order.push(lead);

  function move(e: MouseEvent<SVGSVGElement>) {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const k = Math.round(((px - M.l) / iw) * (kMax - 1)) + 1;
    setHoverK(Math.max(1, Math.min(kMax, k)));
  }

  const style = (i: number) =>
    i === lead ? { stroke: "var(--accent)", width: 2.5, opacity: 1 }
      : i === focus ? { stroke: "var(--text)", width: 2, opacity: 1 }
        : { stroke: "var(--quiet-series)", width: 1.5, opacity: 1 };
  const path = (r: Result) => ks.map((k) => `${x(k)},${y(hit(r, k))}`).join(" ");

  const tipRows = hoverK
    ? results.map((r, i) => ({ i, label: r.label, v: hit(r, hoverK) })).filter((r) => visible.has(r.i)).sort((a, b) => b.v - a.v)
    : [];
  const shown = tipRows.slice(0, 5);
  if (focus != null && hoverK && !shown.some((r) => r.i === focus)) shown.push(tipRows.find((r) => r.i === focus)!);
  const tipLeft = hoverK ? (x(hoverK) / W) * 100 : 0;

  return (
    <div className="chart" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onMouseMove={move} onMouseLeave={() => setHoverK(null)}
           role="img" aria-label="Hit at k for each configuration">
        <g className="grid">
          {yTicks.map((v) => <line key={v} x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} />)}
        </g>
        <g className="axis">
          {yTicks.map((v) => <text key={v} x={M.l - 10} y={y(v) + 4} textAnchor="end">{Math.round(v * 100)}%</text>)}
          {/* graduated k scale: a tick per k, long ticks at 1, 5 and 10 */}
          <line x1={M.l} x2={W - M.r} y1={M.t + ih} y2={M.t + ih} stroke="var(--line-strong)" />
          {ks.map((k) => {
            const long = k === 1 || k % 5 === 0;
            const label = W >= 560 || long || k === 3;
            return (
              <g key={k}>
                <line x1={x(k)} x2={x(k)} y1={M.t + ih} y2={M.t + ih + (long ? 8 : 4)} stroke="var(--line-strong)" />
                {label && <text x={x(k)} y={M.t + ih + 22} textAnchor="middle">{k}</text>}
              </g>
            );
          })}
        </g>
        <text className="axis-title" x={M.l + iw / 2} y={H - 4} textAnchor="middle">k · จำนวน chunk ที่ดึงมา</text>

        {hoverK && <line x1={x(hoverK)} x2={x(hoverK)} y1={M.t} y2={M.t + ih} stroke="var(--line-strong)" />}

        {order.map((i) => {
          const s = style(i);
          return (
            <g key={i} onClick={() => onFocus(i)} style={{ cursor: "pointer" }}>
              <polyline points={path(results[i])} fill="none" stroke={s.stroke} strokeWidth={s.width}
                        strokeOpacity={s.opacity} strokeLinejoin="round" strokeLinecap="round" />
              <polyline points={path(results[i])} fill="none" stroke="transparent" strokeWidth={14} />
            </g>
          );
        })}

        {/* readings of the leading config */}
        {MARKS.filter((k) => k <= kMax).map((k) => {
          const v = hit(results[lead], k);
          return (
            <g key={k}>
              <line x1={x(k)} x2={x(k)} y1={y(v)} y2={M.t + ih} stroke="var(--accent)" strokeOpacity={0.35} strokeDasharray="2 3" />
              <circle cx={x(k)} cy={y(v)} r={4} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
              <text x={x(k) + 8} y={y(v) + 16} style={{ fill: "var(--accent-ink)", font: "500 12px var(--mono)" }}>
                {(v * 100).toFixed(1)}
              </text>
            </g>
          );
        })}
        {focus != null && focus !== lead && hoverK && (
          <circle cx={x(hoverK)} cy={y(hit(results[focus], hoverK))} r={4} fill="var(--text)" stroke="var(--card)" strokeWidth={2} />
        )}
      </svg>
      {hoverK && (
        <div className="tip" style={{ top: 12, left: tipLeft > 55 ? `calc(${tipLeft}% - 224px)` : `calc(${tipLeft}% + 12px)` }}>
          <div className="t">Hit@{hoverK}</div>
          {shown.map((r) => (
            <div className="r" key={r.i}>
              <span className={r.i === lead ? "lead" : ""}>{r.label}</span>
              <b>{pct(r.v)}</b>
            </div>
          ))}
          {tipRows.length > shown.length && <div className="muted">อีก {tipRows.length - shown.length} configs</div>}
        </div>
      )}
    </div>
  );
}
