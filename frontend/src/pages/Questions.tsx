import { useEffect, useState } from "react";
import { api } from "../api";
import type { DocFull, Result, Run, Span } from "../types";
import { chunkNo, ms } from "../format";
import { CfgLabel, Empty } from "../components/ui";
import { RankRuler } from "../components/Ruler";

type Filter = "miss3" | "miss1" | "wrong" | "all";

export function Questions({ run, result }: { run: Run; result: Result }) {
  const [filter, setFilter] = useState<Filter>("miss3");
  const [open, setOpen] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string | null>>({});
  const kMax = run.spec.k_max;
  const judged = result.per_question.some((p) => p.judge);

  useEffect(() => {
    Promise.all(
      Object.keys(run.doc_names).map((d) =>
        api.get<DocFull>("/documents/" + d).then((x) => [d, x.text] as const).catch(() => [d, null] as const),
      ),
    ).then((pairs) => setTexts(Object.fromEntries(pairs)));
  }, [run.id]);

  const rows = result.per_question.filter((p) => {
    if (filter === "miss1") return p.hit_rank !== 1;
    if (filter === "miss3") return !(p.hit_rank && p.hit_rank <= 3);
    if (filter === "wrong") return p.judge && p.judge.verdict !== "correct";
    return true;
  });
  const snippet = (s: Span) => texts[s.doc_id]?.slice(s.start, s.end) ?? "(เอกสารถูกลบแล้ว)";

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="row">รายข้อ <CfgLabel label={result.label} /></h2>
        <div className="seg" role="tablist">
          {([["miss3", "ไม่เจอใน top 3"], ["miss1", "ไม่ใช่อันดับ 1"], ...(judged ? [["wrong", "LLM ตอบไม่ถูก"]] : []), ["all", "ทั้งหมด"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 && <Empty title="ไม่มีข้อที่ตรงเงื่อนไข" />}
      {rows.map((p) => {
        const q = run.questions?.[p.qa_id] ?? { question: p.qa_id, answer: "", evidence: [] };
        const isOpen = open === p.qa_id;
        return (
          <div key={p.qa_id} style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="q-row clickable" onClick={() => setOpen(isOpen ? null : p.qa_id)}>
              <span style={{ color: "var(--text)" }}>{q.question}</span>
              <RankRuler rank={p.hit_rank} k={kMax} />
              <span className="num small" style={{ color: p.hit_rank ? "var(--text)" : "var(--negative)" }}>{p.hit_rank ? `#${p.hit_rank}` : "ไม่เจอ"}</span>
              <span className="num small muted hide-sm">{ms(p.latency_ms)}</span>
              <span className={"verdict hide-sm " + (p.judge?.verdict ?? "")}>{p.judge?.verdict ?? ""}</span>
            </div>
            {isOpen && (
              <div className="q-detail">
                <div className="small"><span className="muted">คำตอบอ้างอิง</span> {q.answer}</div>
                {p.gold && (
                  <div className="small">
                    <span className="muted">คำตอบอยู่ใน</span>{" "}
                    {p.gold.length ? p.gold.map((g) => <span key={g} className="mono" style={{ marginRight: 8 }}>chunk {chunkNo(g)}</span>)
                      : <span style={{ color: "var(--negative)" }}>ไม่มี chunk ไหนครอบ evidence ได้ครึ่งหนึ่ง (chunk เล็กเกินไป?)</span>}
                  </div>
                )}
                {q.evidence.map((ev, i) => (
                  <div key={i} className="small">
                    <div className="muted">Evidence · {run.doc_names[ev.doc_id]}</div>
                    <span className="evidence">{snippet(ev)}</span>
                  </div>
                ))}
                <div className="hits">
                  {p.retrieved.slice(0, 5).map((c, i) => (
                    <div key={i} className={"hit-row" + (p.hit_rank === i + 1 ? " is-hit" : "")}>
                      <span className="mono muted">#{i + 1}</span>
                      <span>{c.chunk && <span className="mono muted" style={{ marginRight: 8 }}>chunk {chunkNo(c.chunk)}{p.gold?.includes(c.chunk) ? " · มีคำตอบ" : ""}</span>}{snippet(c)}</span>
                      <span className="num muted">{c.score.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
                {p.answer && (
                  <div className="small">
                    <div className="muted">คำตอบของ {run.spec.generation?.model ?? "LLM"}</div>
                    <div>{p.answer}</div>
                    {p.judge && <div className="muted" style={{ marginTop: 4 }}>{p.judge.reason}{p.judge.grounded ? "" : " · มีส่วนที่ไม่ได้อิงจากเอกสาร"}</div>}
                  </div>
                )}
                {p.gen_error && <div className="notice error">{p.gen_error}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
