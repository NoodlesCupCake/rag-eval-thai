import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Result, Run } from "../types";
import { kNeeded } from "./ResultsView";
import { CfgLabel } from "./ui";

/* Where the right chunk was found, said plainly: one sentence first, then one row per
   rank with a bar, the number of questions and the running total. Click a row to see
   which questions landed there. */

export function RankScale({ result, kMax, questions }: { result: Result; kMax: number; questions?: Run["questions"] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const SAMPLE = 5;
  const pq = result.per_question;
  const n = pq.length || 1;
  const byRank = Array.from({ length: kMax + 1 }, () => [] as typeof pq); // last = not found
  pq.forEach((q) => byRank[q.hit_rank && q.hit_rank <= kMax ? q.hit_rank - 1 : kMax].push(q));
  const lastFound = byRank.slice(0, kMax).reduce((last, b, i) => (b.length ? i : last), 0);
  const rows = [...byRank.slice(0, lastFound + 1).map((qs, i) => ({ label: `อันดับ ${i + 1}`, rank: i + 1, qs })),
                ...(byRank[kMax].length ? [{ label: "ไม่เจอ", rank: 0, qs: byRank[kMax] }] : [])];
  const max = Math.max(...rows.map((r) => r.qs.length), 1);
  const first = byRank[0].length;
  const p95 = kNeeded(result, 0.95), allIn = kNeeded(result, 1);
  const pct = (x: number) => `${Math.round((x / n) * 100)}%`;
  let running = 0;

  return (
    <div className="card rank-card">
      <div className="rank-head">
        <div className="rank-lede">
          <span className="big">{pct(first)}</span>
          <span>ของคำถาม เจอ chunk ที่ถูก<b>เป็นอันดับแรก</b></span>
        </div>
        <div className="small sec">
          {allIn ? <>ทุกข้อเจอภายในอันดับ {allIn}</> : <>{byRank[kMax].length} ข้อไม่เจอใน {kMax} อันดับ</>}
          {p95 && p95 !== allIn ? <> · 95% เจอภายในอันดับ {p95}</> : null}
          {" · "}<CfgLabel label={result.label} />
        </div>
      </div>
      <div className="rank-rows" role="list">
        {rows.map((r) => {
          running += r.rank ? r.qs.length : 0;
          const isOpen = open === r.rank;
          return (
            <div key={r.label} role="listitem">
              <button className={"rank-row" + (r.rank === 0 ? " miss" : r.rank === 1 ? " first" : "")} onClick={() => { setOpen(isOpen ? null : r.rank); setAll(false); }}
                      aria-expanded={isOpen} disabled={!r.qs.length}>
                <ChevronRight className="icon chev" style={{ transform: isOpen ? "rotate(90deg)" : undefined }} />
                <span className="rank-label">{r.label}</span>
                <span className="rank-bar"><span style={{ width: `${(r.qs.length / max) * 100}%` }} /></span>
                <span className="rank-n">{r.qs.length} ข้อ</span>
                <span className="rank-cum">{r.rank ? `สะสม ${pct(running)}` : ""}</span>
              </button>
              {isOpen && (
                <div className="rank-qs">
                  <ul>
                    {(all ? r.qs : r.qs.slice(0, SAMPLE)).map((q) => <li key={q.qa_id}>{questions?.[q.qa_id]?.question ?? q.qa_id}</li>)}
                  </ul>
                  {r.qs.length > SAMPLE && (
                    <button className="btn ghost sm" onClick={() => setAll(!all)}>
                      {all ? "แสดงแค่ตัวอย่าง" : `ดูทั้งหมด ${r.qs.length} ข้อ`}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
