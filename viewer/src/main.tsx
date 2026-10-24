import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Home } from "./Home";
import { Paper } from "./Paper";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root missing");

function pathName() {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path || "/";
}

function Root() {
  const [path, setPath] = useState(pathName);
  useEffect(() => {
    const sync = () => setPath(pathName());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const go = (next: string) => {
    if (pathName() !== next) history.pushState({}, "", next);
    setPath(next);
  };

  useEffect(() => {
    if (path === "/explorer") {
      history.replaceState({}, "", "/playground");
      setPath("/playground");
      return;
    }
    if (path === "/whitepaper") {
      history.replaceState({}, "", "/");
      setPath("/");
    }
  }, [path]);

  if (path === "/explorer" || path === "/whitepaper") return null;
  if (path === "/paper") return <Paper />;
  return (
    <Home expanded={path === "/playground"} onExplore={() => go("/playground")} onHome={() => go("/")} />
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
