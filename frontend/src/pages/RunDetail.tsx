import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, errorText } from "../api";
import type { Result, Run } from "../types";
import { date, median, ms, pct, pts } from "../format";
import { CfgLabel, Empty, ErrorNote, PageHead } from "../components/ui";
import { HitCurve } from "../components/HitCurve";
import { LatencyList } from "../components/LatencyList";
import { RankDistribution } from "../components/Ruler";
import { Questions } from "./Questions";

type Col = { key: string; label: string; fmt: (v: number | undefined) => string; lowerIsBetter?: boolean };

export function RunDetailPage() {
  const { id = "" } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [sort, setSort] = useState({ key: "mrr", dir: -1 });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.get<Run>("/runs/" + id);
        if (!alive) return;
        setRun(r);
        if (r.status === "running") setTimeout(tick, 1500);
      } catch (e) {
        setError(errorText(e));
      }
    };
    tick();
    return () => { alive = false; };
  }, [id]);

  const R: Result[] = run?.results ?? [];
  const lead = useMemo(() => R.reduce((bi, r, i) => ((r.metrics.mrr ?? 0) > (R[bi].metrics.mrr ?? 0) ? i : bi), 0), [R]);

  if (error) return <ErrorNote error={error} />;
  if (!run) return <div className="muted">กำลังโหลด</div>;

  const kMax = run.spec.k_max;
  const f = focus ?? lead;
  const hasGen = R.some((r) => r.metrics.answer_correctness != null);
  const total = run.spec.chunkings.length * run.spec.retrievers.length;

  const cols: Col[] = [
    ...[1, 3, 5].filter((k) => k <= kMax).map((k) => ({ key: `hit@${k}`, label: `Hit@${k}`, fmt: (v: number | undefined) => pct(v) })),
    { key: "mrr", label: "MRR", fmt: (v) => (v == null ? "–" : v.toFixed(3)) },
    { key: "coverage@3", label: "Coverage@3", fmt: (v) => pct(v) },
    { key: "latency_p50_ms", label: "p50", fmt: ms, lowerIsBetter: true },
    { key: "latency_p95_ms", label: "p95", fmt: ms, lowerIsBetter: true },
    ...(hasGen ? [
      { key: "answer_correctness", label: "ตอบถูก", fmt: (v: number | undefined) => pct(v) },
      { key: "faithfulness", label: "อิงเอกสาร", fmt: (v: number | undefined) => pct(v) },
    ] : []),
  ];
  const bestOf: Record<string, number> = {};
  cols.forEach((c) => {
    const vals = R.map((r) => r.metrics[c.key]).filter((v): v is number => v != null);
    bestOf[c.key] = c.lowerIsBetter ? Math.min(...vals) : Math.max(...vals);
  });
  const sorted = R.map((r, i) => ({ r, i })).sort((a, b) => sort.dir * ((a.r.metrics[sort.key] ?? 0) - (b.r.metrics[sort.key] ?? 0)));

  return (
    <div className="stack">
      <PageHead back={{ to: "/runs", label: "ผลลัพธ์ทั้งหมด" }} title={run.name}
                sub={<span className="mono small">{date(run.created_at)} · {run.n_questions} คำถาม · {R.length}/{total} configs{run.status === "running" ? " · กำลังรัน" : ""}</span>} />
      {run.error && <ErrorNote error={"รันไม่สำเร็จ: " + run.error} />}

      {R.length === 0 ? (
        <div className="card">
          <Empty title={run.status === "running" ? "กำลังรัน config แรก" : "ไม่มีผลลัพธ์"}>
            <p>ครั้งแรกอาจช้าเพราะต้องดาวน์โหลด embedding model</p>
          </Empty>
        </div>
      ) : (
        <>
          <Stats results={R} lead={lead} hasGen={hasGen} />

          <div className="split">
            <div className="card">
              <div className="card-head">
                <h2>Hit@k</h2>
                <span className="hint">สัดส่วนคำถามที่ evidence อยู่ใน k อันดับแรก คลิกเส้นเพื่อดูรายข้อ</span>
              </div>
              <div className="card-pad">
                <HitCurve results={R} kMax={kMax} lead={lead} focus={f !== lead ? f : null} onFocus={setFocus} />
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h2>Latency การค้นหา</h2><span className="hint">p50 ถึง p95</span></div>
              <LatencyList results={R} lead={lead} focus={f !== lead ? f : null} onFocus={setFocus} />
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>เทียบทุก config</h2><span className="hint">คลิกหัวคอลัมน์เพื่อเรียง คลิกแถวเพื่อดูรายข้อ</span></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Config</th>
                    <th title="อันดับที่เจอ evidence ของทุกคำถาม 1 ถึง k แท่งสุดท้ายคือไม่เจอ">อันดับที่เจอ</th>
                    <th className="num">chunks</th>
                    {cols.map((c) => (
                      <th key={c.key} className={"num sortable" + (sort.key === c.key ? " sorted" : "")}
                          onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? -sort.dir : c.lowerIsBetter ? 1 : -1 })}>
                        {c.label}{sort.key === c.key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(({ r, i }) => (
                    <tr key={i} className={"clickable" + (i === lead ? " lead" : "") + (i === f && i !== lead ? " focus" : "")} onClick={() => setFocus(i)}>
                      <td><CfgLabel label={r.label} /></td>
                      <td><RankDistribution ranks={r.per_question.map((p) => p.hit_rank)} k={kMax} /></td>
                      <td className="num">{r.n_chunks}</td>
                      {cols.map((c) => (
                        <td key={c.key} className={"num" + (R.length > 1 && r.metrics[c.key] === bestOf[c.key] ? " strong" : "")}>{c.fmt(r.metrics[c.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Questions run={run} result={R[f]} />
        </>
      )}
    </div>
  );
}

function Stats({ results, lead, hasGen }: { results: Result[]; lead: number; hasGen: boolean }) {
  const L = results[lead].metrics;
  const vsMedian = (key: string) => {
    if (results.length < 2) return <>config เดียวในรอบนี้</>;
    const m = median(results.map((r) => r.metrics[key] ?? 0));
    const d = (L[key] ?? 0) - m;
    return <><span className={d > 0 ? "up" : ""}>{pts(d)}</span> เทียบค่ากลาง {pct(m)}</>;
  };
  const fig = (v: number | undefined, unit = "%") => (
    <div className="fig">{v == null ? "–" : (v * 100).toFixed(1)}<small>{unit}</small></div>
  );

  return (
    <div className="stack-16">
      <div className="row small sec">ดีที่สุดตาม MRR <CfgLabel label={results[lead].label} /></div>
      <div className="stats">
        <div className="card stat"><div className="label">Hit@3</div>{fig(L["hit@3"])}<div className="cmp">{vsMedian("hit@3")}</div></div>
        <div className="card stat"><div className="label">Hit@1</div>{fig(L["hit@1"])}<div className="cmp">{vsMedian("hit@1")}</div></div>
        <div className="card stat">
          <div className="label">MRR</div>
          <div className="fig">{(L.mrr ?? 0).toFixed(3)}</div>
          <div className="cmp">{results.length > 1 ? <>ค่ากลาง {median(results.map((r) => r.metrics.mrr ?? 0)).toFixed(3)}</> : "config เดียวในรอบนี้"}</div>
        </div>
        {hasGen ? (
          <div className="card stat"><div className="label">LLM ตอบถูก</div>{fig(L.answer_correctness)}<div className="cmp">อิงเอกสาร {pct(L.faithfulness)} · {L.n_judged} ข้อ</div></div>
        ) : (
          <div className="card stat">
            <div className="label">Latency p95</div>
            <div className="fig">{(L.latency_p95_ms ?? 0).toFixed((L.latency_p95_ms ?? 0) < 10 ? 2 : 1)}<small>ms</small></div>
            <div className="cmp">p50 {ms(L.latency_p50_ms)} · p99 {ms(L.latency_p99_ms)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
