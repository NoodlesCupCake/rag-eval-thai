(function () {
  const { useState, useEffect, useMemo, useCallback, useRef } = React;
  const html = htm.bind(React.createElement);
  const { HitCurve, LatencyDumbbell, pct, ms } = window.Charts;

  // ---------- api ----------
  async function api(method, path, body, isForm) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      if (isForm) opt.body = body;
      else { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
    }
    const r = await fetch("/api" + path, opt);
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
    if (!r.ok) throw new Error(typeof data === "object" ? (Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join(", ") : data.detail) : data);
    return data;
  }
  const get = (p) => api("GET", p);
  const post = (p, b) => api("POST", p, b);
  const del = (p) => api("DELETE", p);
  const upload = (p, files, field = "files") => {
    const fd = new FormData();
    for (const f of files) fd.append(field, f);
    return api("POST", p, fd, true);
  };

  async function pollJob(id, onTick) {
    for (;;) {
      const j = await get("/jobs/" + id);
      onTick(j);
      if (j.status !== "running") return j;
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  // ---------- icons (lucide geometry, 1.5 stroke) ----------
  const ICONS = {
    doc: html`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>`,
    list: html`<path d="M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13"/>`,
    play: html`<polygon points="6 3 20 12 6 21 6 3"/>`,
    chart: html`<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>`,
    upload: html`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>`,
    download: html`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>`,
    trash: html`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`,
    plus: html`<path d="M5 12h14M12 5v14"/>`,
    x: html`<path d="M18 6 6 18M6 6l12 12"/>`,
    gear: html`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`,
    pen: html`<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>`,
    back: html`<path d="m15 18-6-6 6-6"/>`,
  };
  const Icon = ({ name }) => html`<svg viewBox="0 0 24 24" class="icon" aria-hidden="true">${ICONS[name]}</svg>`;

  const Mark = () => html`<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
    <rect width="28" height="28" rx="7" fill="var(--text)"/>
    <path d="M7 8v12M11.5 8v6M16 8v9M20.5 8v6" stroke="var(--bg)" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="16" cy="20.5" r="1.6" fill="var(--accent)"/></svg>`;

  // ---------- routing ----------
  function useRoute() {
    const [hash, setHash] = useState(location.hash || "#/documents");
    useEffect(() => {
      const on = () => setHash(location.hash || "#/documents");
      addEventListener("hashchange", on);
      return () => removeEventListener("hashchange", on);
    }, []);
    return hash.slice(2).split("/");
  }
  const go = (path) => { location.hash = "#/" + path; };

  const fmtDate = (t) => new Date(t * 1000).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const fmtNum = (n) => n.toLocaleString("th-TH");

  // ---------- shell ----------
  function App() {
    const route = useRoute();
    const [status, setStatus] = useState(null);
    const refresh = useCallback(() => get("/status").then(setStatus).catch(() => {}), []);
    useEffect(() => { refresh(); }, [refresh, route[0]]);
    const c = status?.counts || {};
    const nav = [
      ["documents", "เอกสาร", "doc", c.documents],
      ["qa", "ชุดคำถาม", "list", c.qa],
      ["bench", "Benchmark", "play", null],
      ["runs", "ผลลัพธ์", "chart", c.runs],
      ["settings", "ตั้งค่า LLM", "gear", null],
    ];
    const page = route[0];
    let body;
    if (page === "qa") body = html`<${QAPage} status=${status} refresh=${refresh} />`;
    else if (page === "bench") body = html`<${BenchPage} status=${status} refresh=${refresh} />`;
    else if (page === "runs" && route[1]) body = html`<${RunPage} id=${route[1]} />`;
    else if (page === "runs") body = html`<${RunsPage} refresh=${refresh} />`;
    else if (page === "settings") body = html`<${SettingsPage} refresh=${refresh} />`;
    else body = html`<${DocumentsPage} refresh=${refresh} selected=${route[1]} />`;

    return html`<div class="shell">
      <aside class="side">
        <div class="brand"><${Mark} /><span class="brand-name">Bantat</span></div>
        <div class="brand-sub">วัดผล RAG สำหรับเอกสารภาษาไทย</div>
        <nav class="nav">
          ${nav.map(([k, label, icon, n]) => html`<a key=${k} href=${"#/" + k} class=${page === k || (!page && k === "documents") ? "on" : ""}>
            <${Icon} name=${icon} />${label}${n != null ? html`<span class="count">${n}</span>` : null}</a>`)}
        </nav>
        <div class="side-foot">
          <a class="row" href="#/settings" style=${{ textDecoration: "none" }}><span class=${"dot" + (status?.llm_available ? " ok" : "")}></span>
            <span class="ellipsis mono">${status?.llm_available ? status.llm.model : "ยังไม่ได้ตั้งค่า LLM"}</span></a>
          <div class="row mono">embedding · ${status?.device || "…"}</div>
        </div>
      </aside>
      <main class="main">${body}</main>
    </div>`;
  }

  function Err({ error }) {
    return error ? html`<div class="notice err">${error}</div>` : null;
  }

  // ---------- documents ----------
  function DocumentsPage({ refresh, selected }) {
    const [docs, setDocs] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef(null);
    const load = () => get("/documents").then(setDocs).catch((e) => setError(e.message));
    useEffect(() => { load(); }, []);

    const sel = selected || docs?.[0]?.id;

    async function onFiles(e) {
      const files = [...e.target.files];
      e.target.value = "";
      if (!files.length) return;
      setBusy(true); setError(null);
      try { await upload("/documents", files); await load(); refresh(); } catch (err) { setError(err.message); }
      setBusy(false);
    }
    async function samples() {
      setBusy(true); setError(null);
      try { await post("/samples"); await load(); refresh(); } catch (err) { setError(err.message); }
      setBusy(false);
    }
    async function remove(id) {
      if (!confirm("ลบเอกสารนี้? คำถามที่อ้างถึงเอกสารนี้จะถูกลบด้วย")) return;
      await del("/documents/" + id); await load(); refresh();
      if (selected === id) go("documents");
    }

    return html`<div class="stack">
      <div class="page-head">
        <div><h1>เอกสาร</h1>
          <p>คลังเอกสารที่ RAG จะค้นหา เลือกเอกสารเพื่อดูว่าแต่ละวิธีตัด chunk ตรงไหน</p></div>
        <div class="actions">
          <button class="btn" onClick=${samples} disabled=${busy}>โหลดชุดตัวอย่าง</button>
          <button class="btn primary" onClick=${() => fileRef.current.click()} disabled=${busy}><${Icon} name="upload" />อัปโหลด</button>
          <input type="file" ref=${fileRef} multiple accept=".txt,.md,.pdf" hidden onChange=${onFiles} />
        </div>
      </div>
      <${Err} error=${error} />
      ${docs && !docs.length ? html`<div class="card empty">
          <h3>ยังไม่มีเอกสาร</h3>
          <p>อัปโหลดไฟล์ .txt .md หรือ .pdf หรือเริ่มจากชุดตัวอย่าง 3 เอกสารภาษาไทยพร้อมคำถาม 29 ข้อ</p>
          <button class="btn accent" onClick=${samples} disabled=${busy}>โหลดชุดตัวอย่าง</button>
        </div>` : null}
      ${docs?.length ? html`<div style=${{ display: "grid", gridTemplateColumns: "minmax(240px, 300px) minmax(0, 1fr)", gap: 24, alignItems: "start" }} class="docs-grid">
        <div class="card">
          ${docs.map((d) => html`<div key=${d.id} class=${"list-row clickable" + (d.id === sel ? " on" : "")} onClick=${() => go("documents/" + d.id)}>
            <div class="grow"><div class="ellipsis">${d.name}</div><div class="meta-row">${fmtNum(d.chars)} ตัวอักษร</div></div>
            <button class="btn ghost sm" title="ลบ" aria-label="ลบ" onClick=${(e) => { e.stopPropagation(); remove(d.id); }}><${Icon} name="trash" /></button>
          </div>`)}
        </div>
        ${sel ? html`<${ChunkPreview} key=${sel} id=${sel} />` : null}
      </div>` : null}
    </div>`;
  }

  function ChunkPreview({ id }) {
    const [doc, setDoc] = useState(null);
    const [cfg, setCfg] = useState({ strategy: "recursive", size: 400, overlap: 50 });
    const [res, setRes] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => { get("/documents/" + id).then(setDoc).catch((e) => setError(e.message)); }, [id]);
    useEffect(() => {
      const t = setTimeout(() => post(`/documents/${id}/chunks`, cfg).then(setRes).catch((e) => setError(e.message)), 200);
      return () => clearTimeout(t);
    }, [id, cfg.strategy, cfg.size, cfg.overlap]);

    const parts = useMemo(() => {
      if (!doc || !res) return [];
      const out = []; let pos = 0;
      res.chunks.forEach((c, i) => {
        const s = Math.max(c.start, pos);
        if (s > pos) out.push({ gap: true, text: doc.text.slice(pos, s) });
        if (c.end > s) out.push({ i, text: doc.text.slice(s, c.end) });
        pos = Math.max(pos, c.end);
      });
      if (pos < doc.text.length) out.push({ gap: true, text: doc.text.slice(pos) });
      return out;
    }, [doc, res]);

    const set = (k) => (e) => setCfg({ ...cfg, [k]: k === "strategy" ? e.target.value : +e.target.value });
    return html`<div class="card">
      <div class="card-head">
        <h2>${doc?.name || "…"}</h2>
        ${res ? html`<span class="meta mono">${res.stats.n} chunks · เฉลี่ย ${Math.round(res.stats.avg)} ตัวอักษร ·
          <span class=${res.mid_word ? "best" : ""}>ตัดกลางคำ ${res.mid_word}</span></span>` : null}
      </div>
      <div class="card-pad form-grid" style=${{ borderBottom: "1px solid var(--line)" }}>
        <label class="field"><span>วิธีตัด</span>
          <select class="input" value=${cfg.strategy} onChange=${set("strategy")}>
            <option value="char">char: ตัดตามจำนวนตัวอักษร</option>
            <option value="word">word: ตัดที่ขอบคำไทย</option>
            <option value="recursive">recursive: ย่อหน้า → ประโยค → คำ</option>
          </select></label>
        <label class="field"><span>ขนาด (ตัวอักษร)</span><input class="input mono" type="number" min="50" step="50" value=${cfg.size} onChange=${set("size")} /></label>
        <label class="field"><span>overlap (ตัวอักษร)</span><input class="input mono" type="number" min="0" step="10" value=${cfg.overlap} onChange=${set("overlap")} /></label>
      </div>
      <${Err} error=${error} />
      <div class="doc-text">${parts.map((p, k) => p.gap
        ? html`<span key=${k} class="gap">${p.text}</span>`
        : html`<span key=${k} class=${"c " + (p.i % 2 ? "b" : "a")}><span class="tag">${p.i + 1}</span>${p.text}</span>`)}</div>
    </div>`;
  }

  // ---------- QA ----------
  function QAPage({ status, refresh }) {
    const [items, setItems] = useState(null);
    const [docs, setDocs] = useState([]);
    const [panel, setPanel] = useState(null);
    const [error, setError] = useState(null);
    const [msg, setMsg] = useState(null);
    const [filter, setFilter] = useState("");
    const fileRef = useRef(null);
    const load = () => get("/qa").then(setItems).catch((e) => setError(e.message));
    useEffect(() => { load(); get("/documents").then(setDocs); }, []);

    async function onImport(e) {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      setError(null); setMsg(null);
      try {
        const r = await upload("/qa/import", [f], "file");
        setMsg(`นำเข้า ${r.added} ข้อ` + (r.errors.length ? ` · ข้าม ${r.errors.length} ข้อ: ` + r.errors.slice(0, 3).map((x) => `แถว ${x.row} ${x.error}`).join(", ") : ""));
        load(); refresh();
      } catch (err) { setError(err.message); }
    }
    async function remove(id) { await del("/qa/" + id); load(); refresh(); }
    async function clearAll() {
      if (!confirm(`ลบคำถามทั้งหมด ${items.length} ข้อ?`)) return;
      await del("/qa"); load(); refresh();
    }

    const shown = (items || []).filter((q) => !filter || q.question.includes(filter) || q.answer.includes(filter));
    return html`<div class="stack">
      <div class="page-head">
        <div><h1>ชุดคำถาม</h1>
          <p>แต่ละข้อมีคำถาม คำตอบอ้างอิง และ evidence คือข้อความในเอกสารที่ใช้ตอบ ระบบเทียบ evidence กับ chunk ที่ดึงมาได้ จึงใช้ชุดเดียวกันกับทุกวิธีตัด chunk</p></div>
        <div class="actions">
          <button class="btn" onClick=${() => fileRef.current.click()}><${Icon} name="upload" />นำเข้า</button>
          <a class="btn" href="/api/qa/export?format=csv"><${Icon} name="download" />CSV</a>
          <button class="btn" onClick=${() => setPanel(panel === "gen" ? null : "gen")}>สร้างด้วย LLM</button>
          <button class="btn primary" onClick=${() => setPanel(panel === "add" ? null : "add")}><${Icon} name="plus" />เพิ่มคำถาม</button>
          <input type="file" ref=${fileRef} accept=".csv,.json" hidden onChange=${onImport} />
        </div>
      </div>
      <${Err} error=${error} />
      ${msg ? html`<div class="notice">${msg}</div>` : null}
      ${panel === "add" ? html`<${AddQA} docs=${docs} onDone=${() => { setPanel(null); load(); refresh(); }} />` : null}
      ${panel === "gen" ? html`<${GenerateQA} docs=${docs} status=${status} onDone=${(m) => { setMsg(m); load(); refresh(); }} />` : null}
      <div class="card">
        <div class="card-head">
          <h2>${items ? `${items.length} คำถาม` : "…"}</h2>
          <div class="actions">
            <input class="input" style=${{ width: 220, height: 32 }} placeholder="ค้นหา" value=${filter} onInput=${(e) => setFilter(e.target.value)} />
            ${items?.length ? html`<button class="btn ghost sm" onClick=${clearAll}>ลบทั้งหมด</button>` : null}
          </div>
        </div>
        ${items && !items.length ? html`<div class="empty"><h3>ยังไม่มีคำถาม</h3>
          <p>นำเข้าไฟล์ CSV ที่มีคอลัมน์ <span class="mono">question, answer, evidence, document</span> หรือให้ LLM สร้างจากเอกสาร</p></div>` : null}
        ${shown.length ? html`<div class="table-wrap"><table>
          <thead><tr><th style=${{ width: "36%" }}>คำถาม · คำตอบอ้างอิง</th><th>Evidence</th><th>ที่มา</th><th></th></tr></thead>
          <tbody>${shown.map((q) => html`<tr key=${q.id}>
            <td><div>${q.question}</div><div class="small sec">${q.answer}</div></td>
            <td class="small"><div class="sec">${q.evidence_text}</div><div class="meta-row" style=${{ marginTop: 4 }}>${q.doc_name}</div></td>
            <td class="meta-row">${q.source}</td>
            <td class="num"><button class="btn ghost sm" aria-label="ลบ" onClick=${() => remove(q.id)}><${Icon} name="trash" /></button></td>
          </tr>`)}</tbody></table></div>` : null}
      </div>
    </div>`;
  }

  function AddQA({ docs, onDone }) {
    const [f, setF] = useState({ question: "", answer: "", evidence: "", document_id: "" });
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
      setError(null);
      try { await post("/qa", { ...f, document_id: f.document_id || null }); onDone(); } catch (e) { setError(e.message); }
    }
    return html`<div class="card card-pad stack" style=${{ gap: 16 }}>
      <div class="form-grid">
        <label class="field"><span>คำถาม</span><input class="input" value=${f.question} onInput=${set("question")} /></label>
        <label class="field"><span>คำตอบอ้างอิง</span><input class="input" value=${f.answer} onInput=${set("answer")} /></label>
      </div>
      <div class="form-grid">
        <label class="field" style=${{ gridColumn: "span 2" }}><span>Evidence: คัดลอกข้อความจากเอกสารมาตรงตัว</span>
          <textarea class="input" rows="3" value=${f.evidence} onInput=${set("evidence")}></textarea></label>
        <label class="field"><span>เอกสาร</span>
          <select class="input" value=${f.document_id} onChange=${set("document_id")}>
            <option value="">ค้นหาทุกเอกสาร</option>
            ${docs.map((d) => html`<option key=${d.id} value=${d.id}>${d.name}</option>`)}
          </select></label>
      </div>
      <${Err} error=${error} />
      <div class="actions"><button class="btn primary" onClick=${save} disabled=${!f.question || !f.evidence}>บันทึก</button></div>
    </div>`;
  }

  function GenerateQA({ docs, status, onDone }) {
    const [f, setF] = useState({ max_questions: 20, per_passage: 2, passage_chars: 800, model: "", document_ids: [] });
    const [job, setJob] = useState(null);
    const [error, setError] = useState(null);
    const ready = status?.llm_available;
    async function start() {
      setError(null);
      try {
        const j = await post("/qa/generate", { ...f, model: f.model || null });
        const done = await pollJob(j.id, setJob);
        if (done.status === "failed") setError(done.error); else onDone(done.message);
      } catch (e) { setError(e.message); }
    }
    const set = (k) => (e) => setF({ ...f, [k]: k === "model" ? e.target.value : +e.target.value });
    const running = job?.status === "running";
    return html`<div class="card card-pad stack" style=${{ gap: 16 }}>
      ${!ready ? html`<div class="notice">ยังไม่ได้ตั้งค่า LLM <a href="#/settings">ไปที่หน้าตั้งค่า</a></div>` : null}
      <div class="small sec">LLM อ่านเอกสารทีละช่วง เขียนคำถามแบบที่ผู้ใช้จริงจะถาม และคัดลอก evidence จากเอกสารตรงตัว ข้อที่หา evidence ในเอกสารไม่เจอจะถูกตัดทิ้ง ควรอ่านตรวจก่อนใช้เป็นชุดทดสอบจริง</div>
      <div class="form-grid">
        <label class="field"><span>จำนวนคำถามสูงสุด</span><input class="input mono" type="number" min="1" value=${f.max_questions} onChange=${set("max_questions")} /></label>
        <label class="field"><span>คำถามต่อช่วง</span><input class="input mono" type="number" min="1" max="5" value=${f.per_passage} onChange=${set("per_passage")} /></label>
        <label class="field"><span>ความยาวช่วง (ตัวอักษร)</span><input class="input mono" type="number" min="200" step="100" value=${f.passage_chars} onChange=${set("passage_chars")} /></label>
        <label class="field"><span>โมเดล</span><input class="input mono" placeholder=${status?.default_model} value=${f.model} onInput=${set("model")} /></label>
      </div>
      <div class="actions" style=${{ gap: 16 }}>${docs.map((d) => html`<label class="check small" key=${d.id}>
        <input type="checkbox" checked=${!f.document_ids.length || f.document_ids.includes(d.id)}
          onChange=${(e) => {
            const all = f.document_ids.length ? f.document_ids : docs.map((x) => x.id);
            setF({ ...f, document_ids: e.target.checked ? [...all, d.id] : all.filter((x) => x !== d.id) });
          }} />${d.name}</label>`)}</div>
      ${job ? html`<div><div class="progress"><div style=${{ width: `${(job.done / Math.max(job.total, 1)) * 100}%` }}></div></div>
        <div class="meta-row" style=${{ marginTop: 8 }}>${job.done}/${job.total} ช่วง ${job.message ? "· " + job.message : ""}</div></div>` : null}
      <${Err} error=${error} />
      <div class="actions"><button class="btn primary" onClick=${start} disabled=${!ready || running}>${running ? "กำลังสร้าง" : "สร้างคำถาม"}</button></div>
    </div>`;
  }

  // ---------- benchmark ----------
  const DEFAULT_CHUNKS = [
    { strategy: "char", size: 400, overlap: 0 },
    { strategy: "word", size: 400, overlap: 50 },
    { strategy: "recursive", size: 400, overlap: 50 },
  ];
  const DEFAULT_RETRIEVERS = [
    { type: "bm25", model: "" },
    { type: "dense", model: "intfloat/multilingual-e5-small" },
    { type: "hybrid", model: "intfloat/multilingual-e5-small" },
  ];

  function BenchPage({ status, refresh }) {
    const [chunks, setChunks] = useState(DEFAULT_CHUNKS);
    const [rets, setRets] = useState(DEFAULT_RETRIEVERS);
    const [name, setName] = useState("");
    const [kMax, setKMax] = useState(10);
    const [sample, setSample] = useState("");
    const [gen, setGen] = useState({ enabled: false, top_k: 3, model: "" });
    const [job, setJob] = useState(null);
    const [error, setError] = useState(null);
    const n = chunks.length * rets.length;
    const nq = status?.counts?.qa || 0;

    const upd = (arr, setArr, i, k) => (e) => setArr(arr.map((x, j) => (j === i ? { ...x, [k]: e.target.type === "number" ? +e.target.value : e.target.value } : x)));

    async function run() {
      setError(null);
      try {
        const j = await post("/runs", {
          name: name || null, chunkings: chunks, k_max: kMax, sample: sample ? +sample : null,
          retrievers: rets.map((r) => ({ type: r.type, model: r.type === "bm25" ? null : r.model })),
          generation: { ...gen, model: gen.model || null },
        });
        refresh();
        const done = await pollJob(j.id, setJob);
        if (done.status === "failed") setError(done.error);
        go("runs/" + j.run_id);
      } catch (e) { setError(e.message); }
    }
    const running = job?.status === "running";
    const nGen = (sample ? Math.min(+sample, nq) : nq) * n;

    return html`<div class="stack">
      <div class="page-head">
        <div><h1>Benchmark</h1>
          <p>รันทุกคู่ระหว่างวิธีตัด chunk กับ retriever แล้ววัด Hit@k, MRR, coverage และ latency ต่อคำถาม</p></div>
      </div>
      <div class="grid-2" style=${{ alignItems: "start" }}>
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>วิธีตัด chunk</h2><span class="meta">ขนาดวัดเป็นตัวอักษรทุกวิธี เทียบกันได้ตรง ๆ</span></div>
            <div class="card-pad stack" style=${{ gap: 12 }}>
              ${chunks.map((c, i) => html`<div class="cfg-row" key=${i}>
                <label class="field"><span>วิธี</span><select class="input" value=${c.strategy} onChange=${upd(chunks, setChunks, i, "strategy")}>
                  ${(status?.strategies || ["char", "word", "recursive"]).map((s) => html`<option key=${s}>${s}</option>`)}</select></label>
                <label class="field"><span>ขนาด</span><input class="input mono" type="number" min="50" step="50" value=${c.size} onChange=${upd(chunks, setChunks, i, "size")} /></label>
                <label class="field"><span>overlap</span><input class="input mono" type="number" min="0" step="10" value=${c.overlap} onChange=${upd(chunks, setChunks, i, "overlap")} /></label>
                <button class="btn ghost" style=${{ padding: 0, width: 36, justifyContent: "center" }} aria-label="ลบ" disabled=${chunks.length < 2} onClick=${() => setChunks(chunks.filter((_, j) => j !== i))}><${Icon} name="x" /></button>
              </div>`)}
              <div><button class="btn sm" onClick=${() => setChunks([...chunks, { ...chunks[chunks.length - 1] }])}><${Icon} name="plus" />เพิ่ม</button></div>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Retriever</h2><span class="meta">hybrid = dense + BM25 รวมด้วย reciprocal rank fusion</span></div>
            <div class="card-pad stack" style=${{ gap: 12 }}>
              <datalist id="models">${(status?.suggested_models || []).map((m) => html`<option key=${m.id} value=${m.id}>${m.note}</option>`)}</datalist>
              ${rets.map((r, i) => html`<div class="cfg-row r" key=${i}>
                <label class="field"><span>ชนิด</span><select class="input" value=${r.type} onChange=${upd(rets, setRets, i, "type")}>
                  <option value="bm25">bm25</option><option value="dense">dense</option><option value="hybrid">hybrid</option></select></label>
                <label class="field"><span>Embedding model (Hugging Face)</span>
                  <input class="input mono" list="models" disabled=${r.type === "bm25"} value=${r.type === "bm25" ? "ตัดคำด้วย PyThaiNLP" : r.model} onInput=${upd(rets, setRets, i, "model")} /></label>
                <button class="btn ghost" style=${{ padding: 0, width: 36, justifyContent: "center" }} aria-label="ลบ" disabled=${rets.length < 2} onClick=${() => setRets(rets.filter((_, j) => j !== i))}><${Icon} name="x" /></button>
              </div>`)}
              <div><button class="btn sm" onClick=${() => setRets([...rets, { type: "dense", model: "BAAI/bge-m3" }])}><${Icon} name="plus" />เพิ่ม</button></div>
              <div class="small muted">โมเดลจะดาวน์โหลดครั้งแรกที่ใช้ bge-m3 ประมาณ 2.3 GB</div>
            </div>
          </div>
        </div>
        <div class="card card-pad stack" style=${{ gap: 16, position: "sticky", top: 32 }}>
          <label class="field"><span>ชื่อรอบนี้</span><input class="input" placeholder="เช่น ลองขนาด 400" value=${name} onInput=${(e) => setName(e.target.value)} /></label>
          <div class="form-grid" style=${{ gridTemplateColumns: "1fr 1fr" }}>
            <label class="field"><span>k สูงสุด</span><input class="input mono" type="number" min="1" max="20" value=${kMax} onChange=${(e) => setKMax(+e.target.value)} /></label>
            <label class="field"><span>สุ่มคำถาม (ว่าง = ทั้งหมด)</span><input class="input mono" type="number" min="1" value=${sample} onChange=${(e) => setSample(e.target.value)} /></label>
          </div>
          <hr class="rule" />
          <label class="check"><input type="checkbox" checked=${gen.enabled} disabled=${!status?.llm_available} onChange=${(e) => setGen({ ...gen, enabled: e.target.checked })} />
            ให้ LLM ตอบและให้คะแนนคำตอบ</label>
          ${!status?.llm_available ? html`<div class="small muted"><a href="#/settings">ตั้งค่า LLM</a> ก่อน การวัด retrieval ไม่ต้องใช้</div>` : null}
          ${gen.enabled ? html`<div class="form-grid" style=${{ gridTemplateColumns: "1fr 2fr" }}>
            <label class="field"><span>ใช้ top k</span><input class="input mono" type="number" min="1" max="10" value=${gen.top_k} onChange=${(e) => setGen({ ...gen, top_k: +e.target.value })} /></label>
            <label class="field"><span>โมเดล</span><input class="input mono" placeholder=${status?.default_model} value=${gen.model} onInput=${(e) => setGen({ ...gen, model: e.target.value })} /></label>
          </div>
          <div class="small muted">เรียก ${status?.llm?.model} ${fmtNum(nGen * 2)} ครั้ง (ตอบ + ตัดสิน ต่อคำถามต่อ config)</div>` : null}
          <hr class="rule" />
          <div class="small sec"><span class="mono">${n}</span> configs × <span class="mono">${sample ? Math.min(+sample, nq) : nq}</span> คำถาม</div>
          ${job ? html`<div><div class="progress"><div style=${{ width: `${(job.done / Math.max(job.total, 1)) * 100}%` }}></div></div>
            <div class="meta-row" style=${{ marginTop: 8 }}>${job.message}</div></div>` : null}
          <${Err} error=${error} />
          <button class="btn accent" style=${{ height: 44, justifyContent: "center" }} onClick=${run} disabled=${running || !nq}>
            <${Icon} name="play" />${running ? "กำลังรัน" : "เริ่ม benchmark"}</button>
          ${!nq ? html`<div class="small muted">ต้องมีคำถามในชุดคำถามก่อน</div>` : null}
        </div>
      </div>
    </div>`;
  }

  // ---------- runs ----------
  function RunsPage({ refresh }) {
    const [runs, setRuns] = useState(null);
    const load = () => get("/runs").then(setRuns);
    useEffect(() => { load(); }, []);
    async function remove(id) { if (confirm("ลบผลการรันนี้?")) { await del("/runs/" + id); load(); refresh(); } }
    const best = (r) => r.summary.reduce((a, b) => (!a || (b.mrr ?? 0) > (a.mrr ?? 0) ? b : a), null);
    return html`<div class="stack">
      <div class="page-head"><div><h1>ผลลัพธ์</h1><p>แต่ละรอบเก็บไว้ในโฟลเดอร์ <span class="mono">data/runs</span></p></div>
        <div class="actions"><a class="btn primary" href="#/bench"><${Icon} name="play" />รันใหม่</a></div></div>
      <div class="card">
        ${runs && !runs.length ? html`<div class="empty"><h3>ยังไม่มีผลลัพธ์</h3><p>ไปที่หน้า Benchmark เพื่อรันรอบแรก</p></div>` : null}
        ${runs?.length ? html`<div class="table-wrap"><table>
          <thead><tr><th>รอบ</th><th>สถานะ</th><th class="num">configs</th><th class="num">คำถาม</th><th>config ที่ดีที่สุด</th><th class="num">Hit@3</th><th class="num">MRR</th><th></th></tr></thead>
          <tbody>${runs.map((r) => { const b = best(r); return html`<tr key=${r.id} class="clickable" onClick=${() => go("runs/" + r.id)}>
            <td><div>${r.name}</div><div class="meta-row">${fmtDate(r.created_at)}</div></td>
            <td class="meta-row">${r.status}</td>
            <td class="num mono">${r.n_configs}</td><td class="num mono">${r.n_questions}</td>
            <td class="mono small">${b?.label || "–"}</td>
            <td class="num mono">${b ? pct(b["hit@3"]) : "–"}</td><td class="num mono">${b ? b.mrr.toFixed(3) : "–"}</td>
            <td class="num"><button class="btn ghost sm" aria-label="ลบ" onClick=${(e) => { e.stopPropagation(); remove(r.id); }}><${Icon} name="trash" /></button></td>
          </tr>`; })}</tbody></table></div>` : null}
      </div>
    </div>`;
  }

  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  function RunPage({ id }) {
    const [run, setRun] = useState(null);
    const [error, setError] = useState(null);
    const [focus, setFocus] = useState(null);
    const [sort, setSort] = useState({ key: "mrr", dir: -1 });
    useEffect(() => {
      let alive = true;
      const tick = async () => {
        try {
          const r = await get("/runs/" + id);
          if (!alive) return;
          setRun(r);
          if (r.status === "running") setTimeout(tick, 1500);
        } catch (e) { setError(e.message); }
      };
      tick();
      return () => { alive = false; };
    }, [id]);

    if (error) return html`<${Err} error=${error} />`;
    if (!run) return html`<div class="muted">กำลังโหลด</div>`;
    const R = run.results;
    const kMax = run.spec.k_max;
    const lead = R.length ? R.reduce((bi, r, i) => ((r.metrics.mrr ?? 0) > (R[bi].metrics.mrr ?? 0) ? i : bi), 0) : null;
    const f = focus ?? lead;
    const hasGen = R.some((r) => r.metrics.answer_correctness != null);
    const L = lead != null ? R[lead].metrics : null;
    const delta = (key, scale = 100, unit = " pt") => {
      if (R.length < 2) return "config เดียวในรอบนี้";
      const d = (L[key] - median(R.map((r) => r.metrics[key] ?? 0))) * scale;
      return `${d >= 0 ? "+" : ""}${d.toFixed(1)}${unit} เทียบค่ากลางของ ${R.length} configs`;
    };

    const cols = [
      ["hit@1", "Hit@1", pct], ["hit@3", "Hit@3", pct], ["hit@5", "Hit@5", pct], ["mrr", "MRR", (v) => v?.toFixed(3)],
      ["coverage@3", "Coverage@3", pct], ["latency_p50_ms", "p50", ms], ["latency_p95_ms", "p95", ms],
      ...(hasGen ? [["answer_correctness", "ตอบถูก", pct], ["faithfulness", "อิงเอกสาร", pct]] : []),
    ].filter(([k]) => !k.startsWith("hit@") || +k.slice(4) <= kMax);
    const bestOf = {};
    for (const [k] of cols) {
      const vals = R.map((r) => r.metrics[k]).filter((v) => v != null);
      bestOf[k] = k.startsWith("latency") ? Math.min(...vals) : Math.max(...vals);
    }
    const sorted = R.map((r, i) => ({ r, i })).sort((a, b) => sort.dir * ((a.r.metrics[sort.key] ?? 0) - (b.r.metrics[sort.key] ?? 0)));

    return html`<div class="stack">
      <div class="page-head">
        <div><a href="#/runs" class="small muted" style=${{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}><${Icon} name="back" />ผลลัพธ์ทั้งหมด</a>
          <h1 style=${{ marginTop: 8 }}>${run.name}</h1>
          <p class="mono small">${fmtDate(run.created_at)} · ${run.n_questions} คำถาม · ${R.length}/${run.spec.chunkings.length * run.spec.retrievers.length} configs${run.status === "running" ? " · กำลังรัน" : ""}</p></div>
      </div>
      ${run.error ? html`<${Err} error=${"รันไม่สำเร็จ: " + run.error} />` : null}
      ${!R.length ? html`<div class="card empty"><h3>${run.status === "running" ? "กำลังรัน config แรก" : "ไม่มีผลลัพธ์"}</h3><p>ครั้งแรกอาจช้าเพราะต้องดาวน์โหลด embedding model</p></div>` : html`
      <div class="stats">
        <div class="card stat"><div class="label">Hit@3 · ${R[lead].label}</div><div class="fig">${(L["hit@3"] * 100).toFixed(1)}<small>%</small></div><div class="cmp">${delta("hit@3")}</div></div>
        <div class="card stat"><div class="label">MRR</div><div class="fig">${L.mrr.toFixed(3)}</div><div class="cmp">${delta("mrr", 1, "")}</div></div>
        <div class="card stat"><div class="label">Latency p95</div><div class="fig">${L.latency_p95_ms.toFixed(L.latency_p95_ms < 10 ? 2 : 1)}<small>ms</small></div><div class="cmp">p50 ${ms(L.latency_p50_ms)} · p99 ${ms(L.latency_p99_ms)}</div></div>
        ${hasGen
          ? html`<div class="card stat"><div class="label">LLM ตอบถูก</div><div class="fig">${((L.answer_correctness ?? 0) * 100).toFixed(1)}<small>%</small></div><div class="cmp">อิงเอกสาร ${pct(L.faithfulness)} · ${L.n_judged} ข้อ</div></div>`
          : html`<div class="card stat"><div class="label">Coverage@3</div><div class="fig">${((L["coverage@3"] ?? 0) * 100).toFixed(1)}<small>%</small></div><div class="cmp">ส่วนของ evidence ที่อยู่ใน top 3</div></div>`}
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h2>Hit@k</h2><span class="meta">สัดส่วนคำถามที่ evidence อยู่ใน k อันดับแรก คลิกเส้นเพื่อดูรายข้อ</span></div>
          <div class="card-pad"><${HitCurve} results=${R} kMax=${kMax} lead=${lead} focus=${f !== lead ? f : null} onFocus=${setFocus} /></div></div>
        <div class="card"><div class="card-head"><h2>Latency การค้นหา</h2><span class="meta">● p50 ○ p95 | p99</span></div>
          <div class="card-pad"><${LatencyDumbbell} results=${R} lead=${lead} focus=${f !== lead ? f : null} onFocus=${setFocus} /></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>เทียบทุก config</h2><span class="meta">คลิกหัวคอลัมน์เพื่อเรียง คลิกแถวเพื่อดูรายข้อ</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Config</th><th class="num">chunks</th>
            ${cols.map(([k, label]) => html`<th key=${k} class=${"num sortable" + (sort.key === k ? " sorted" : "")}
              onClick=${() => setSort({ key: k, dir: sort.key === k ? -sort.dir : k.startsWith("latency") ? 1 : -1 })}>${label}${sort.key === k ? (sort.dir < 0 ? " ↓" : " ↑") : ""}</th>`)}</tr></thead>
          <tbody>${sorted.map(({ r, i }) => html`<tr key=${i} class=${"clickable" + (i === f ? " focus" : "")} onClick=${() => setFocus(i)}>
            <td class="mono small" style=${{ whiteSpace: "nowrap" }}><span class=${"swatch" + (i === lead ? " lead" : i === f ? " sel" : "")}></span>${r.label}</td>
            <td class="num mono">${r.n_chunks}</td>
            ${cols.map(([k, , fmt]) => html`<td key=${k} class=${"num mono" + (R.length > 1 && r.metrics[k] === bestOf[k] ? " best" : "")}>${fmt(r.metrics[k])}</td>`)}
          </tr>`)}</tbody></table></div>
      </div>
      <${Questions} run=${run} result=${R[f]} />`}
    </div>`;
  }

  function Questions({ run, result }) {
    const [filter, setFilter] = useState("miss3");
    const [open, setOpen] = useState(null);
    const [texts, setTexts] = useState({});
    const kMax = run.spec.k_max;
    useEffect(() => {
      const ids = Object.keys(run.doc_names || {});
      Promise.all(ids.map((d) => get("/documents/" + d).then((x) => [d, x.text]).catch(() => [d, null])))
        .then((pairs) => setTexts(Object.fromEntries(pairs)));
    }, [run.id]);
    const rows = result.per_question.filter((p) =>
      filter === "all" ? true : filter === "miss1" ? p.hit_rank !== 1 : filter === "miss3" ? !(p.hit_rank && p.hit_rank <= 3)
        : filter === "wrong" ? p.judge && p.judge.verdict !== "correct" : true);
    const snippet = (c) => { const t = texts[c.doc_id]; return t ? t.slice(c.start, c.end) : "(เอกสารถูกลบแล้ว)"; };

    return html`<div class="card">
      <div class="card-head">
        <h2>รายข้อ · <span class="mono">${result.label}</span></h2>
        <select class="input" style=${{ height: 32 }} value=${filter} onChange=${(e) => setFilter(e.target.value)}>
          <option value="miss3">ไม่เจอใน top 3</option><option value="miss1">ไม่ใช่อันดับ 1</option>
          ${result.per_question.some((p) => p.judge) ? html`<option value="wrong">LLM ตอบไม่ถูก</option>` : null}
          <option value="all">ทั้งหมด</option>
        </select>
      </div>
      ${!rows.length ? html`<div class="empty"><p>ไม่มีข้อที่ตรงเงื่อนไข</p></div>` : null}
      ${rows.map((p) => { const q = run.questions?.[p.qa_id] || { question: p.qa_id }; const isOpen = open === p.qa_id;
        return html`<div key=${p.qa_id} style=${{ borderBottom: "1px solid var(--line)" }}>
          <div class="list-row clickable" style=${{ borderBottom: 0 }} onClick=${() => setOpen(isOpen ? null : p.qa_id)}>
            <div class="grow"><div>${q.question}</div>${isOpen ? html`<div class="small sec">คำตอบอ้างอิง: ${q.answer}</div>` : null}</div>
            <span class="ranks" title=${p.hit_rank ? `เจอที่อันดับ ${p.hit_rank}` : `ไม่เจอใน top ${kMax}`}>
              ${Array.from({ length: kMax }, (_, i) => html`<i key=${i} class=${p.hit_rank === i + 1 ? "hit" : !p.hit_rank ? "miss-all" : ""}></i>`)}</span>
            <span class="mono small" style=${{ width: 56, textAlign: "right" }}>${p.hit_rank ? "#" + p.hit_rank : "–"}</span>
            <span class="mono small muted" style=${{ width: 72, textAlign: "right" }}>${ms(p.latency_ms)}</span>
            ${p.judge ? html`<span class=${"verdict " + p.judge.verdict} style=${{ width: 72, textAlign: "right" }}>${p.judge.verdict}</span>` : null}
          </div>
          ${isOpen ? html`<div style=${{ padding: "0 24px 16px" }}>
            ${(q.evidence || []).map((ev, i) => html`<div key=${i} class="small"><span class="muted">Evidence · ${run.doc_names[ev.doc_id] || ""}</span>
              <div><mark class="ev">${snippet(ev)}</mark></div></div>`)}
            <div class="retrieved">${p.retrieved.slice(0, 5).map((c, i) => html`<div key=${i} class=${"item" + (p.hit_rank === i + 1 ? " hit" : "")}>
              <span class="mono muted">#${i + 1}</span><span>${snippet(c)}</span><span class="mono muted">${c.score.toFixed(3)}</span></div>`)}</div>
            ${p.answer ? html`<div class="small" style=${{ marginTop: 12 }}><span class="muted">คำตอบของ ${run.spec.generation?.model || "LLM"}</span><div>${p.answer}</div>
              ${p.judge ? html`<div class="muted" style=${{ marginTop: 4 }}>${p.judge.reason}${p.judge.grounded ? "" : " · มีส่วนที่ไม่ได้อิงจากเอกสาร"}</div>` : null}</div>` : null}
            ${p.gen_error ? html`<div class="notice err" style=${{ marginTop: 12 }}>${p.gen_error}</div>` : null}
          </div>` : null}
        </div>`; })}
    </div>`;
  }


  // ---------- LLM settings ----------
  function SettingsPage({ refresh }) {
    const [presets, setPresets] = useState([]);
    const [f, setF] = useState(null);
    const [saved, setSaved] = useState(null);
    const [test, setTest] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
      get("/settings").then((r) => { setPresets(r.presets); setSaved(r.settings); setF({ ...r.settings, api_key: "" }); });
    }, []);
    if (!f) return html`<div class="muted">กำลังโหลด</div>`;

    const choose = (p) => setF({ ...f, preset: p.id, provider: p.provider, base_url: p.base_url, model: p.model || (p.id === f.preset ? f.model : ""), api_key: "" });
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    const isAnthropic = f.provider === "anthropic";
    const keyKept = saved && saved.provider === f.provider && saved.api_key_set;

    async function save(andTest) {
      setBusy(true); setError(null); setTest(null);
      try {
        const body = { preset: f.preset, provider: f.provider, base_url: f.base_url, model: f.model, effort: f.effort,
          api_key: f.api_key ? f.api_key : keyKept ? null : "" };
        const s = await api("PUT", "/settings", body);
        setSaved(s); setF({ ...f, api_key: "" }); refresh();
        if (andTest) setTest(await post("/settings/test"));
      } catch (e) { setError(e.message); }
      setBusy(false);
    }

    return html`<div class="stack" style=${{ maxWidth: 760 }}>
      <div class="page-head"><div><h1>ตั้งค่า LLM</h1>
        <p>ใช้สร้างชุดคำถาม ตอบคำถามจาก chunk ที่ค้นเจอ และให้คะแนนคำตอบ การวัด retrieval ไม่ต้องใช้ LLM</p></div></div>
      <div class="card">
        <div class="card-head"><h2>ผู้ให้บริการ</h2></div>
        <div class="card-pad actions">${presets.map((p) => html`<button key=${p.id} class=${"btn sm" + (f.preset === p.id ? " primary" : "")} onClick=${() => choose(p)}>${p.label}</button>`)}</div>
        <hr class="rule" />
        <div class="card-pad stack" style=${{ gap: 16 }}>
          <label class="field"><span>Base URL ${isAnthropic ? "(ว่างไว้ = api.anthropic.com)" : "(ต้องลงท้ายด้วย /v1 สำหรับ Ollama และ LM Studio)"}</span>
            <input class="input mono" placeholder=${isAnthropic ? "https://api.anthropic.com" : "http://localhost:11434/v1"} value=${f.base_url} onInput=${set("base_url")} /></label>
          <label class="field"><span>API key ${isAnthropic ? "" : "(Ollama และ LM Studio ไม่ต้องใส่)"}</span>
            <input class="input mono" type="password" autocomplete="off" value=${f.api_key} onInput=${set("api_key")}
              placeholder=${keyKept ? `บันทึกไว้แล้ว ${saved.api_key_hint} · พิมพ์ใหม่เพื่อเปลี่ยน` : isAnthropic ? "sk-ant-…" : "ไม่บังคับ"} /></label>
          <div class="form-grid" style=${{ gridTemplateColumns: isAnthropic ? "2fr 1fr" : "1fr" }}>
            <label class="field"><span>Model</span>
              <input class="input mono" value=${f.model} onInput=${set("model")} placeholder=${isAnthropic ? "claude-opus-5-5" : "เช่น qwen2.5:7b, llama3.1:8b, gpt-4.1-mini"} /></label>
            ${isAnthropic ? html`<label class="field"><span>Effort</span>
              <select class="input" value=${f.effort} onChange=${set("effort")}>${["low", "medium", "high"].map((x) => html`<option key=${x}>${x}</option>`)}</select></label>` : null}
          </div>
          ${f.preset === "ollama" ? html`<div class="small muted">ดึงโมเดลก่อนด้วย <span class="mono">ollama pull ${f.model || "qwen2.5:7b"}</span> ถ้า Ollama รันบน Windows แต่แอปนี้รันใน WSL และ localhost ต่อไม่ติด ให้ใช้ IP ของ Windows แทน หรือเปิด networkingMode=mirrored ใน .wslconfig</div>` : null}
          <div class="small muted">ค่าที่บันทึกเก็บใน <span class="mono">data/settings.json</span> บนเครื่องนี้ (ไฟล์นี้ไม่ถูก commit) ถ้าไม่ได้ตั้งค่าที่นี่ ระบบจะใช้ตัวแปรใน .env</div>
          <${Err} error=${error} />
          ${test ? html`<div class="notice">เชื่อมต่อได้ · <span class="mono">${test.model}</span> ตอบว่า “${test.reply}” ใน ${Math.round(test.ms)} ms</div>` : null}
          <div class="actions">
            <button class="btn primary" onClick=${() => save(true)} disabled=${busy || !f.model}>${busy ? "กำลังทดสอบ" : "บันทึกและทดสอบ"}</button>
            <button class="btn ghost" onClick=${() => save(false)} disabled=${busy}>บันทึกอย่างเดียว</button>
          </div>
        </div>
      </div>
      <div class="small muted">ถ้าใช้โมเดลเดียวกันทั้งตอบและให้คะแนน โมเดลอาจให้คะแนนตัวเองสูงเกินจริง โมเดลเล็กที่รันในเครื่องมักตัดสินภาษาไทยได้ไม่แม่น ควรสุ่มอ่านผลประกอบ</div>
    </div>`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();
