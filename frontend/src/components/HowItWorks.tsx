/* How the measurement works, drawn: a document is cut into chunks, a question is asked,
   the chunks come back ranked, and we read off where the right one landed. */
export function HowItWorks() {
  const slips = [0, 1, 2, 3];
  const ranked = [
    { n: 2, w: 118 }, { n: 4, w: 96, hit: true }, { n: 1, w: 106 }, { n: 3, w: 84 },
  ];
  return (
    <svg className="how" viewBox="0 0 800 220" role="img"
         aria-label="A document is split into chunks; a question retrieves a ranked list; the right chunk is found at rank 2">
      {/* document */}
      <rect className="paper" x="16" y="28" width="120" height="156" rx="8" />
      {[48, 60, 72, 92, 104, 116, 136, 148, 160].map((y, i) => (
        <rect key={y} className="ink" x="30" y={y} width={i % 3 === 2 ? 60 : 92} height="5" rx="2.5" />
      ))}
      <text className="cap" x="76" y="206" textAnchor="middle">1 · เอกสาร</text>

      <path className="flow" d="M144 106 H184" />

      {/* chunks */}
      {slips.map((i) => (
        <g key={i}>
          <rect className={"slip" + (i === 3 ? " hit" : "")} x="192" y={30 + i * 38} width="126" height="30" rx="6" />
          <text className={"num" + (i === 3 ? " hit" : "")} x="204" y={49 + i * 38}>chunk {i + 1}</text>
          <rect className="ink" x="262" y={42 + i * 38} width="44" height="5" rx="2.5" />
        </g>
      ))}
      <text className="cap" x="255" y="206" textAnchor="middle">2 · ตัดเป็น chunk</text>

      <path className="flow" d="M326 106 H366" />

      {/* question */}
      <rect className="q" x="374" y="86" width="132" height="40" rx="20" />
      <text className="qtext" x="440" y="110" textAnchor="middle">ลาป่วยกี่วันต้องมีใบหมอ</text>
      <text className="cap" x="440" y="206" textAnchor="middle">3 · ถามคำถาม</text>

      <path className="flow" d="M514 106 H554" />

      {/* ranked results */}
      {ranked.map((r, i) => (
        <g key={i}>
          <text className={"num" + (r.hit ? " hit" : "")} x="566" y={51 + i * 38}>#{i + 1}</text>
          <rect className={"bar" + (r.hit ? " hit" : "")} x="590" y={36 + i * 38} width={r.w} height="22" rx="5" />
          <text className={"num" + (r.hit ? " hit" : "")} x={598} y={51 + i * 38}>chunk {r.n}</text>
        </g>
      ))}
      <text className="num hit" x="716" y="89">← เจอที่อันดับ 2</text>
      <text className="cap" x="650" y="206" textAnchor="middle">4 · ดูว่าอยู่อันดับไหน</text>
    </svg>
  );
}
