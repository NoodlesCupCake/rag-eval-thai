/* Uncertainty for small question sets: 95% intervals and a paired bootstrap that says
   whether two configs really differ on the same questions. */

import type { PerQuestion } from "./types";

/** Half-width of the 95% Wilson interval for a proportion, in the same units as p. */
export function propCI(p: number, n: number): number {
  if (!n) return 0;
  const z = 1.96, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return Math.max(centre + half - p, p - (centre - half));
}

/** Half-width of a 95% normal interval for a mean. */
export function meanCI(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return (1.96 * sd) / Math.sqrt(n);
}

export const rr = (q: PerQuestion) => (q.hit_rank ? 1 / q.hit_rank : 0);

/** Paired bootstrap of mean(a - b) over the same questions. clear = the 95% interval
 *  excludes zero, i.e. the difference is unlikely to be chance. Seeded, so stable. */
export function pairedDiff(a: number[], b: number[], iters = 2000): { diff: number; lo: number; hi: number; clear: boolean } {
  const n = Math.min(a.length, b.length);
  const d = Array.from({ length: n }, (_, i) => a[i] - b[i]);
  const mean = d.reduce((x, y) => x + y, 0) / (n || 1);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const means: number[] = [];
  for (let t = 0; t < iters; t++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[Math.floor(rand() * n)];
    means.push(s / (n || 1));
  }
  means.sort((x, y) => x - y);
  const lo = means[Math.floor(iters * 0.025)], hi = means[Math.floor(iters * 0.975)];
  return { diff: mean, lo, hi, clear: lo > 0 || hi < 0 };
}

/** Per-question values of two results aligned on the questions they share. */
export function aligned(a: PerQuestion[], b: PerQuestion[], f: (q: PerQuestion) => number) {
  const mb = new Map(b.map((q) => [q.qa_id, q]));
  const xs: number[] = [], ys: number[] = [];
  a.forEach((q) => { const o = mb.get(q.qa_id); if (o) { xs.push(f(q)); ys.push(f(o)); } });
  return [xs, ys] as const;
}
