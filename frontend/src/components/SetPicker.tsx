import { useState, type FormEvent } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { Busy, useAction } from "../feedback";
import type { QASet } from "../types";

/* The QA sets as tabs: pick one, make a new one (empty or a copy of the current one),
   rename it or delete it. Everything else on the QA page works on the picked set. */

type Mode = null | "new" | "copy" | "rename";

export function SetPicker({ sets, current, onChoose, onChanged }: {
  sets: QASet[];
  current: string;
  onChoose: (id: string) => void;
  onChanged: (selectId?: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState("");
  const { run, busy } = useAction();
  const cur = sets.find((s) => s.id === current);

  function open(m: Mode) {
    setMode(m);
    setName(m === "rename" ? cur?.name ?? "" : m === "copy" ? `${cur?.name ?? ""} (สำเนา)` : "");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (mode === "rename") {
      const r = await run("save", () => api.patch<QASet>(`/qa-sets/${current}`, { name }), "เปลี่ยนชื่อแล้ว");
      if (r) { setMode(null); onChanged(); }
    } else {
      const path = mode === "copy" ? `/qa-sets?copy_from=${current}` : "/qa-sets";
      const r = await run("save", () => api.post<QASet>(path, { name }), (s) => `สร้างชุด “${s.name}” แล้ว`);
      if (r) { setMode(null); onChanged(r.id); }
    }
  }

  async function remove() {
    if (!cur || !confirm(`ลบชุด “${cur.name}” และคำถามทั้ง ${cur.count} ข้อในชุดนี้? ผลการรันเดิมยังอยู่`)) return;
    const r = await run("del", () => api.del(`/qa-sets/${current}`), "ลบชุดคำถามแล้ว");
    if (r) onChanged(sets.find((s) => s.id !== current)?.id);
  }

  return (
    <div className="card set-picker">
      <div className="set-tabs" role="tablist" aria-label="ชุดคำถาม">
        {sets.map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === current} className={"set-tab" + (s.id === current ? " on" : "")} onClick={() => onChoose(s.id)}>
            <span>{s.name}</span>
            <span className="meta">{s.count}</span>
          </button>
        ))}
        <button className="set-tab add" onClick={() => open("new")}><Plus className="icon" />ชุดใหม่</button>
      </div>
      <div className="set-actions">
        {mode ? (
          <form className="row" onSubmit={submit} style={{ flexWrap: "wrap" }}>
            <span className="small sec">{mode === "rename" ? "ชื่อใหม่" : mode === "copy" ? `ทำสำเนาจาก “${cur?.name}”` : "ชุดใหม่ (ว่าง)"}</span>
            <input className="input" style={{ width: 240, height: 32 }} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อชุด" maxLength={80} />
            <button className="btn primary sm" type="submit" disabled={busy("save") || !name.trim()}><Busy busy={busy("save")}>{mode === "rename" ? "บันทึก" : "สร้าง"}</Busy></button>
            <button className="btn ghost sm" type="button" onClick={() => setMode(null)}>ยกเลิก</button>
          </form>
        ) : (
          <>
            <span className="small muted">ใช้อยู่: <b style={{ color: "var(--text)", fontWeight: 500 }}>{cur?.name}</b> · นำเข้า ส่งออก และสร้างด้วย LLM จะทำกับชุดนี้</span>
            <span className="grow" />
            <button className="btn ghost sm" onClick={() => open("copy")} disabled={!cur}><Copy className="icon" />ทำสำเนา</button>
            <button className="btn ghost sm" onClick={() => open("rename")} disabled={!cur}><Pencil className="icon" />เปลี่ยนชื่อ</button>
            <button className="btn ghost sm" onClick={remove} disabled={!cur || sets.length < 2 || busy("del")}
                    title={sets.length < 2 ? "ต้องเหลืออย่างน้อย 1 ชุด" : undefined}><Trash2 className="icon" />ลบชุด</button>
          </>
        )}
      </div>
    </div>
  );
}
