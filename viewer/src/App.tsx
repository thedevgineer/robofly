import { useEffect, useRef, useState } from "react";
import { ChipView } from "./ChipView";
import { loadLive, type LiveFrame, type LiveSim } from "./live";
import { MOTOR_NAMES, SCENARIOS, populationIds, type EditorTool, type Layout, type Scenario, type WorldPick } from "./types";
import { WorldView } from "./WorldView";

const TOOLS: EditorTool[] = ["move", "wall", "food", "enemy", "pad", "erase"];
const POSES = [
  ["auto", "Auto"],
  ["thrust", "Fly"],
  ["walk", "Walk"],
  ["groom_fore", "Fore"],
  ["groom_hind", "Hind"],
  ["groom_wing", "Wing"],
  ["feed", "Feed"],
  ["land", "Land"],
  ["rest", "Rest"],
] as const;
const HISTORY = 480;
const TICK_MS = 50;

export function App() {
  const [scenario, setScenario] = useState<Scenario>("food");
  const [custom, setCustom] = useState(false);
  const [history, setHistory] = useState<LiveFrame[]>([]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [tool, setTool] = useState<EditorTool | null>(null);
  const [picked, setPicked] = useState<{ kind: WorldPick; index: number } | null>(null);
  const [focusIds, setFocusIds] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [poseName, setPoseName] = useState<string>("auto");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const simRef = useRef<LiveSim | null>(null);
  const historyRef = useRef<LiveFrame[]>([]);
  const playingRef = useRef(false);
  const toolRef = useRef<EditorTool | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  function remember(frames: LiveFrame[], follow: boolean) {
    const next = historyRef.current.concat(frames).slice(-HISTORY);
    historyRef.current = next;
    setHistory(next);
    if (follow) setIndex(next.length - 1);
  }

  function replace(frame: LiveFrame, nextLayout: Layout) {
    historyRef.current = [frame];
    setHistory([frame]);
    setLayout(nextLayout);
    setIndex(0);
  }

  useEffect(() => {
    let cancelled = false;
    loadLive()
      .then((sim) => {
        if (cancelled) return;
        sim.reset("food");
        simRef.current = sim;
        replace(sim.read(), sim.readLayout());
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the live tick");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!playing || !ready) return;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const loop = (now: number) => {
      const elapsed = now - last;
      last = now;
      if (playingRef.current && !toolRef.current && simRef.current) {
        acc += elapsed;
        if (acc > TICK_MS * 2) acc = TICK_MS * 2;
        const frames: LiveFrame[] = [];
        while (acc >= TICK_MS) {
          acc -= TICK_MS;
          simRef.current.step();
          frames.push(simRef.current.read());
        }
        if (frames.length) remember(frames, true);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready]);

  function begin(name: Scenario) {
    const sim = simRef.current;
    if (!sim) return;
    setError(null);
    playingRef.current = true;
    toolRef.current = null;
    sim.reset(name);
    replace(sim.read(), sim.readLayout());
    setScenario(name);
    setCustom(false);
    setTool(null);
    setPicked(null);
    setFocusIds([]);
    setPoseName("auto");
    setPlaying(true);
  }

  function choosePose(name: string) {
    const sim = simRef.current;
    if (!sim) return;
    const index = MOTOR_NAMES.indexOf(name as (typeof MOTOR_NAMES)[number]);
    sim.setHold(name === "auto" || index < 0 ? 0 : index + 1);
    setPoseName(name);
    toolRef.current = null;
    setTool(null);
    playingRef.current = true;
    setPlaying(true);
  }

  function onCommit(next: Layout) {
    const sim = simRef.current;
    if (!sim) return;
    setError(null);
    try {
      sim.setLayout(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "layout was rejected");
      return;
    }
    playingRef.current = true;
    toolRef.current = null;
    replace(sim.read(), sim.readLayout());
    setCustom(true);
    setTool(null);
    setPoseName("auto");
    setPlaying(true);
  }

  function togglePlay() {
    setTool(null);
    toolRef.current = null;
    if (!playing) setIndex(lastIndex);
    playingRef.current = !playing;
    setPlaying((value) => !value);
  }

  function stepBack() {
    playingRef.current = false;
    setPlaying(false);
    setIndex((current) => Math.max(0, current - 1));
  }

  function stepOnce() {
    const sim = simRef.current;
    if (!sim) return;
    playingRef.current = false;
    setPlaying(false);
    sim.step();
    remember([sim.read()], true);
  }

  function scrubTo(next: number) {
    playingRef.current = false;
    setPlaying(false);
    setIndex(next);
  }

  const frame = history[index];
  const previous = index > 0 ? history[index - 1] : undefined;
  const trail = history.slice(Math.max(0, index - 90), index + 1);
  const lastIndex = Math.max(0, history.length - 1);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <strong>RoboFly</strong>
          <span>{custom ? "custom" : scenario}</span>
        </div>
        <label>
          Scenario
          <select
            value={scenario}
            onChange={(event) => begin(event.target.value as Scenario)}
            disabled={!ready}
          >
            {SCENARIOS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => begin(scenario)} disabled={!ready}>
          Run
        </button>
        <button type="button" onClick={togglePlay} disabled={!ready}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={stepBack} disabled={index <= 0}>
          Back
        </button>
        <button type="button" onClick={stepOnce} disabled={!ready}>
          Step
        </button>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={lastIndex}
          value={Math.min(index, lastIndex)}
          disabled={!ready}
          onChange={(event) => scrubTo(Number(event.target.value))}
          aria-label="Live step"
        />
        {error ? <p className="error">{error}</p> : null}
      </header>
      <main className="stage">
        <section className="world">
          <div className="tools">
            {TOOLS.map((name) => (
              <button
                key={name}
                type="button"
                className={tool === name ? "active" : undefined}
                disabled={!ready || !layout}
                onClick={() => {
                  playingRef.current = false;
                  setPlaying(false);
                  const next = tool === name ? null : name;
                  toolRef.current = next;
                  setTool(next);
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="poses">
            {POSES.map(([name, label]) => (
              <button
                key={name}
                type="button"
                className={poseName === name ? "active" : undefined}
                disabled={!ready}
                onClick={() => choosePose(name)}
              >
                {label}
              </button>
            ))}
          </div>
          {frame && layout ? (
            <WorldView
              frame={frame}
              layout={layout}
              trail={trail}
              tool={tool}
              picked={picked}
              poseName={poseName}
              onPreview={setLayout}
              onCommit={onCommit}
              onPick={(pick) => {
                setPicked(pick);
                setFocusIds(pick ? populationIds(pick.kind) : []);
              }}
              onReject={setError}
            />
          ) : (
            <p className="empty">{error ?? "Loading the live tick…"}</p>
          )}
        </section>
        {frame ? (
          <ChipView
            frame={frame}
            previousCycles={previous?.cycles ?? 0}
            focusIds={focusIds}
            onFocus={setFocusIds}
            playing={playing}
            ready={ready}
            index={Math.min(index, lastIndex)}
            lastIndex={lastIndex}
            onTogglePlay={togglePlay}
            onBack={stepBack}
            onStep={stepOnce}
            onScrub={scrubTo}
          />
        ) : (
          <aside className="chip">
            <p className="empty">{error ?? "Chip clock appears with the live tick."}</p>
          </aside>
        )}
      </main>
    </div>
  );
}
