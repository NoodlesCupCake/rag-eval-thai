export interface Span {
  doc_id: string;
  start: number;
  end: number;
}

export interface Doc {
  id: string;
  name: string;
  chars: number;
  created_at: number;
}

export interface DocFull {
  id: string;
  name: string;
  text: string;
  created_at: number;
}

export interface ChunkView extends Span {
  id: string;
  text: string;
  cut_start: boolean;
  cut_end: boolean;
}

export interface ChunkPreview {
  chunks: ChunkView[];
  mid_word: number;
  stats: { n: number; avg: number; min: number; max: number };
}

export interface QA {
  id: string;
  question: string;
  answer: string;
  evidence: Span[];
  source: string;
  doc_name: string | null;
  evidence_text: string;
  /** chunks the evidence falls in, for the chunking config the list was requested with */
  chunks?: { id: string; doc_id: string; number: number }[];
}

export interface QASet {
  id: string;
  name: string;
  count: number;
  created_at: number;
}

export type Provider = "anthropic" | "openai";

export interface LLMSettings {
  preset: string;
  provider: Provider;
  base_url: string;
  model: string;
  effort: string;
  api_key_set: boolean;
  api_key_hint: string;
}

export interface Preset {
  id: string;
  label: string;
  provider: Provider;
  base_url: string;
  model: string;
}

export interface ConnectionTest {
  ok: boolean;
  models: string[];
  model: string;
  reply: string | null;
  ms: number | null;
  note: string | null;
}

export interface Status {
  llm_available: boolean;
  default_model: string;
  llm: LLMSettings;
  device: string;
  strategies: string[];
  retrievers: string[];
  suggested_models: { id: string; note: string; params_m?: number; download_mb?: number }[];
  counts: { documents: number; qa: number; qa_sets?: number; runs: number };
}

export interface Job {
  id: string;
  kind: "run" | "generate" | "import" | "upload";
  title?: string;
  result?: unknown;
  status: "running" | "done" | "failed";
  done: number;
  total: number;
  message: string;
  error: string | null;
  run_id?: string;
}

/** hit@1..k, mrr, coverage@k, latency_p50_ms, answer_correctness, ... */
export type Metrics = Record<string, number | undefined>;

export interface Judge {
  verdict: "correct" | "partial" | "incorrect";
  grounded: boolean;
  reason: string;
}

export interface PerQuestion {
  qa_id: string;
  latency_ms: number;
  hit_rank: number | null;
  coverage: Record<string, number>;
  /** ids ("<doc_id>:<index>") of the chunks that contain the answer under this config */
  gold?: string[];
  retrieved: (Span & { score: number; chunk?: string })[];
  answer?: string;
  gen_latency_ms?: number;
  judge?: Judge;
  gen_error?: string;
}

export interface ChunkCfg {
  strategy: string;
  size: number;
  overlap: number;
}

export interface RetrieverCfg {
  type: string;
  model: string | null;
}

export interface Result {
  label: string;
  chunking: ChunkCfg;
  retriever: RetrieverCfg;
  n_chunks: number;
  avg_chunk_chars: number;
  index_seconds: number;
  /** dense and hybrid only: the embedding model's vector size and encoding speed */
  embedding?: { model: string; dim: number; device: string; cached: boolean; encode_seconds: number; chunks_per_sec: number | null } | null;
  metrics: Metrics;
  latencies: number[];
  per_question: PerQuestion[];
}

export interface Run {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
  created_at: number;
  finished_at: number | null;
  spec: {
    k_max: number;
    chunkings: ChunkCfg[];
    retrievers: RetrieverCfg[];
    generation?: { enabled: boolean; top_k: number; model: string | null };
  };
  n_questions: number;
  qa_set?: { id: string; name: string };
  results: Result[];
  error: string | null;
  doc_names: Record<string, string>;
  questions?: Record<string, { question: string; answer: string; evidence: Span[] }>;
}

export interface SummaryRow {
  label: string;
  [metric: string]: number | string | undefined;
}

export interface RunSummary {
  id: string;
  name: string;
  status: Run["status"];
  created_at: number;
  n_configs: number;
  n_questions: number;
  qa_set?: { id: string; name: string };
  summary: SummaryRow[];
}
