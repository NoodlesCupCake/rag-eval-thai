import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import type { Job } from "../types";

export function PageHead({ title, sub, back, children }: { title: ReactNode; sub?: ReactNode; back?: { to: string; label: string }; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <Link to={back.to} className="back">
            <ChevronLeft className="icon" />
            {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  return error ? <div className="notice error">{error}</div> : null;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function JobProgress({ job, unit }: { job: Job | null; unit?: string }) {
  if (!job) return null;
  const f = job.total ? job.done / job.total : 0;
  return (
    <div className="stack-8">
      <div className="progress">
        <div style={{ transform: `scaleX(${f})` }} />
      </div>
      <div className="meta">
        {job.done}/{job.total} {unit} {job.message && `· ${job.message}`}
      </div>
    </div>
  );
}

/** A config label like "word·400/50 · dense:multilingual-e5-small", set in mono with a quiet separator. */
export function CfgLabel({ label }: { label: string }) {
  const [chunk, ret] = label.split(" · ");
  return (
    <span className="cfg-label">
      {chunk}
      {ret && <span className="sep">·</span>}
      {ret}
    </span>
  );
}
