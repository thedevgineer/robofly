import { useEffect, useState } from "react";
import { arxivUrl, githubUrl } from "./links";
import { FlyMark } from "./WorldView";

type Current = "home" | "playground" | "paper";

export function SiteNav({
  current,
  onHome,
  onExplore,
  hideMark = false,
}: {
  current: Current;
  onHome?: () => void;
  onExplore?: () => void;
  hideMark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const github = githubUrl();
  const arxiv = arxivUrl();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const home = (event: { preventDefault: () => void }) => {
    if (!onHome) return;
    event.preventDefault();
    onHome();
    setOpen(false);
  };
  const explore = (event: { preventDefault: () => void }) => {
    if (!onExplore) return;
    event.preventDefault();
    onExplore();
    setOpen(false);
  };
  const hardware = (event: { preventDefault: () => void }) => {
    if (!onHome) return;
    event.preventDefault();
    onHome();
    setOpen(false);
    window.setTimeout(() => document.getElementById("hardware")?.scrollIntoView({ behavior: "smooth" }), 80);
  };

  return (
    <header className={hideMark ? "site-nav no-mark" : "site-nav"}>
      <a className="site-mark" href="/" onClick={home} aria-label="RoboFly home" hidden={hideMark}>
        <FlyMark size={40} />
        <span>RoboFly</span>
      </a>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <i />
        <i />
      </button>
      <nav id="site-menu" className={open ? "site-links open" : "site-links"} aria-label="Site">
        <a
          href="/playground"
          className={current === "playground" ? "active" : undefined}
          aria-current={current === "playground" ? "page" : undefined}
          onClick={explore}
        >
          The Playground
        </a>
        <a href="/#hardware" onClick={hardware}>
          Hardware
        </a>
        <a href="/paper" className={current === "paper" ? "active" : undefined} aria-current={current === "paper" ? "page" : undefined}>
          Paper
        </a>
        {github ? (
          <a href={github} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        ) : null}
        {arxiv ? (
          <a href={arxiv} target="_blank" rel="noopener noreferrer">
            arXiv
          </a>
        ) : null}
        <a className="nav-cta" href="/playground" onClick={explore}>
          Open the playground
        </a>
      </nav>
    </header>
  );
}
