import type { ReactNode } from "react";
import { PageHead } from "../components/ui";

/* How the evaluation works, step by step, with the rule or formula behind each step and
   where it comes from. Written so someone can check the method, not only trust it. */

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="stepper-item done method">
      <span className="stepper-dot">{n}</span>
      <div className="card card-pad stack-16 method-card">
        <h2 className="method-title">{title}</h2>
        {children}
      </div>
    </li>
  );
}

const Formula = ({ children }: { children: ReactNode }) => <pre className="formula">{children}</pre>;
const Why = ({ children }: { children: ReactNode }) => <div className="why"><span className="meta">เหตุผล</span><div>{children}</div></div>;

/* The hit rule, drawn: the evidence span against three chunks. */
function HitRuleDiagram() {
  const W = 640, row = 34;
  const scale = (c: number) => 40 + c * 3.8; // characters → px, leaves room for the labels
  const ev = [30, 70];
  const cases = [
    { label: "ครอบ evidence ทั้งหมด", s: 10, e: 90, hit: true, note: "ทับ 40/40 ตัวอักษร" },
    { label: "ทับเกินครึ่งของ evidence", s: 48, e: 100, hit: true, note: "ทับ 22/40 = 55%" },
    { label: "แตะขอบนิดเดียว", s: 0, e: 36, hit: false, note: "ทับ 6/36 = 17%" },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${row * (cases.length + 1) + 28}`} className="diagram" role="img"
         aria-label="Evidence span compared with three chunk spans: two count as hits, one does not">
      <text x={scale(ev[0])} y={14} className="d-label">evidence</text>
      <rect x={scale(ev[0])} y={20} width={scale(ev[1]) - scale(ev[0])} height={10} rx={3} className="d-ev" />
      <line x1={scale(ev[0])} x2={scale(ev[0])} y1={20} y2={row * (cases.length + 1) + 6} className="d-guide" />
      <line x1={scale(ev[1])} x2={scale(ev[1])} y1={20} y2={row * (cases.length + 1) + 6} className="d-guide" />
      {cases.map((c, i) => {
        const y = 20 + row * (i + 1);
        return (
          <g key={i}>
            <rect x={scale(c.s)} y={y} width={scale(c.e) - scale(c.s)} height={14} rx={3} className={c.hit ? "d-hit" : "d-miss"} />
            <text x={scale(Math.max(c.e, ev[1])) + 12} y={y + 11} className="d-label">{c.hit ? "นับว่าเจอ" : "ไม่นับ"} · {c.note}</text>
          </g>
        );
      })}
      <text x={40} y={row * (cases.length + 1) + 22} className="d-label muted">chunk 3 แบบ เทียบกับ evidence เดียวกัน</text>
    </svg>
  );
}

export function MethodPage() {
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead title="วิธีการวัด"
                sub="ทุกตัวเลขในแอปมาจาก 6 ขั้นนี้ แต่ละขั้นมีหลักการที่ตรวจสอบได้ และอิงมาตรฐานที่งาน benchmark ด้าน retrieval ใช้กันทั่วไป" />

      <ol className="stepper">
        <Section n={1} title="ตัดเอกสารเป็น chunk โดยจำตำแหน่งตัวอักษร">
          <p>ทุก chunk เก็บตำแหน่งเริ่มและจบในเอกสารต้นฉบับ (start, end) ไม่ใช่แค่ข้อความ ขนาด chunk นับเป็นตัวอักษรเหมือนกันทุกวิธี จึงเทียบกันได้ตรง ๆ</p>
          <ul className="method-list">
            <li><b>char</b> ตัดทุก N ตัวอักษร เป็นเส้นฐาน ภาษาไทยไม่เว้นวรรคระหว่างคำ วิธีนี้จึงมักตัดกลางคำ</li>
            <li><b>word</b> ตัดคำด้วย PyThaiNLP (newmm) แล้วรวมคำจนเกือบเต็มขนาด ขอบ chunk จึงตรงขอบคำเสมอ</li>
            <li><b>recursive</b> แยกตามย่อหน้า แล้วบรรทัด วลีที่คั่นด้วยช่องว่าง และคำ ตามลำดับ แล้วรวมกลับให้เต็มขนาด</li>
          </ul>
          <Why>ต้องรู้ตำแหน่งจริงของ chunk ถึงจะตัดสินได้ในขั้นที่ 4 ว่า chunk ไหนมีคำตอบ โดยไม่ต้องเทียบข้อความแบบคร่าว ๆ</Why>
        </Section>

        <Section n={2} title="ชุดคำถามเก็บคำตอบเป็นตำแหน่ง ไม่ใช่เลข chunk">
          <p>แต่ละข้อมีคำถาม คำตอบอ้างอิง และ evidence คือข้อความในเอกสารที่ใช้ตอบ ตอนนำเข้า ระบบหาข้อความนี้ในเอกสารแล้วเก็บเป็นช่วงตัวอักษร (เอกสาร, start, end) ถ้าหาไม่เจอจะแจ้งแถวนั้นและไม่นำเข้า</p>
          <Why>
            เลข chunk เปลี่ยนทุกครั้งที่เปลี่ยนขนาดหรือวิธีตัด ถ้าเก็บคำตอบเป็นเลข chunk ต้องติดป้ายใหม่ทุกครั้ง
            การเก็บเป็นช่วงตัวอักษรทำให้ชุดคำถามชุดเดียวใช้วัดได้ทุก config แนวคิดเดียวกับ answer span ใน SQuAD
            และไฟล์ qrels ของ BEIR ที่ผูกคำตอบกับเนื้อหา ไม่ใช่กับวิธีแบ่ง
          </Why>
        </Section>

        <Section n={3} title="ค้นทีละคำถามและจับเวลา">
          <p>ทุก config ถูกสร้าง index ครั้งเดียว แล้วค้นทีละคำถามตามลำดับ เหมือนผู้ใช้จริงถามทีละครั้ง เวลาที่จับคือตั้งแต่รับคำถามจนได้รายการ chunk เรียงอันดับ (แปลงคำถามเป็น embedding และค้น) ไม่รวม LLM คำถามแรกใช้อุ่นเครื่องและไม่นับ</p>
          <Formula>{"latency_i = เวลาค้นของคำถามที่ i (ms)\np50, p90, p95, p99 = percentile ของ latency_1 … latency_N  (linear interpolation แบบ numpy)"}</Formula>
          <Why>p95 บอกว่าผู้ใช้ที่โชคไม่ดีรอนานแค่ไหน ค่าเฉลี่ยซ่อนกรณีช้าเหล่านี้ไว้ จึงไม่ใช้ค่าเฉลี่ยเป็นตัวหลัก</Why>
        </Section>

        <Section n={4} title="ตัดสินว่า chunk ไหนนับว่าเจอคำตอบ">
          <p>chunk ที่ค้นได้นับว่าเจอ เมื่อช่วงตัวอักษรของ chunk ทับกับ evidence อย่างน้อยครึ่งหนึ่งของช่วงที่สั้นกว่า</p>
          <Formula>{"overlap = max(0, min(chunk.end, ev.end) − max(chunk.start, ev.start))\nเจอ ⇔ overlap ≥ 0.5 × min(ความยาว chunk, ความยาว evidence)"}</Formula>
          <HitRuleDiagram />
          <Why>
            ใช้ “ช่วงที่สั้นกว่า” เพื่อให้ยุติธรรมทั้งสองทาง chunk เล็กที่อยู่ข้างใน evidence ยาว ๆ ยังนับว่าเจอ
            และ chunk ใหญ่ที่แค่แตะขอบ evidence ไม่นับ ส่วนการได้ข้อความครบหรือไม่ดูจาก Coverage แยกต่างหาก
          </Why>
        </Section>

        <Section n={5} title="คำนวณคะแนน">
          <p>ให้ rank_i คืออันดับแรกที่เจอของคำถามที่ i (ไม่เจอภายใน k สูงสุด = ∞) และ N คือจำนวนคำถาม</p>
          <Formula>{[
            "Hit@k      = (1/N) Σ 1[rank_i ≤ k]                          เรียกอีกชื่อว่า Hit Rate หรือ Recall@k",
            "MRR        = (1/N) Σ 1 / rank_i                             ไม่เจอ = 0",
            "nDCG@10    = (1/N) Σ DCG_i / IDCG_i,  DCG = Σ_{j≤10} rel_j / log₂(j+1)",
            "Coverage@k = (1/N) Σ |evidence_i ∩ (chunk_1 ∪ … ∪ chunk_k)| / |evidence_i|",
          ].join("\n")}</Formula>
          <Why>
            Hit Rate กับ MRR คือคู่ที่ LlamaIndex RetrieverEvaluator รายงาน nDCG@10 คือคะแนนหลักของ BEIR และ MTEB
            จึงเทียบกับตัวเลขที่คนอื่นเผยแพร่ได้ relevance ใน nDCG เป็นแบบ 0/1 ตามกฎขั้นที่ 4
          </Why>
        </Section>

        <Section n={6} title="ให้ LLM ตอบและตัดสิน (ไม่บังคับ)">
          <p>ส่ง chunk top k ให้ LLM ตอบ แล้วให้ LLM อีกรอบตัดสินสองเรื่อง ตอบถูกไหมเทียบกับคำตอบอ้างอิง (ถูก 1, ถูกบางส่วน 0.5, ผิด 0) และทุกข้อความในคำตอบอิงจาก chunk ที่ให้ไปหรือไม่</p>
          <Why>
            แนวเดียวกับ answer correctness และ faithfulness ของ RAGAS ข้อจำกัดคือ LLM ที่ตัดสินอาจลำเอียง
            โดยเฉพาะเมื่อใช้โมเดลเดียวกับที่ตอบ ควรสุ่มอ่านคำตัดสินประกอบ และให้น้ำหนักกับตัวเลข retrieval ในขั้นที่ 5 มากกว่า
          </Why>
        </Section>
      </ol>

      <div className="card card-pad stack-16">
        <h2 className="method-title">อ่านผลอย่างไรให้ไม่หลงตัวเลข</h2>
        <ul className="method-list">
          <li>เลือก config จาก Hit@k ที่ k เท่ากับจำนวน chunk ที่จะส่งให้ LLM จริง แล้วดูว่า p95 อยู่ในงบเวลาหรือไม่</li>
          <li>ชุดคำถามเล็ก ตัวเลขแกว่งมาก คำถาม 29 ข้อ แต่ละข้อมีน้ำหนัก 3.4 pt ความคลาดเคลื่อนโดยประมาณของ Hit@k คือ ±1.96 × √(p(1−p)/N) ที่ p = 90% และ N = 29 คือประมาณ ±11 pt ที่ N = 100 เหลือประมาณ ±6 pt</li>
          <li>คำถามควรใช้คำต่างจากเอกสาร ถ้าคัดลอกประโยคจากเอกสารมาเป็นคำถาม BM25 จะดูดีเกินจริง</li>
          <li>latency ขึ้นกับเครื่อง เทียบได้เฉพาะ config ที่รันบนเครื่องเดียวกันในรอบเดียวกัน</li>
        </ul>
      </div>

      <div className="card card-pad stack-8">
        <h2 className="method-title">อ้างอิง</h2>
        <ul className="method-list refs">
          <li>Thakur et al. 2021, <i>BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models</i> · <a href="https://github.com/beir-cellar/beir" target="_blank" rel="noreferrer">github.com/beir-cellar/beir</a></li>
          <li>Muennighoff et al. 2022, <i>MTEB: Massive Text Embedding Benchmark</i> · <a href="https://github.com/embeddings-benchmark/mteb" target="_blank" rel="noreferrer">github.com/embeddings-benchmark/mteb</a></li>
          <li>Es et al. 2023, <i>RAGAS: Automated Evaluation of Retrieval Augmented Generation</i> · <a href="https://docs.ragas.io" target="_blank" rel="noreferrer">docs.ragas.io</a></li>
          <li>LlamaIndex, Retrieval evaluation (hit rate, MRR) · <a href="https://docs.llamaindex.ai" target="_blank" rel="noreferrer">docs.llamaindex.ai</a></li>
          <li>Järvelin &amp; Kekäläinen 2002, <i>Cumulated gain-based evaluation of IR techniques</i> (nDCG)</li>
          <li>PyThaiNLP, ตัดคำภาษาไทย (newmm) · <a href="https://github.com/PyThaiNLP/pythainlp" target="_blank" rel="noreferrer">github.com/PyThaiNLP/pythainlp</a></li>
        </ul>
      </div>
    </div>
  );
}
