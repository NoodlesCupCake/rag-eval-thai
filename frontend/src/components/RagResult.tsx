import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api } from "../api";
import type { DocFull, PerQuestion, Run, Span } from "../types";
import { chunkNo } from "../format";
import { CfgLabel, Empty } from "./ui";
import { RankRuler } from "./Ruler";

/* Result of a RAG evaluation: how often the answer was right, how often it stuck to the
   documents, and for every answer that was not right, whether retrieval or the LLM was
   the cause. */

type Cause = "correct" | "retrieval" | "llm" | "error";
const CAUSE: Record<Exclude<Cause, "correct">, { label: string; hint: string }> = {
  retrieval: { label: "retrieval พลาด", hint: "chunk ที่มีคำตอบไม่อยู่ใน top k ที่ส่งให้ LLM แก้ที่ embedding, การตัด chunk หรือเพิ่ม k" },
  llm: { label: "LLM ตอบพลาด", hint: "ส่ง chunk ที่มีคำตอบไปแล้ว แต่ LLM ยังตอบไม่ถูก แก้ที่ prompt หรือเปลี่ยนโมเดล" },
  error: { label: "เรียก LLM ไม่สำเร็จ", hint: "ดูข้อความผิดพลาดในแต่ละข้อ" },
};

export function causeOf(p: PerQuestion, topK: number): Cause {
  if (p.gen_error || !p.judge) return "error";
  if (p.judge.verdict === "correct") return "correct";
  return p.hit_rank && p.hit_rank <= topK ? "llm" : "retrieval";
}

export function RagResult({ run }: { run: Run }) {
  const r = run.results[0];
  const topK = run.spec.generation?.top_k ?? 3;
  const [filter, setFilter] = useState<"wrong" | "all" | Cause>("wrong");
  const [open, setOpen] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string | null>>({});
  useEffect(() => {
    Promise.all(Object.keys(run.doc_names).map((d) => api.get<DocFull>("/documents/" + d).then((x) => [d, x.text] as const).catch(() => [d, null] as const)))
      .then((p) => setTexts(Object.fromEntries(p)));
  }, [run.id]);
  if (!r) return <div className="card"><Empty title="ยังไม่มีผล" /></div>;

  const pq = r.per_question;
  const n = pq.length || 1;
  const judged = pq.filter((p) => p.judge);
  const count = (v: string) => judged.filter((p) => p.judge!.verdict === v).length;
  const score = r.metrics.answer_correctness ?? 0;
  const grounded = r.metrics.faithfulness ?? 0;
  const causes = { retrieval: 0, llm: 0, error: 0 } as Record<Exclude<Cause, "correct">, number>;
  pq.forEach((p) => { const c = causeOf(p, topK); if (c !== "correct") causes[c]++; });
  const wrong = causes.retrieval + causes.llm + causes.error;
  const pct = (x: number) => `${Math.round((x / n) * 100)}%`;
  const snippet = (s: Span) => texts[s.doc_id]?.slice(s.start, s.end) ?? "…";

  const rows = pq.filter((p) => {
    const c = causeOf(p, topK);
    return filter === "all" ? true : filter === "wrong" ? c !== "correct" : c === filter;
  });

  return (
    <>
      <div className="card rank-card">
        <div className="rank-head">
          <div className="rank-lede">
            <span className="big">{Math.round(score * 100)}%</span>
            <span>คะแนนความถูกต้องของคำตอบ <span className="small muted">ถูก = 1 · ถูกบางส่วน = 0.5</span></span>
          </div>
          <div className="small sec">
            ถูก {count("correct")} · ถูกบางส่วน {count("partial")} · ผิด {count("incorrect")} จาก {judged.length} ข้อ
            {" · "}อิงเอกสาร {Math.round(grounded * 100)}%
            {" · "}<CfgLabel label={r.label} /> · ส่ง top {topK}
          </div>
          <div className="meta">ตอบด้วย {run.spec.generation?.model} · ตรวจด้วย {run.spec.generation?.judge_model ?? run.spec.generation?.model}</div>
        </div>

        <div className="small sec" style={{ margin: "8px 0 4px" }}>{wrong ? `ข้อที่ไม่ถูกเต็ม ${wrong} ข้อ เกิดจาก` : "ทุกข้อตอบถูก"}</div>
        <div className="rank-rows">
          {(Object.keys(CAUSE) as (keyof typeof CAUSE)[]).filter((c) => causes[c] || c !== "error").map((c) => (
            <button key={c} className={"rank-row" + (c === "retrieval" ? " miss" : "")} onClick={() => setFilter(c)} disabled={!causes[c]} title={CAUSE[c].hint}>
              <ChevronRight className="icon chev" />
              <span className="rank-label" style={{ whiteSpace: "nowrap" }}>{CAUSE[c].label}</span>
              <span className="rank-bar"><span style={{ width: `${(causes[c] / Math.max(wrong, 1)) * 100}%`, background: c === "llm" ? "var(--text-2)" : undefined }} /></span>
              <span className="rank-n">{causes[c]} ข้อ</span>
              <span className="rank-cum">{pct(causes[c])}</span>
            </button>
          ))}
        </div>
        <div className="small muted" style={{ padding: "8px 8px 4px" }}>
          retrieval พลาด แก้ที่ <b>ประเมิน Embedding</b> · LLM ตอบพลาด แก้ที่ prompt หรือโมเดล
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>รายข้อ</h2>
          <div className="seg">
            {([["wrong", "ไม่ถูกเต็ม"], ["retrieval", "retrieval พลาด"], ["llm", "LLM พลาด"], ["all", "ทั้งหมด"]] as const).map(([k, l]) => (
              <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        {!rows.length && <Empty title="ไม่มีข้อที่ตรงเงื่อนไข" />}
        {rows.map((p) => {
          const q = run.questions?.[p.qa_id];
          const c = causeOf(p, topK);
          const isOpen = open === p.qa_id;
          return (
            <div key={p.qa_id} style={{ borderBottom: "1px solid var(--line)" }}>
              <div className="q-row clickable" onClick={() => setOpen(isOpen ? null : p.qa_id)}>
                <span style={{ color: "var(--text)" }}>{q?.question ?? p.qa_id}</span>
                <RankRuler rank={p.hit_rank} k={run.spec.k_max} />
                <span className="num small" style={{ color: p.hit_rank && p.hit_rank <= topK ? "var(--text)" : "var(--negative)" }}>{p.hit_rank ? `#${p.hit_rank}` : "ไม่เจอ"}</span>
                <span className={"verdict " + (p.judge?.verdict ?? "")}>{p.judge?.verdict ?? "error"}</span>
              </div>
              {isOpen && (
                <div className="q-detail">
                  {c !== "correct" && <div className="notice small"><b>{CAUSE[c].label}</b> · {CAUSE[c].hint}</div>}
                  <div className="form-grid">
                    <div className="small"><div className="muted">คำตอบอ้างอิง</div><div style={{ color: "var(--text)" }}>{q?.answer}</div></div>
                    <div className="small"><div className="muted">คำตอบของ LLM</div><div style={{ color: "var(--text)", whiteSpace: "pre-wrap" }}>{p.answer ?? p.gen_error}</div></div>
                  </div>
                  {p.judge && <div className="small"><span className="muted">ผู้ตรวจ</span> {p.judge.reason}{p.judge.grounded ? "" : " · มีส่วนที่ไม่ได้อิงจากเอกสาร"}</div>}
                  <div className="small muted">chunk ที่ส่งให้ LLM ({topK})</div>
                  <div className="hits">
                    {p.retrieved.slice(0, topK).map((ch, i) => (
                      <div key={i} className={"hit-row" + (p.hit_rank === i + 1 ? " is-hit" : "")}>
                        <span className="mono muted">#{i + 1}</span>
                        <span>{ch.chunk && <span className="mono muted" style={{ marginRight: 8 }}>chunk {chunkNo(ch.chunk)}{p.gold?.includes(ch.chunk) ? " · มีคำตอบ" : ""}</span>}{snippet(ch)}</span>
                        <span className="num muted">{ch.score.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
