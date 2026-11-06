export const pct = (v: number | undefined | null, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);

export const ms = (v: number | undefined | null) => (v == null ? "–" : v < 10 ? `${v.toFixed(2)} ms` : `${v.toFixed(1)} ms`);

export const num = (v: number) => v.toLocaleString("th-TH");

export const date = (t: number) =>
  new Date(t * 1000).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Signed difference in percentage points, e.g. "+6.9 pt". */
export const pts = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pt`;
