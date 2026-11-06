import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Background, Controls, Handle, Position, ReactFlow,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, errorText } from "../api";
import type { ChunkCfg, ChunkPreview, ChunkView, Doc, QA } from "../types";
import { ErrorNote } from "./ui";

/* Document → chunk → question, in three columns. Every node has a fixed height and the
   layout is computed row by row, so nothing overlaps: each chunk reserves one row per
   question placed beside it. A question whose evidence spans two chunks (overlap) is
   placed once, next to its first chunk, with an edge from each. */

const X = { doc: 0, chunk: 300, question: 700 };
const ROW = 72;          // one question row
const CHUNK_GAP = 16;    // between chunk blocks
const DOC_GAP = 48;      // between documents

type DocData = { name: string; chunks: number; questions: number };
type ChunkData = { number: number; text: string; chars: number; cut: boolean; questions: number; href: string };
type QuestionData = { question: string; answer: string; active: boolean };

function DocNode({ data }: NodeProps<Node<DocData>>) {
  return (
    <div className="fl-node fl-doc">
      <div className="ellipsis" title={data.name}>{data.name}</div>
      <div className="meta">{data.chunks} chunks · {data.questions} คำถาม</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ChunkNode({ data }: NodeProps<Node<ChunkData>>) {
  const navigate = useNavigate();
  return (
    <div className={"fl-node fl-chunk" + (data.questions ? "" : " empty") + (data.cut ? " cut" : "")}
         onDoubleClick={() => navigate(data.href)} title="ดับเบิลคลิกเพื่อดูในเอกสาร">
      <Handle type="target" position={Position.Left} />
      <div className="fl-chunk-head">
        <span className="mono">chunk {data.number}</span>
        <span className="meta">{data.chars} ตัวอักษร{data.cut ? " · ตัดกลางคำ" : ""}</span>
      </div>
      <div className="fl-snippet">{data.text}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function QuestionNode({ data }: NodeProps<Node<QuestionData>>) {
  return (
    <div className={"fl-node fl-question" + (data.active ? " active" : "")} title={data.answer}>
      <Handle type="target" position={Position.Left} />
      <div className="fl-q">{data.question}</div>
    </div>
  );
}

const nodeTypes: NodeTypes = { doc: DocNode, chunk: ChunkNode, question: QuestionNode };

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

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const byChunk = new Map<string, QA[]>();
    items.forEach((q) => q.chunks?.forEach((c) => byChunk.set(c.id, [...(byChunk.get(c.id) ?? []), q])));
    const placed = new Set<string>();
    const query = `strategy=${cfg.strategy}&size=${cfg.size}&overlap=${cfg.overlap}`;
    let y = 0;

    for (const d of docs) {
      const list = (chunks[d.id] ?? []).filter((c) => showEmpty || byChunk.has(c.id));
      if (!list.length) continue;
      const docQs = new Set(list.flatMap((c) => (byChunk.get(c.id) ?? []).map((q) => q.id)));
      nodes.push({ id: d.id, type: "doc", position: { x: X.doc, y }, data: { name: d.name, chunks: (chunks[d.id] ?? []).length, questions: docQs.size } });

      for (const c of list) {
        const qs = byChunk.get(c.id) ?? [];
        const here = qs.filter((q) => !placed.has(q.id));
        const number = Number(c.id.slice(c.id.lastIndexOf(":") + 1)) + 1;
        nodes.push({
          id: c.id, type: "chunk", position: { x: X.chunk, y },
          data: { number, text: c.text.slice(0, 120), chars: c.end - c.start, cut: c.cut_start || c.cut_end, questions: qs.length,
                  href: `/documents/${d.id}?${query}&chunk=${number}` },
        });
        edges.push({ id: `${d.id}->${c.id}`, source: d.id, target: c.id, type: "smoothstep", className: "fl-edge-doc" });
        here.forEach((q, j) => {
          placed.add(q.id);
          nodes.push({ id: q.id, type: "question", position: { x: X.question, y: y + j * ROW }, data: { question: q.question, answer: q.answer, active: q.id === active } });
        });
        qs.forEach((q) => edges.push({
          id: `${c.id}->${q.id}`, source: c.id, target: q.id, type: "smoothstep",
          className: q.id === active ? "fl-edge-active" : "fl-edge", zIndex: q.id === active ? 1 : 0,
        }));
        y += Math.max(1, here.length) * ROW + CHUNK_GAP;
      }
      y += DOC_GAP;
    }
    return { nodes, edges };
  }, [docs, chunks, items, showEmpty, active, cfg]);

  const unmapped = items.filter((q) => !q.chunks?.length).length;

  return (
    <div>
      <div className="row small sec" style={{ padding: "12px 24px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 16 }}>
        <label className="check"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />แสดง chunk ที่ไม่มีคำถาม</label>
        <span className="muted">คลิกคำถามเพื่อไฮไลต์ · ดับเบิลคลิก chunk เพื่อดูในเอกสาร</span>
        {unmapped > 0 && <span style={{ color: "var(--negative)" }}>{unmapped} คำถามไม่มี chunk ไหนครอบ evidence ได้ครึ่งหนึ่ง</span>}
      </div>
      <ErrorNote error={error} />
      <div className="flow">
        {/* remount per config so the view fits the new layout */}
        <ReactFlow key={`${cfg.strategy}-${cfg.size}-${cfg.overlap}-${showEmpty}-${Object.keys(chunks).length}`}
                   nodes={nodes} edges={edges} nodeTypes={nodeTypes}
                   // open readable at the top-left; the wheel scrolls like a page, ctrl+wheel or the buttons zoom
                   defaultViewport={{ x: 24, y: 24, zoom: 0.9 }} panOnScroll zoomOnScroll={false} zoomActivationKeyCode="Control"
                   minZoom={0.2} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false}
                   onNodeClick={(_, n) => n.type === "question" && setActive(active === n.id ? null : n.id)}
                   onPaneClick={() => setActive(null)}>
          <Background gap={24} size={1} color="var(--line-strong)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
