import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Trash2 } from "lucide-react";
import { api } from "../api";
import { useStatus } from "../status";
import type { RunSummary, SummaryRow } from "../types";
import { date, pct } from "../format";
import { CfgLabel, Empty, PageHead } from "../components/ui";

const STATUS: Record<string, string> = { running: "กำลังรัน", done: "เสร็จ", failed: "ล้มเหลว" };

export function RunsPage() {
  const { refresh } = useStatus();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const load = () => api.get<RunSummary[]>("/runs").then(setRuns);
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!confirm("ลบผลการรันนี้?")) return;
    await api.del("/runs/" + id);
    load();
    refresh();
  }
  const best = (r: RunSummary): SummaryRow | null =>
    r.summary.reduce<SummaryRow | null>((a, b) => (!a || Number(b.mrr ?? 0) > Number(a.mrr ?? 0) ? b : a), null);

  return (
    <div className="stack">
      <PageHead title="ผลลัพธ์" sub={<>ทุกรอบเก็บเป็นไฟล์ JSON ใน <code>data/runs</code></>}>
        <Link className="btn primary" to="/bench"><Play className="icon" />รันใหม่</Link>
      </PageHead>
      <div className="card">
        {runs && runs.length === 0 && (
          <Empty title="ยังไม่มีผลลัพธ์"><p>ไปที่หน้า Benchmark เพื่อรันรอบแรก</p></Empty>
        )}
        {!!runs?.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>รอบ</th><th>สถานะ</th><th className="num">configs</th><th className="num">คำถาม</th>
                  <th>config ที่ดีที่สุด</th><th className="num">Hit@3</th><th className="num">MRR</th><th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const b = best(r);
                  return (
                    <tr key={r.id} className="clickable" onClick={() => navigate("/runs/" + r.id)}>
                      <td><div style={{ color: "var(--text)" }}>{r.name}</div><div className="meta">{date(r.created_at)}</div></td>
                      <td className="small">{STATUS[r.status] ?? r.status}</td>
                      <td className="num">{r.n_configs}</td>
                      <td className="num">{r.n_questions}</td>
                      <td>{b ? <CfgLabel label={b.label} /> : "–"}</td>
                      <td className="num strong">{b ? pct(Number(b["hit@3"])) : "–"}</td>
                      <td className="num">{b ? Number(b.mrr).toFixed(3) : "–"}</td>
                      <td className="num">
                        <button className="btn ghost sm icon-only" aria-label="ลบ" onClick={(e) => { e.stopPropagation(); remove(r.id); }}>
                          <Trash2 className="icon" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
