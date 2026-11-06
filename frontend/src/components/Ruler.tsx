/* The rank ruler, Bantat's one signature detail: graduated ticks for ranks 1..k with the
   rank where the evidence was found marked like a reading on a scale. */

export function RankRuler({ rank, k }: { rank: number | null; k: number }) {
  return (
    <span className={"ruler" + (rank ? "" : " miss")} title={rank ? `เจอที่อันดับ ${rank}` : `ไม่เจอใน ${k} อันดับแรก`}>
      {Array.from({ length: k }, (_, i) => (
        <i key={i} className={rank === i + 1 ? "hit" : ""} />
      ))}
    </span>
  );
}

/** Where the evidence landed across all questions: one bar per rank, then misses. */
export function RankDistribution({ ranks, k }: { ranks: (number | null)[]; k: number }) {
  const counts = Array.from({ length: k + 1 }, () => 0);
  ranks.forEach((r) => (counts[r ? r - 1 : k] += 1));
  const max = Math.max(...counts, 1);
  return (
    <span className="dist" aria-label={`อันดับที่เจอ: ${counts.slice(0, k).join(", ")}; ไม่เจอ ${counts[k]}`}>
      {counts.map((n, i) => (
        <i key={i} className={i === 0 ? "first" : i === k ? "missed" : ""} style={{ height: `${(n / max) * 100}%` }}
           title={i === k ? `ไม่เจอ ${n} ข้อ` : `อันดับ ${i + 1}: ${n} ข้อ`} />
      ))}
    </span>
  );
}
