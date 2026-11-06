/* Hand-drawn SVG charts. One accent for the leading config, the focused config in
   primary ink, everything else quiet. The config table on the page is the legend. */
(function () {
  const { useState, useRef } = React;
  const html = htm.bind(React.createElement);

  const pct = (v) => (v == null ? "–" : (v * 100).toFixed(1) + "%");
  const ms = (v) => (v == null ? "–" : v < 10 ? v.toFixed(2) + " ms" : v.toFixed(1) + " ms");

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function strokeFor(i, lead, focus) {
    if (i === focus && i !== lead) return { stroke: "var(--text)", width: 2, op: 1 };
    if (i === lead) return { stroke: "var(--accent)", width: 2.5, op: 1 };
    return { stroke: "var(--series-quiet)", width: 1.5, op: focus == null ? 0.9 : 0.55 };
  }

  /* Hit@k curve: share of questions whose evidence is in the top k, for k = 1..kMax */
  function HitCurve({ results, kMax, lead, focus, onFocus }) {
    const W = 720, H = 320, m = { l: 48, r: 20, t: 16, b: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const [hoverK, setHoverK] = useState(null);
    const ref = useRef(null);
    const ks = Array.from({ length: kMax }, (_, i) => i + 1);
    const x = (k) => m.l + (kMax === 1 ? iw / 2 : ((k - 1) / (kMax - 1)) * iw);
    const y = (v) => m.t + (1 - v) * ih;

    const order = results.map((_, i) => i).filter((i) => i !== lead && i !== focus);
    if (focus != null && focus !== lead) order.push(focus);
    if (lead != null) order.push(lead);

    function move(e) {
      const r = ref.current.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const k = Math.round(((px - m.l) / iw) * (kMax - 1)) + 1;
      setHoverK(Math.max(1, Math.min(kMax, k)));
    }

    let tip = null;
    if (hoverK) {
      const rows = results.map((r, i) => ({ i, label: r.label, v: r.metrics["hit@" + hoverK] }))
        .sort((a, b) => b.v - a.v);
      const shown = rows.slice(0, 6);
      if (focus != null && !shown.find((r) => r.i === focus)) shown.push(rows.find((r) => r.i === focus));
      const left = (x(hoverK) / W) * 100;
      tip = html`<div class="tip" style=${{ left: left > 60 ? `calc(${left}% - 200px)` : `calc(${left}% + 12px)`, top: "12px" }}>
        <div class="t">Hit@${hoverK}</div>
        ${shown.map((r) => html`<div class="r" key=${r.i}>
          <span class=${r.i === lead ? "best" : ""}>${r.label}</span><b>${pct(r.v)}</b></div>`)}
        ${rows.length > shown.length ? html`<div class="muted">อีก ${rows.length - shown.length} config</div>` : null}
      </div>`;
    }

    return html`<div class="chart">
      <svg viewBox="0 0 ${W} ${H}" ref=${ref} onMouseMove=${move} onMouseLeave=${() => setHoverK(null)}
           role="img" aria-label="Hit at k curve for each configuration">
        <g class="grid">${[0, 0.25, 0.5, 0.75, 1].map((v) => html`<line key=${v} x1=${m.l} x2=${W - m.r} y1=${y(v)} y2=${y(v)} />`)}</g>
        <g class="axis">
          ${[0, 0.25, 0.5, 0.75, 1].map((v) => html`<text key=${v} x=${m.l - 8} y=${y(v) + 4} text-anchor="end">${v * 100}%</text>`)}
          ${ks.map((k) => html`<text key=${k} x=${x(k)} y=${H - m.b + 18} text-anchor="middle">${k}</text>`)}
        </g>
        <text class="axis-title" x=${m.l + iw / 2} y=${H - 4} text-anchor="middle">k (จำนวน chunk ที่ดึงมา)</text>
        ${hoverK ? html`<line x1=${x(hoverK)} x2=${x(hoverK)} y1=${m.t} y2=${m.t + ih} stroke="var(--line-strong)" />` : null}
        ${order.map((i) => {
          const r = results[i], s = strokeFor(i, lead, focus);
          const pts = ks.map((k) => [x(k), y(r.metrics["hit@" + k] ?? 0)]);
          return html`<g key=${i} style=${{ cursor: "pointer" }} onClick=${() => onFocus && onFocus(i)}>
            <polyline points=${pts.map((p) => p.join(",")).join(" ")} fill="none" stroke=${s.stroke}
              stroke-width=${s.width} stroke-opacity=${s.op} stroke-linejoin="round" stroke-linecap="round" />
            <polyline points=${pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="transparent" stroke-width="12" />
            ${(i === lead || i === focus) && hoverK ? html`<circle cx=${x(hoverK)} cy=${y(r.metrics["hit@" + hoverK] ?? 0)} r="4.5"
              fill=${s.stroke} stroke="var(--card)" stroke-width="2" />` : null}
          </g>`;
        })}
        ${lead != null ? (() => {
          const v = results[lead].metrics["hit@" + kMax] ?? 0;
          return html`<text x=${x(kMax) - 4} y=${y(v) - 10} text-anchor="end" style=${{ fill: "var(--accent-ink)", font: "12px var(--sans)" }}>${results[lead].label}</text>`;
        })() : null}
      </svg>
      ${tip}
    </div>`;
  }

  /* Latency: p50 dot, p95 ring, p99 tick, one row per config, on one ms axis */
  function LatencyDumbbell({ results, lead, focus, onFocus }) {
    const rowH = 28, m = { l: 12, r: 16, t: 8, b: 32 }, W = 420;
    const H = m.t + results.length * rowH + m.b;
    const max = niceMax(Math.max(...results.map((r) => r.metrics.latency_p99_ms || 0)));
    const iw = W - m.l - m.r;
    const x = (v) => m.l + (v / max) * iw;
    const [hover, setHover] = useState(null);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

    return html`<div class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Retrieval latency percentiles per configuration">
        <g class="grid">${ticks.map((t) => html`<line key=${t} x1=${x(t)} x2=${x(t)} y1=${m.t} y2=${H - m.b} />`)}</g>
        <g class="axis">${ticks.map((t) => html`<text key=${t} x=${x(t)} y=${H - m.b + 16} text-anchor="middle">${t < 10 ? +t.toFixed(1) : Math.round(t)}</text>`)}</g>
        <text class="axis-title" x=${W - m.r} y=${H - 2} text-anchor="end">ms ต่อคำถาม</text>
        ${results.map((r, i) => {
          const cy = m.t + i * rowH + rowH / 2, mt = r.metrics;
          const col = i === lead ? "var(--accent)" : i === focus ? "var(--text)" : "var(--text-2)";
          return html`<g key=${i} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}
                         onClick=${() => onFocus && onFocus(i)} style=${{ cursor: "pointer" }}>
            <rect x="0" y=${cy - rowH / 2} width=${W} height=${rowH} fill=${hover === i ? "var(--raised)" : "transparent"} rx="4" />
            <line x1=${x(mt.latency_p50_ms)} x2=${x(mt.latency_p95_ms)} y1=${cy} y2=${cy} stroke=${col} stroke-width="2" stroke-opacity="0.5" />
            <line x1=${x(mt.latency_p99_ms)} x2=${x(mt.latency_p99_ms)} y1=${cy - 5} y2=${cy + 5} stroke=${col} stroke-width="1.5" />
            <circle cx=${x(mt.latency_p50_ms)} cy=${cy} r="4.5" fill=${col} stroke="var(--card)" stroke-width="2" />
            <circle cx=${x(mt.latency_p95_ms)} cy=${cy} r="4" fill="var(--card)" stroke=${col} stroke-width="2" />
          </g>`;
        })}
      </svg>
      ${hover != null ? html`<div class="tip" style=${{ left: "12px", top: `${((m.t + hover * rowH + rowH) / H) * 100}%` }}>
        <div class="t">${results[hover].label}</div>
        <div class="r"><span>p50</span><b>${ms(results[hover].metrics.latency_p50_ms)}</b></div>
        <div class="r"><span>p95</span><b>${ms(results[hover].metrics.latency_p95_ms)}</b></div>
        <div class="r"><span>p99</span><b>${ms(results[hover].metrics.latency_p99_ms)}</b></div>
      </div>` : null}
    </div>`;
  }

  window.Charts = { HitCurve, LatencyDumbbell, pct, ms };
})();
