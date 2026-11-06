import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, X } from "lucide-react";
import { api, errorText } from "./api";
import { useStatus } from "./status";
import type { Job } from "./types";

/* Feedback for every action: toasts for results, and a tray for background jobs (imports,
   uploads, LLM generation, benchmark runs) that keeps running when you change pages and
   picks running jobs back up after a reload. */

type ToastKind = "ok" | "error" | "info";
interface Toast { id: number; kind: ToastKind; text: string }

interface Ctx {
  toast: (text: string, kind?: ToastKind) => void;
  /** watch a background job; onDone runs once when it finishes successfully */
  track: (job: Job, onDone?: (job: Job) => void) => void;
  jobs: Job[];
}

const FeedbackContext = createContext<Ctx>({ toast: () => {}, track: () => {}, jobs: [] });
export const useFeedback = () => useContext(FeedbackContext);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { refresh } = useStatus();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const callbacks = useRef(new Map<string, (j: Job) => void>());
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: ToastKind = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4500);
  }, []);

  const track = useCallback((job: Job, onDone?: (j: Job) => void) => {
    if (onDone) callbacks.current.set(job.id, onDone);
    setJobs((js) => [job, ...js.filter((j) => j.id !== job.id)]);
  }, []);

  // Pick up jobs that were already running (e.g. after a page reload).
  useEffect(() => {
    api.get<Job[]>("/jobs").then((list) => setJobs(list.filter((j) => j.status === "running"))).catch(() => {});
  }, []);

  const running = jobs.filter((j) => j.status === "running");
  useEffect(() => {
    if (!running.length) return;
    const t = setTimeout(async () => {
      const next = await Promise.all(running.map((j) => api.get<Job>("/jobs/" + j.id).catch(() => ({ ...j, status: "failed" as const, error: "เซิร์ฟเวอร์รีสตาร์ต งานนี้หยุดไปแล้ว" }))));
      for (const j of next) {
        if (j.status === "running") continue;
        if (j.status === "done") {
          toast(`${j.title || "งาน"} เสร็จแล้ว${j.message ? ` · ${j.message}` : ""}`);
          callbacks.current.get(j.id)?.(j);
        } else {
          toast(`${j.title || "งาน"} ไม่สำเร็จ: ${j.error ?? ""}`, "error");
        }
        callbacks.current.delete(j.id);
        refresh();
        // keep finished jobs visible in the tray for a moment
        setTimeout(() => setJobs((js) => js.filter((x) => x.id !== j.id)), 4000);
      }
      setJobs((js) => js.map((j) => next.find((n) => n.id === j.id) ?? j));
    }, 800);
    return () => clearTimeout(t);
  }, [jobs]);

  return (
    <FeedbackContext.Provider value={{ toast, track, jobs }}>
      {children}
      <div className="corner" aria-live="polite">
        {jobs.length > 0 && (
          <div className="tray card">
            <div className="tray-head">งานเบื้องหลัง {running.length ? `· ทำอยู่ ${running.length}` : ""}</div>
            {jobs.map((j) => (
              <div key={j.id} className="tray-job">
                <div className="row">
                  {j.status === "running" ? <span className="spin" /> : j.status === "done" ? <Check className="icon ok" /> : <CircleAlert className="icon err" />}
                  <span className="grow ellipsis">{j.title || j.kind}</span>
                  <span className="meta">{j.total ? `${j.done}/${j.total}` : ""}</span>
                </div>
                <div className="progress"><div style={{ transform: `scaleX(${j.status === "done" ? 1 : j.total ? j.done / j.total : 0.05})` }} /></div>
                <div className="meta ellipsis" title={j.error ?? j.message}>{j.error ?? j.message}</div>
              </div>
            ))}
          </div>
        )}
        {toasts.map((t) => (
          <div key={t.id} className={"toast card " + t.kind} role={t.kind === "error" ? "alert" : "status"}>
            {t.kind === "error" ? <CircleAlert className="icon err" /> : <Check className="icon ok" />}
            <span className="grow">{t.text}</span>
            <button className="btn ghost sm icon-only" aria-label="ปิด" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X className="icon" /></button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

/** Wrap an async action: pending state for the button, an error toast on failure,
 *  and an optional success toast. */
export function useAction() {
  const { toast } = useFeedback();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success?: string | ((r: T) => string)) => {
    setPending(key);
    try {
      const r = await fn();
      if (success) toast(typeof success === "function" ? success(r) : success);
      return r;
    } catch (e) {
      toast(errorText(e), "error");
      return undefined;
    } finally {
      setPending(null);
    }
  }, [toast]);
  return { run, pending, busy: (key: string) => pending === key };
}

/** Button content with a spinner while busy. */
export function Busy({ busy, children, label }: { busy: boolean; children: ReactNode; label?: string }) {
  return busy ? <><span className="spin" />{label ?? children}</> : <>{children}</>;
}
