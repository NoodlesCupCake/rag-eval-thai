import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, errorText } from "../api";
import type { Run } from "../types";
import { date } from "../format";
import { Empty, ErrorNote, PageHead } from "../components/ui";
import { ResultsView } from "../components/ResultsView";
import { Questions } from "./Questions";
import { RagResult } from "../components/RagResult";

export function RunDetailPage() {
  const { id = "" } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

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

  const results = useMemo(() => run?.results ?? [], [run]);
  if (error) return <ErrorNote error={error} />;
  if (!run) return <div className="muted">กำลังโหลด</div>;

  const lead = results.reduce((bi, r, i) => ((r.metrics.mrr ?? 0) > (results[bi].metrics.mrr ?? 0) ? i : bi), 0);
  const total = run.spec.chunkings.length * run.spec.retrievers.length;

  return (
    <div className="stack">
      <PageHead back={{ to: "/runs", label: "ผลลัพธ์ทั้งหมด" }} title={<>{run.name} <span className={"kind-badge " + (run.kind ?? "retrieval")}>{run.kind === "rag" ? "RAG" : "Embedding"}</span></>}
                sub={<span className="mono small">{date(run.created_at)} · {run.qa_set ? `${run.qa_set.name} · ` : ""}{run.n_questions} คำถาม · {results.length}/{total} configs{run.status === "running" ? " · กำลังรัน" : ""}</span>} />
      {run.error && <ErrorNote error={"รันไม่สำเร็จ: " + run.error} />}
      {results.length === 0 ? (
        <div className="card">
          <Empty title={run.status === "running" ? "กำลังรัน config แรก" : "ไม่มีผลลัพธ์"}>
            <p>ครั้งแรกอาจช้าเพราะต้องดาวน์โหลด embedding model</p>
          </Empty>
        </div>
      ) : (
        run.kind === "rag" ? <RagResult run={run} /> : <>
          <ResultsView results={results} kMax={run.spec.k_max} focus={focus} setFocus={setFocus} questions={run.questions} runId={run.id} />
          <Questions run={run} result={results[focus ?? lead]} />
        </>
      )}
    </div>
  );
}
