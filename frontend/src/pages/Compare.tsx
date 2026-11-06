import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, errorText } from "../api";
import type { Run } from "../types";
import { Empty, ErrorNote, PageHead } from "../components/ui";
import { ResultsView, type Row } from "../components/ResultsView";

/* Several runs side by side: every config from every selected run in one table and one
   set of charts, with an optional baseline row that the others are measured against. */
export function ComparePage() {
  const [params] = useSearchParams();
  const ids = (params.get("runs") ?? "").split(",").filter(Boolean);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [baseline, setBaseline] = useState<number | null>(0);

  useEffect(() => {
    Promise.all(ids.map((id) => api.get<Run>("/runs/" + id))).then(setRuns).catch((e) => setError(errorText(e)));
  }, [params.get("runs")]);

  const rows: Row[] = useMemo(() => (runs ?? []).flatMap((r) => r.results.map((res) => ({ ...res, run: r.name }))), [runs]);
  const kMax = Math.min(...(runs ?? []).map((r) => r.spec.k_max), 10);
  const qCounts = new Set((runs ?? []).map((r) => r.n_questions));
  const setNames = [...new Set((runs ?? []).map((r) => r.qa_set?.name ?? "ไม่ระบุ"))];

  return (
    <div className="stack">
      <PageHead back={{ to: "/runs", label: "ผลลัพธ์ทั้งหมด" }} title="เปรียบเทียบ"
                sub={runs ? `${runs.length} รอบ · ${rows.length} configs · ${runs.map((r) => r.name).join(", ")}` : "กำลังโหลด"} />
      <ErrorNote error={error} />
      {setNames.length > 1 && (
        <div className="notice">รอบที่เลือกใช้ชุดคำถามต่างกัน ({setNames.join(", ")}) ตัวเลขวัดจากคำถามคนละชุด จึงเทียบกันตรง ๆ ไม่ได้</div>
      )}
      {setNames.length <= 1 && qCounts.size > 1 && (
        <div className="notice">รอบที่เลือกใช้จำนวนคำถามไม่เท่ากัน ({[...qCounts].join(", ")} ข้อ) ตัวเลขจึงเทียบกันได้แค่คร่าว ๆ ควรรันด้วยชุดคำถามเดียวกัน</div>
      )}
      {runs && !rows.length && <div className="card"><Empty title="รอบที่เลือกยังไม่มีผลลัพธ์" /></div>}
      {rows.length > 0 && (
        <ResultsView results={rows} kMax={kMax} focus={focus} setFocus={setFocus} baseline={baseline} setBaseline={setBaseline} />
      )}
    </div>
  );
}
