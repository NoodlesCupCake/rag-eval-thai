/* Loading placeholders shaped like the content they stand in for, so the page does not
   jump when data arrives. One soft sweep of light; static under reduced motion. */

export const Sk = ({ w = "100%", h = 12, r = 6, style }: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }) => (
  <span className="sk" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />
);

export function SkRows({ rows = 5, cols = [40, 25, 15] }: { rows?: number; cols?: number[] }) {
  return (
    <div aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row">
          {cols.map((c, j) => <Sk key={j} w={`${c - (i % 3) * 3}%`} h={j === 0 ? 14 : 10} />)}
        </div>
      ))}
    </div>
  );
}

function Head() {
  return (
    <div className="page-head" aria-hidden="true">
      <div style={{ flex: 1 }}>
        <Sk w={240} h={30} r={8} />
        <Sk w="min(520px, 80%)" h={12} style={{ marginTop: 12 }} />
      </div>
    </div>
  );
}

export function PageSkeleton({ variant }: { variant: "results" | "map" | "list" | "table" | "form" | "grid" }) {
  return (
    <div className="stack sk-page" aria-busy="true" aria-label="กำลังโหลด">
      <Head />
      {variant === "results" && (
        <>
          <div className="card card-pad stack-16">
            <Sk w={320} h={36} r={8} />
            <Sk w="60%" h={10} />
            {[78, 14, 10].map((w, i) => (
              <div key={i} className="row" style={{ gap: 16 }}><Sk w={64} h={12} /><Sk w={`${w}%`} h={10} r={5} /></div>
            ))}
          </div>
          <div className="stats">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card stat stack-8"><Sk w="40%" h={10} /><Sk w="55%" h={28} r={6} /><Sk w="70%" h={8} /></div>)}
          </div>
          <div className="card card-pad"><Sk h={260} r={10} /></div>
        </>
      )}
      {variant === "map" && (
        <>
          <div className="card card-pad"><Sk h={20} /></div>
          <div className="idx-layout">
            <div className="card card-pad"><Sk h={480} r={12} /></div>
            <div className="card card-pad stack-16"><Sk w="60%" h={14} /><Sk h={10} /><Sk w="80%" h={10} /><Sk h={64} r={10} /><Sk h={64} r={10} /></div>
          </div>
        </>
      )}
      {variant === "list" && <div className="card"><SkRows rows={6} cols={[45, 20]} /></div>}
      {variant === "table" && <div className="card"><SkRows rows={7} cols={[34, 16, 12, 12]} /></div>}
      {variant === "grid" && (
        <div className="card idx-grid">
          {[0, 1, 2].map((i) => <div key={i} className="idx-card stack-8"><Sk w={18} h={18} r={4} /><Sk w="70%" h={16} /><Sk w="40%" h={10} /><Sk h={30} r={6} /></div>)}
        </div>
      )}
      {variant === "form" && (
        <div className="card card-pad stack-16" style={{ maxWidth: 760 }}>
          {[0, 1, 2].map((i) => <div key={i} className="stack-8"><Sk w={120} h={10} /><Sk h={36} r={8} /></div>)}
          <Sk w={160} h={36} r={8} />
        </div>
      )}
    </div>
  );
}
