import { Database } from "lucide-react";
import type { Result } from "../types";
import { Busy } from "../feedback";
import { useOpenIndex } from "../pages/Indexes";
import { CfgLabel } from "./ui";

/* From a result to the embedding store: open (or build) the index for this config. */
export function OpenInStore({ result }: { result: Result }) {
  const { open, busy } = useOpenIndex();
  if (result.retriever.type === "bm25" || !result.retriever.model) return null;
  return (
    <div className="card card-pad row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
      <div className="small sec">ดู embedding ของ <CfgLabel label={result.label} /> เป็นแผนที่ x, y และลองค้นในคลัง</div>
      <button className="btn" disabled={busy} onClick={() => open(result.chunking, result.retriever.model!)}>
        <Busy busy={busy} label="กำลังเปิด"><Database className="icon" />เปิดในคลัง Embedding</Busy>
      </button>
    </div>
  );
}
