import { useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const KEY = "rag-eval-theme";

function current(): Theme {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/* Theme switch that spreads the new theme out from where you clicked, like a drop of ink
   on paper: a circular clip of the new page snapshot grows over the old one. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(current);

  function toggle(e: MouseEvent<HTMLButtonElement>) {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const apply = () => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch { /* private mode: theme just won't persist */ }
      flushSync(() => setTheme(next));
    };

    const doc = document as ViewTransitionDoc;
    if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply();
      return;
    }

    // Keyboard activation reports 0,0, so start from the button's centre instead.
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX || box.left + box.width / 2;
    const y = e.clientY || box.top + box.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    doc.startViewTransition(apply).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  }

  const label = theme === "dark" ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด";
  return (
    <button className="btn ghost sm icon-only theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? <Sun className="icon" /> : <Moon className="icon" />}
    </button>
  );
}
