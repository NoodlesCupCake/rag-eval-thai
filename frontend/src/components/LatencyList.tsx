import type { Result } from "../types";
import { ms } from "../format";
import { CfgLabel } from "./ui";

/* Retrieval latency as a ranked list with thin range bars (p50 to p95) on one shared
   scale, fastest first. Smaller and different in kind from the main chart on purpose. */

export function LatencyList({ results, lead, focus, onFocus }: { results: Result[]; lead: number; focus: number | null; onFocus: (i: number) => void }) {
  const max = Math.max(...results.map((r) => r.metrics.latency_p95_ms ?? 0)) || 1;
  const rows = results.map((r, i) => ({ r, i })).sort((a, b) => (a.r.metrics.latency_p95_ms ?? 0) - (b.r.metrics.latency_p95_ms ?? 0));
  return (
    <div className="lat-list">
      {rows.map(({ r, i }) => {
        const p50 = r.metrics.latency_p50_ms ?? 0, p95 = r.metrics.latency_p95_ms ?? 0;
        return (
          <div key={i} className={"lat-row clickable" + (i === lead ? " lead" : "")} onClick={() => onFocus(i)}
               title={`p50 ${ms(p50)} · p95 ${ms(p95)} · p99 ${ms(r.metrics.latency_p99_ms)}`}
               style={i === focus && i !== lead ? { background: "var(--raised)" } : undefined}>
            <span className="ellipsis small"><CfgLabel label={r.label} /></span>
            <span className="num small" style={{ color: "var(--text)" }}>{ms(p95)}</span>
            <div className="bar">
              <div className="track" />
              <div className="range" style={{ left: `${(p50 / max) * 100}%`, width: `max(4px, ${((p95 - p50) / max) * 100}%)` }} />
              <div className="p50" style={{ left: `${(p50 / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
