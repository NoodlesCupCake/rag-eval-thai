import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import type { ChunkCfg, ChunkPreview, ChunkView, Doc, QA } from "../types";
import { ErrorNote } from "./ui";

/* Which questions each chunk answers, laid out as a reading page: one section per
   document, the chunk on the left and its questions on the right, joined by a rule.
   Normal page flow, so nothing can overlap. A question whose evidence spans two chunks
   (overlap) appears under both, marked. */

export function ChunkMap({ cfg, docs, items }: { cfg: ChunkCfg; docs: Doc[]; items: QA[] }) {
  const [chunks, setChunks] = useState<Record<string, ChunkView[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    Promise.all(docs.map((d) => api.post<ChunkPreview>(`/documents/${d.id}/chunks`, cfg).then((r) => [d.id, r.chunks] as const)))
      .then((pairs) => setChunks(Object.fromEntries(pairs)))
      .catch((e) => setError(errorText(e)));
  }, [docs, cfg.strategy, cfg.size, cfg.overlap]);

  const byChunk = useMemo(() => {
    const m = new Map<string, QA[]>();
    items.forEach((q) => q.chunks?.forEach((c) => m.set(c.id, [...(m.get(c.id) ?? []), q])));
    return m;
  }, [items]);
  const spans = useMemo(() => new Map(items.map((q) => [q.id, q.chunks?.length ?? 0])), [items]);
  const unmapped = items.filter((q) => !q.chunks?.length);
  const query = `strategy=${cfg.strategy}&size=${cfg.size}&overlap=${cfg.overlap}`;

  return (
    <div>
      <div className="row small sec" style={{ padding: "12px 24px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 16 }}>
        <label className="check"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />แสดง chunk ที่ไม่มีคำถาม</label>
        <span className="muted">คลิกคำถามเพื่อดูว่าอยู่ใน chunk ไหนบ้าง · คลิกเลข chunk เพื่อเปิดในเอกสาร</span>
      </div>
      <ErrorNote error={error} />
      {unmapped.length > 0 && (
        <div className="notice" style={{ margin: "16px 24px 0" }}>
          {unmapped.length} คำถามไม่มี chunk ไหนครอบ evidence ได้ครึ่งหนึ่ง ลองเพิ่มขนาด chunk
        </div>
      )}
      <div className="cmap">
        {docs.map((d) => {
          const list = (chunks[d.id] ?? []).filter((c) => showEmpty || byChunk.has(c.id));
          if (!list.length) return null;
          const nq = new Set(list.flatMap((c) => (byChunk.get(c.id) ?? []).map((q) => q.id))).size;
          return (
            <section key={d.id} className="cmap-doc">
              <header>
                <h3>{d.name}</h3>
                <span className="meta">{(chunks[d.id] ?? []).length} chunks · {nq} คำถาม</span>
              </header>
              {list.map((c) => {
                const qs = byChunk.get(c.id) ?? [];
                const n = Number(c.id.slice(c.id.lastIndexOf(":") + 1)) + 1;
                const lit = active != null && qs.some((q) => q.id === active);
                return (
                  <div key={c.id} className={"cmap-row" + (qs.length ? "" : " empty") + (lit ? " lit" : active ? " dim" : "")}>
                    <div className={"cmap-chunk" + (c.cut_start || c.cut_end ? " cut" : "")}>
                      <div className="cmap-chunk-head">
                        <Link to={`/documents/${d.id}?${query}&chunk=${n}`} className="mono">chunk {n}</Link>
                        <span className="meta">{c.end - c.start} ตัวอักษร{c.cut_start || c.cut_end ? " · ตัดกลางคำ" : ""}</span>
                      </div>
                      <p>{c.text}</p>
                    </div>
                    <div className="cmap-link" aria-hidden="true" />
                    <div className="cmap-qs">
                      {qs.length === 0 && <span className="small muted">ไม่มีคำถามที่ตอบจาก chunk นี้</span>}
                      {qs.map((q) => (
                        <button key={q.id} className={"cmap-q" + (active === q.id ? " on" : "")} onClick={() => setActive(active === q.id ? null : q.id)}>
                          <span>{q.question}</span>
                          {(spans.get(q.id) ?? 0) > 1 && <em className="meta">อยู่ใน {spans.get(q.id)} chunk</em>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
