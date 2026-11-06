import { FileText, Gauge, ListChecks, Play, Settings2 } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useStatus } from "../status";
import { ThemeToggle } from "./ThemeToggle";

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="var(--text)" />
      <path d="M7 8v12M11.5 8v6M16 8v9M20.5 8v6" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="20.5" r="1.6" fill="var(--accent)" />
    </svg>
  );
}

export function Layout() {
  const { status, refresh } = useStatus();
  const { pathname } = useLocation();
  useEffect(refresh, [pathname, refresh]);
  const c = status?.counts;

  const nav = [
    { to: "/documents", label: "เอกสาร", Icon: FileText, count: c?.documents },
    { to: "/qa", label: "ชุดคำถาม", Icon: ListChecks, count: c?.qa },
    { to: "/bench", label: "Benchmark", Icon: Play },
    { to: "/runs", label: "ผลลัพธ์", Icon: Gauge, count: c?.runs },
    { to: "/settings", label: "ตั้งค่า LLM", Icon: Settings2 },
  ];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-row">
            <Mark />
            <span className="brand-name">RAG Eval</span>
            <ThemeToggle />
          </div>
          <div className="brand-sub">วัดผล RAG สำหรับเอกสารภาษาไทย</div>
        </div>
        <nav className="nav">
          {nav.map(({ to, label, Icon, count }) => (
            <NavLink key={to} to={to}>
              <Icon className="icon" />
              <span>{label}</span>
              {count != null && <em className="count" style={{ fontStyle: "normal" }}>{count}</em>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <NavLink to="/settings" className="row small sec" style={{ height: 20 }}>
            <span className={"dot" + (status?.llm_available ? " on" : "")} />
            <span className="ellipsis mono" style={{ fontSize: 12 }}>
              {status?.llm_available ? status.llm.model : "ยังไม่ได้ตั้งค่า LLM"}
            </span>
          </NavLink>
          <div className="meta" style={{ paddingLeft: 14 }}>embedding · {status?.device ?? "…"}</div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
