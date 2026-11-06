import { useEffect, useRef, useState } from "react";
import type { Result, Run } from "../types";
import { kNeeded } from "./ResultsView";
import { CfgLabel } from "./ui";
import { Term } from "./Term";

/* The results page's centrepiece: a graduated scale from rank 1 to k, one dot per
   question stacked above the rank where its right chunk was found, misses in their own
   bin, and needle readings at p50 and p95. Dots within p95 carry the accent. */

const M = { l: 28, r: 28, t: 28, b: 40 };
const DOT = 9, GAP = 3;

export function RankScale({ result, kMax, questions }: { result: Result; kMax: number; questions?: Run["questions"] }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; rank: number | null } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pq = result.per_question;
  const bins = Array.from({ length: kMax + 1 }, () => [] as typeof pq); // last bin = not found
  pq.forEach((q) => bins[q.hit_rank && q.hit_rank <= kMax ? q.hit_rank - 1 : kMax].push(q));
  const tallest = Math.max(...bins.map((b) => b.length), 1);
  const iw = W - M.l - M.r;
  const slot = iw / (kMax + 1.4);
  const perCol = Math.max(1, Math.floor((slot - 4) / (DOT + GAP)));
  const rows = Math.ceil(tallest / perCol);
  const H = M.t + rows * (DOT + GAP) + 24 + M.b;
  const base = H - M.b;
  const cx = (i: number) => M.l + slot * (i + 0.5) + (i === kMax ? slot * 0.4 : 0);
  const p50 = kNeeded(result, 0.5), p95 = kNeeded(result, 0.95);
  const n = pq.length;
  const within = (k: number) => pq.filter((q) => q.hit_rank && q.hit_rank <= k).length;

  return (
    <div className="card scale-card">
      <div className="scale-head">
        <div>
          <h2>chunk ที่ตอบคำถามได้จริง ถูกค้นเจอที่อันดับเท่าไร</h2>
          <p>หนึ่งจุดคือหนึ่งคำถาม ยิ่งจุดกองอยู่ทางซ้าย embedding และการตัด chunk ยิ่งดี · <CfgLabel label={result.label} /></p>
        </div>
        <div className="readings">
          <div className="reading"><div className="v"><small>≤</small>{p50 ?? `>${kMax}`}</div><div className="l"><Term k="rank@50">p50</Term> · ครึ่งหนึ่งของคำถาม</div></div>
          <div className="reading p95"><div className="v"><small>≤</small>{p95 ?? `>${kMax}`}</div><div className="l"><Term k="k@95">p95</Term> · {p95 ? `${within(p95)}/${n} ข้อ` : "ยังไม่ถึง"}</div></div>
          <div className="reading"><div className="v">{bins[kMax].length}</div><div className="l">ไม่เจอใน {kMax} อันดับ</div></div>
        </div>
      </div>
      <div className="scale" ref={box} style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
             aria-label={`Rank of the right chunk for ${n} questions; p50 rank ${p50}, p95 rank ${p95}`}>
          <rect className="bed" x={M.l} y={base} width={iw} height={6} rx={3} />
          {/* graduations: a long tick per rank, short ones between */}
          {Array.from({ length: kMax }, (_, i) => (
            <g key={i}>
              <line className="tick" x1={cx(i)} x2={cx(i)} y1={base} y2={base + 12} />
              {i < kMax - 1 && <line className="tick minor" x1={cx(i) + slot / 2} x2={cx(i) + slot / 2} y1={base} y2={base + 6} />}
              <text className="tlabel" x={cx(i)} y={base + 28} textAnchor="middle">{i + 1}</text>
            </g>
          ))}
          <text className="tlabel" x={cx(kMax)} y={base + 28} textAnchor="middle" style={{ fill: "var(--negative)" }}>ไม่เจอ</text>

          {/* needles */}
          {[{ k: p50, cls: "", label: "p50" }, { k: p95, cls: " p95", label: "p95" }].map((nd) => nd.k != null && (
            <g key={nd.label}>
              <line className={"needle" + nd.cls} x1={cx(nd.k - 1) + slot / 2} x2={cx(nd.k - 1) + slot / 2} y1={M.t - 14} y2={base + 6} />
              <text className={"nlabel" + nd.cls} x={cx(nd.k - 1) + slot / 2 + 6} y={M.t - 4}>{nd.label}</text>
            </g>
          ))}

          {bins.map((b, i) =>
            b.map((q, j) => {
              const col = j % perCol, row = Math.floor(j / perCol);
              const x = cx(i) - ((Math.min(b.length, perCol) - 1) * (DOT + GAP)) / 2 + col * (DOT + GAP);
              const y = base - 10 - row * (DOT + GAP);
              const miss = i === kMax, tail = !miss && p95 != null && i + 1 > p95;
              return (
                <circle key={q.qa_id} cx={x} cy={y} r={DOT / 2} className={"dot" + (miss ? " miss" : tail ? " tail" : "")}
                        onMouseEnter={() => setHover({ x: (x / W) * 100, y, text: questions?.[q.qa_id]?.question ?? q.qa_id, rank: q.hit_rank })}
                        onMouseLeave={() => setHover(null)} />
              );
            }),
          )}
        </svg>
        {hover && (
          <div className="tip" style={{ left: `calc(${hover.x}% - 100px)`, top: Math.max(0, hover.y - 70) }}>
            <div className="t">{hover.rank ? `เจอที่อันดับ ${hover.rank}` : `ไม่เจอใน ${kMax} อันดับ`}</div>
            <div>{hover.text}</div>
          </div>
        )}
      </div>
    </div>
  );
}
