import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY } from "../glossary";

/* A word with a dotted underline that explains itself on hover or keyboard focus.
   The card is portalled to <body> with fixed positioning so table scroll areas can't clip it. */
export function Term({ k, children }: { k: string; children: ReactNode }) {
  const entry = GLOSSARY[k];
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  if (!entry) return <>{children}</>;

  const show = () => {
    const r = ref.current!.getBoundingClientRect();
    const above = r.bottom + 180 > innerHeight;
    const x = Math.min(Math.max(12, r.left + r.width / 2 - 160), innerWidth - 332);
    setPos({ x, y: above ? r.top - 8 : r.bottom + 8, above });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span ref={ref} className="term" tabIndex={0} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
            aria-describedby={pos ? `term-${k}` : undefined}>
        {children}
      </span>
      {pos && createPortal(
        <div id={`term-${k}`} role="tooltip" className="term-card"
             style={{ left: pos.x, top: pos.y, transform: pos.above ? "translateY(-100%)" : undefined }}>
          <div className="term-title">
            <span>{entry.title}</span>
            {entry.better && <span className="meta">{entry.better}</span>}
          </div>
          <div>{entry.body}</div>
          {entry.example && <div className="term-example">{entry.example}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
