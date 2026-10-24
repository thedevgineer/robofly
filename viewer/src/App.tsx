import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchGraph } from "./api";
import { ChipMini, ChipView } from "./ChipView";
import { loadLive, type LiveFrame, type LiveSim } from "./live";
import { MOTOR_NAMES, populationIds, type ChipGraph, type EditorTool, type Frame, type Layout, type Scenario, type WorldPick } from "./types";
import { Icon } from "./icons";
import { WorldView, type CameraMode } from "./WorldView";

const TOOLS: { id: EditorTool; label: string }[] = [
  { id: "move", label: "Move" },
  { id: "wall", label: "Wall" },
  { id: "food", label: "Food" },
  { id: "enemy", label: "Enemy" },
  { id: "pad", label: "Pad" },
  { id: "erase", label: "Erase" },
];
const YARD_LINE = "A forest court. Place walls, food, pads, and hunters — or clear it and build from scratch.";

function flyStatus(frame: Frame): string {
  if (frame.downed) return "Caught";
  const rates = frame.motor_rates;
  if ((rates.escape ?? 0) >= 0.5 || frame.command.escape) return "Fleeing";
  if (frame.eaten) return "Ate";
  if ((rates.rest ?? 0) >= 0.5 || (rates.land ?? 0) >= 0.5 || frame.command.land) return "Resting";
  return "Searching";
}
function priorities(frame: Frame): [string, boolean][] {
  const rates = frame.motor_rates;
  const threat = (rates.escape ?? 0) >= 0.5 || Boolean(frame.command.escape);
  const foods = frame.foods ?? (frame.food ? [frame.food] : []);
  return [
    ["Predator", threat],
    ["Food", !threat && foods.length > 0],
    ["Pad", !threat && foods.length === 0],
  ];
}
const POSES = [
  ["auto", "Auto"],
  ["thrust", "Fly"],
  ["walk", "Walk"],
  ["groom_fore", "Fore groom"],
  ["groom_hind", "Hind groom"],
  ["groom_wing", "Wing groom"],
  ["feed", "Feed"],
  ["land", "Land"],
  ["rest", "Rest"],
] as const;
const SPEEDS = [0.5, 1, 2] as const;
const CAMERAS: { id: CameraMode; label: string }[] = [
  { id: "follow", label: "Follow" },
  { id: "orbit", label: "Orbit" },
  { id: "overview", label: "Overview" },
];
const SHORTCUTS: [string, string][] = [
  ["Space", "Play or pause"],
  ["1 to 6", "Move, Wall, Food, Enemy, Pad, Erase"],
  ["R", "Reload the Yard"],
  ["C", "Next camera"],
  ["M", "Open the chip"],
  ["?", "This list"],
  ["Esc", "Close"],
];
const CHIP_HINTS: [string, string][] = [
  ["Drag", "Orbit the die"],
  ["Shift-drag", "Pan the die"],
  ["Scroll", "Zoom the die"],
  ["View cube", "Snap orientation"],
  ["Double-click", "Reset die view"],
];
const WORLD_HINTS: [string, string][] = [
  ["Drag", "Orbit when not editing"],
  ["MMB / RMB", "Orbit always"],
];
const HISTORY = 480;
const TICK_MS = 50;
const WALL_METERS = { half: 1.175, full: 2.35 } as const;

export function App({ expanded = true, overlay }: { expanded?: boolean; overlay?: ReactNode }) {
  const [scenario, setScenario] = useState<Scenario>("yard");
  const [custom, setCustom] = useState(false);
  const [history, setHistory] = useState<LiveFrame[]>([]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [tool, setTool] = useState<EditorTool | null>(null);
  const [picked, setPicked] = useState<{ kind: WorldPick; index: number } | null>(null);
  const [focusIds, setFocusIds] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [poseName, setPoseName] = useState<string>("auto");
  const [actsOpen, setActsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallHeight, setWallHeight] = useState<"half" | "full">("half");
  const [caught, setCaught] = useState(false);
  const [chipOpen, setChipOpen] = useState(false);
  const [graph, setGraph] = useState<ChipGraph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [cameraMode, setCameraMode] = useState<CameraMode>("follow");
  const [cameraNonce, setCameraNonce] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const speedRef = useRef(1);
  const actions = useRef({ togglePlay: () => {}, restart: () => {}, nextCamera: () => {}, toggleChip: () => {} });
  const chipReturnFocus = useRef<HTMLElement | null>(null);
  const chipCloseRef = useRef<HTMLButtonElement | null>(null);
  const chipCardRef = useRef<HTMLDivElement | null>(null);
  speedRef.current = speed;
  const simRef = useRef<LiveSim | null>(null);
  const historyRef = useRef<LiveFrame[]>([]);
  const layoutRef = useRef<Layout | null>(null);
  const playingRef = useRef(false);
  const toolRef = useRef<EditorTool | null>(null);
  const downedRef = useRef(false);
  const lifeRef = useRef(0);
  layoutRef.current = layout;

  useEffect(() => {
    let cancelled = false;
    fetchGraph()
      .then((next) => {
        if (!cancelled) setGraph(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setGraphError(err instanceof Error ? err.message : "Could not load the chip");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!chipOpen) return;
    chipReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => chipCloseRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !chipCardRef.current) return;
      const nodes = chipCardRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      chipReturnFocus.current?.focus();
    };
  }, [chipOpen]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const slot = ["1", "2", "3", "4", "5", "6"].indexOf(event.key);
      if (event.key === "Escape") {
        setChipOpen(false);
        setHelpOpen(false);
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?") {
        setHelpOpen((value) => !value);
        return;
      }
      if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        actions.current.togglePlay();
        return;
      }
      const lower = event.key.toLowerCase();
      if (lower === "r") actions.current.restart();
      else if (lower === "c") actions.current.nextCamera();
      else if (lower === "m") actions.current.toggleChip();
      if (slot < 0 || downedRef.current) return;
      event.preventDefault();
      const name = TOOLS[slot].id;
      holdLayout();
      const next = toolRef.current === name ? null : name;
      toolRef.current = next;
      setTool(next);
      setEditOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        sim.reset("yard");
        simRef.current = sim;
        replace(sim.read(), sim.readLayout());
        setScenario("yard");
        playingRef.current = true;
        setPlaying(true);
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
      if (playingRef.current && !toolRef.current && simRef.current && !downedRef.current) {
        acc += elapsed * speedRef.current;
        if (acc > TICK_MS * 4) acc = TICK_MS * 4;
        const frames: LiveFrame[] = [];
        while (acc >= TICK_MS) {
          acc -= TICK_MS;
          simRef.current.step();
          frames.push(simRef.current.read());
        }
        if (frames.length) {
          remember(frames, true);
          const last = frames[frames.length - 1];
          if (last.downed && !downedRef.current) {
            downedRef.current = true;
            lifeRef.current += 1;
            setCountdown(5);
            setCaught(true);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready]);

  useEffect(() => {
    if (!caught) return;
    const life = lifeRef.current;
    const started = performance.now();
    const timer = window.setInterval(() => {
      if (lifeRef.current !== life || !downedRef.current) {
        window.clearInterval(timer);
        return;
      }
      const left = 5 - (performance.now() - started) / 1000;
      if (left <= 0) {
        window.clearInterval(timer);
        const sim = simRef.current;
        if (sim && downedRef.current && lifeRef.current === life) {
          sim.respawn();
          remember([sim.read()], true);
        }
        downedRef.current = false;
        setCaught(false);
        return;
      }
      setCountdown(Math.ceil(left));
    }, 100);
    return () => window.clearInterval(timer);
  }, [caught]);

  function holdLayout() {
    if (downedRef.current) return;
    const frame = historyRef.current[historyRef.current.length - 1];
    const current = layoutRef.current;
    if (!frame || !current) {
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    setLayout({
      ...current,
      pose: { x: frame.pose.x, y: frame.pose.y, z: frame.pose.z, yaw: frame.pose.yaw, pitch: frame.pose.pitch },
      foods: frame.foods ?? (frame.food ? [frame.food] : []),
      threats: frame.predators ?? (frame.predator ? [frame.predator] : []),
    });
    playingRef.current = false;
    setPlaying(false);
  }

  function selectTool(name: EditorTool) {
    if (downedRef.current) return;
    holdLayout();
    const next = toolRef.current === name ? null : name;
    toolRef.current = next;
    setTool(next);
    setActsOpen(false);
  }

  function begin(name: Scenario = "yard") {
    const sim = simRef.current;
    if (!sim) return;
    setError(null);
    downedRef.current = false;
    lifeRef.current += 1;
    setCaught(false);
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
    setActsOpen(false);
    setEditOpen(false);
    setPlaying(true);
  }

  function clearScene() {
    const sim = simRef.current;
    if (!sim) return;
    setError(null);
    downedRef.current = false;
    lifeRef.current += 1;
    setCaught(false);
    sim.reset("yard");
    const yard = sim.readLayout();
    const empty: Layout = {
      room: yard.room,
      foods: [],
      threats: [],
      landings: [],
      obstacles: [],
      pose: {
        x: (yard.room.min_x + yard.room.max_x) / 2,
        y: (yard.room.min_y + yard.room.max_y) / 2,
        z: yard.pose.z,
        yaw: yard.pose.yaw,
        pitch: 0,
      },
    };
    try {
      sim.setLayout(empty);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "layout was rejected");
      return;
    }
    replace(sim.read(), sim.readLayout());
    setScenario("yard");
    setCustom(true);
    setEditOpen(true);
    toolRef.current = "move";
    setTool("move");
    setPicked(null);
    setFocusIds([]);
    setPoseName("auto");
    setActsOpen(false);
    playingRef.current = false;
    setPlaying(false);
  }

  function choosePose(name: string) {
    const sim = simRef.current;
    if (!sim) return;
    const index = MOTOR_NAMES.indexOf(name as (typeof MOTOR_NAMES)[number]);
    sim.setHold(name === "auto" || index < 0 ? 0 : index + 1);
    setPoseName(name);
    toolRef.current = null;
    setTool(null);
    setActsOpen(false);
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
    playingRef.current = false;
    replace(sim.read(), sim.readLayout());
    setCustom(true);
    setPoseName("auto");
    setPlaying(false);
  }

  function togglePlay() {
    if (downedRef.current) return;
    setActsOpen(false);
    if (playingRef.current) {
      toolRef.current = null;
      setTool(null);
      holdLayout();
      return;
    }
    toolRef.current = null;
    setTool(null);
    setIndex(Math.max(0, historyRef.current.length - 1));
    playingRef.current = true;
    setPlaying(true);
  }

  function stopPlaying() {
    if (playingRef.current) holdLayout();
    else {
      playingRef.current = false;
      setPlaying(false);
    }
  }

  function stepBack() {
    stopPlaying();
    setIndex((current) => Math.max(0, current - 1));
  }

  function stepOnce() {
    const sim = simRef.current;
    if (!sim || downedRef.current) return;
    stopPlaying();
    sim.step();
    remember([sim.read()], true);
  }

  function scrubTo(next: number) {
    stopPlaying();
    setIndex(next);
  }

  function nextCamera() {
    const at = CAMERAS.findIndex((item) => item.id === cameraMode);
    setCameraMode(CAMERAS[(at + 1) % CAMERAS.length].id);
  }

  actions.current = {
    togglePlay,
    restart: () => begin("yard"),
    nextCamera,
    toggleChip: () => setChipOpen((value) => !value),
  };

  useEffect(() => {
    const onHide = () => {
      if (document.hidden && playingRef.current) holdLayout();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const frame = history[index];
  const previous = index > 0 ? history[index - 1] : undefined;
  const trail = history.slice(Math.max(0, index - 90), index + 1);
  const lastIndex = Math.max(0, history.length - 1);

  return (
    <div className={expanded ? "flight expanded" : "flight"}>
      <div className="explorer-bar flight-bar" inert={!expanded}>
        <div className="explorer-line instrument playground-rail">
          <div className="playground-identity">
            <strong>The Playground</strong>
            <p className="scene-blurb">{custom ? "Empty room — build with the edit tools." : YARD_LINE}</p>
          </div>
          <nav className="playground-actions" aria-label="Playground room">
            <button
              type="button"
              className={!custom ? "instrument-btn active" : "instrument-btn"}
              disabled={!ready}
              onClick={() => begin("yard")}
            >
              <Icon name="yard" />
              Yard
            </button>
            <button type="button" className="instrument-btn" disabled={!ready} onClick={clearScene}>
              Clear scene
            </button>
            <button
              type="button"
              className={editOpen ? "instrument-btn pressed" : "instrument-btn"}
              disabled={!ready}
              onClick={() => {
                setEditOpen((value) => !value);
                setActsOpen(false);
              }}
            >
              {editOpen ? "Close edit" : "Edit room"}
            </button>
          </nav>
        </div>
        {error ? <p className="error bar-error">{error}</p> : null}
        {editOpen ? (
          <div className="edit-row">
            <button
              type="button"
              className={actsOpen ? "instrument-btn active" : "instrument-btn"}
              disabled={!ready}
              onClick={() => setActsOpen((value) => !value)}
            >
              Pose
            </button>
            {actsOpen
              ? POSES.map(([name, label]) => (
                  <button
                    key={name}
                    type="button"
                    className={poseName === name ? "instrument-btn active" : "instrument-btn"}
                    disabled={!ready}
                    onClick={() => choosePose(name)}
                  >
                    {label}
                  </button>
                ))
              : null}
          </div>
        ) : null}
      </div>
      <section className="flight-stage">
        <main className="stage">
          <div className="world">
            {frame && layout ? (
              <WorldView
                frame={frame}
                layout={layout}
                trail={trail}
                playing={playing}
                tool={tool}
                picked={picked}
                poseName={poseName}
                scene={scenario}
                onPreview={setLayout}
                onCommit={onCommit}
                onPick={(pick) => {
                  setPicked(pick);
                  setFocusIds(pick ? populationIds(pick.kind) : []);
                }}
                onReject={setError}
                wallHeight={WALL_METERS[wallHeight]}
                cameraMode={cameraMode}
                cameraNonce={cameraNonce}
                pageScroll={!expanded}
              />
            ) : (
              <div className="empty brand-empty">
                <strong>RoboFly</strong>
                {error ? <p className="error">{error}</p> : <span>Loading the yard…</span>}
              </div>
            )}
          </div>
          {!expanded ? overlay : null}
          {expanded && frame ? (
            <>
              <div className="hud-card" aria-live="off">
                <strong className="status-word">{flyStatus(frame)}</strong>
                <span>
                  <em>speed</em> {frame.pose.speed.toFixed(3)}
                </span>
                <span>
                  <em>height</em> {frame.pose.z.toFixed(2)} m
                </span>
              </div>
              <ol className="priority-ribbon" aria-label="Fly priority">
                {priorities(frame).map(([name, lit]) => (
                  <li key={name} className={lit ? "lit" : undefined}>
                    {name}
                  </li>
                ))}
              </ol>
              {editOpen ? (
                <div className="tool-palette" role="toolbar" aria-label="Edit tools">
                  {TOOLS.map((item, slot) => (
                    <button
                      key={item.id}
                      type="button"
                      className={tool === item.id ? "active" : undefined}
                      disabled={!ready || !layout}
                      onClick={() => selectTool(item.id)}
                    >
                      <Icon name={item.id} />
                      {item.label}
                      <kbd>{slot + 1}</kbd>
                    </button>
                  ))}
                  <div className="palette-split" role="group" aria-label="Wall height">
                    <span>Wall</span>
                    <button type="button" className={wallHeight === "half" ? "active" : undefined} onClick={() => setWallHeight("half")}>
                      Half
                    </button>
                    <button type="button" className={wallHeight === "full" ? "active" : undefined} onClick={() => setWallHeight("full")}>
                      Full
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="scene-dock" role="toolbar" aria-label="Playback and camera">
                <button type="button" className="dock-main" onClick={togglePlay} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>
                  <Icon name={playing ? "pause" : "play"} />
                  {playing ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={stepOnce} disabled={!ready}>
                  <Icon name="step" />
                  Step
                </button>
                <span className="dock-group" role="group" aria-label="Speed">
                  {SPEEDS.map((value) => (
                    <button key={value} type="button" className={speed === value ? "active" : undefined} onClick={() => setSpeed(value)}>
                      {value}x
                    </button>
                  ))}
                </span>
                <button type="button" onClick={() => begin("yard")} disabled={!ready}>
                  <Icon name="reset" />
                  Yard
                </button>
                <span className="dock-group" role="group" aria-label="Camera">
                  {CAMERAS.map((item) => (
                    <button key={item.id} type="button" className={cameraMode === item.id ? "active" : undefined} onClick={() => setCameraMode(item.id)} title={item.label}>
                      <Icon name={item.id} />
                      {item.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setCameraMode("follow"); setCameraNonce((value) => value + 1); }}>
                    <Icon name="recenter" />
                    Recenter
                  </button>
                </span>
                <button type="button" onClick={() => setHelpOpen((value) => !value)} aria-label="Keyboard shortcuts">
                  ?
                </button>
              </div>
              {helpOpen ? (
                <div className="help-overlay" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(false)}>
                  <dl onClick={(event) => event.stopPropagation()}>
                    {SHORTCUTS.map(([key, text]) => (
                      <div key={key}>
                        <dt>
                          <kbd>{key}</kbd>
                        </dt>
                        <dd>{text}</dd>
                      </div>
                    ))}
                    <div className="help-section">
                      <dt />
                      <dd>Yard camera</dd>
                    </div>
                    {WORLD_HINTS.map(([key, text]) => (
                      <div key={key}>
                        <dt>
                          <kbd>{key}</kbd>
                        </dt>
                        <dd>{text}</dd>
                      </div>
                    ))}
                    <div className="help-section">
                      <dt />
                      <dd>Chip die</dd>
                    </div>
                    {CHIP_HINTS.map(([key, text]) => (
                      <div key={key}>
                        <dt>
                          <kbd>{key}</kbd>
                        </dt>
                        <dd>{text}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </>
          ) : null}
          {frame && !chipOpen ? (
            <ChipMini frame={frame} graph={graph} onOpen={() => setChipOpen(true)} corner={expanded ? "left" : "right"} />
          ) : null}
          {caught ? (
            <div className="death-modal" role="dialog" aria-label="Caught">
              <div className="death-card">
                <strong>Caught</strong>
                <p>
                  Respawn in <span className="death-count">{countdown}</span>
                </p>
              </div>
            </div>
          ) : null}
        </main>
      </section>
      {expanded && frame && !chipOpen ? (
        <div className="playground-chip">
          <ChipView
            presentation="breakdown"
            open
            onClose={() => undefined}
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
            graph={graph}
            graphError={graphError}
          />
        </div>
      ) : null}
      {frame && chipOpen ? (
        <div
          className="chip-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Chip view"
          onClick={() => setChipOpen(false)}
        >
          <div ref={chipCardRef} className="chip-modal-card" onClick={(event) => event.stopPropagation()}>
            <ChipView
              presentation="modal"
              open
              onClose={() => setChipOpen(false)}
              closeRef={chipCloseRef}
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
              graph={graph}
              graphError={graphError}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
