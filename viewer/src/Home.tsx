import { useEffect, useRef, useState, type ReactNode } from "react";
import { App } from "./App";
import { arxivUrl, githubUrl, pumpCoinUrl, pumpMintSet } from "./links";
import { SiteNav } from "./SiteNav";
import { Escape, Tick } from "./figures";
import { FlyMark } from "./WorldView";

const SPECS = [
  ["256", "neurons"],
  ["670", "synapses"],
  ["50 ms", "control tick"],
  ["82 KB", "wasm controller"],
  ["2", "boards, Arduino and Raspberry Pi"],
];

const TABS = [
  {
    id: "playground",
    label: "Playground",
    line: "A live custom space to place walls, food, pads, and hunters, and play with the digital twin of the physical chip — flies, bees, and food included.",
  },
  {
    id: "escape",
    label: "Escape",
    line: "Eight loom bins drive a reduced giant-fiber chain. The fly turns away from the threat in one tick.",
  },
  {
    id: "search",
    label: "Search",
    line: "Food scent follows walking distance through the maze. Antennae read the downhill heading around every wall.",
  },
  {
    id: "land",
    label: "Land",
    line: "With no food left, contact on a pad settles the fly. A catch respawns it on a random pad.",
  },
  {
    id: "genome",
    label: "Genome",
    line: "256 cells hold the escape chain. Cruise, walls, and altitude stay in the body plant beside it.",
  },
  {
    id: "hardware",
    label: "Hardware",
    line: "Creator fees fund a physical chip from the tested Pi and Arduino designs. Fee claiming runs via GitHub.",
  },
];
const ROTATE_MS = 5500;

const PI_PINS: [string, string][] = [
  ["GPIO 17", "loom range"],
  ["GPIO 27", "threat bearing"],
  ["GPIO 12", "PWM, thrust"],
  ["GPIO 13", "PWM, yaw one way"],
  ["GPIO 18", "PWM, yaw other way"],
  ["GPIO 22", "digital, escape"],
];

const ARDUINO_PINS: [string, string][] = [
  ["A0", "loom range"],
  ["A1", "threat bearing"],
  ["D5", "PWM, thrust"],
  ["D6", "PWM, yaw one way"],
  ["D9", "PWM, yaw other way"],
  ["D3", "digital, escape"],
];

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      node.classList.add("in");
      return;
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          node.classList.add("in");
          watch.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    watch.observe(node);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={ref} className={className ? `reveal ${className}` : "reveal"}>
      {children}
    </div>
  );
}

export function Home({
  expanded,
  onExplore,
  onHome,
}: {
  expanded: boolean;
  onExplore: () => void;
  onHome: () => void;
}) {
  const open = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onExplore();
    setMenuOpen(false);
  };
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const still = hover || pinned;
  const pumpHref = pumpCoinUrl();
  const hasMint = pumpMintSet();
  const github = githubUrl();
  const arxiv = arxivUrl();
  useEffect(() => {
    if (still || expanded) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % TABS.length), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [active, still, expanded]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const tab = TABS[active];
  const goHome = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onHome();
    setMenuOpen(false);
  };
  const goHardware = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onHome();
    setMenuOpen(false);
    window.setTimeout(() => document.getElementById("hardware")?.scrollIntoView({ behavior: "smooth" }), 80);
  };

  return (
    <div className={expanded ? "company home-page expanded" : "company home-page"}>
      {expanded ? <SiteNav current="playground" onHome={onHome} onExplore={onExplore} hideMark /> : null}
      {expanded ? null : (
        <header className="hero">
          <div className="hero-top">
            <a className="hero-brand" href="/" onClick={goHome} aria-label="RoboFly home">
              <FlyMark size={132} />
              <div>
                <h1 className="hero-name">RoboFly</h1>
                <p className="hero-line">A fly brain for a robot you already have.</p>
              </div>
            </a>
            <button
              type="button"
              className="nav-toggle"
              aria-expanded={menuOpen}
              aria-controls="hero-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <i />
              <i />
            </button>
            <nav id="hero-menu" className={menuOpen ? "site-links hero-links open" : "site-links hero-links"} aria-label="Site">
              <a href="/playground" onClick={open}>
                The Playground
              </a>
              <a href="/#hardware" onClick={goHardware}>
                Hardware
              </a>
              <a href="/paper">Paper</a>
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
              <a className="nav-cta" href="/playground" onClick={open}>
                Open the playground
              </a>
            </nav>
          </div>
          <div className="hero-panel" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
            <div className="hero-tabs" role="tablist" aria-label="What RoboFly does">
              {TABS.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={index === active}
                  className={index === active ? "hero-tab active" : "hero-tab"}
                  onClick={() => {
                    if (index === active) setPinned((value) => !value);
                    else {
                      setActive(index);
                      setPinned(true);
                    }
                  }}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                >
                  <span>{item.label}</span>
                  {index === active ? (
                    <i key={`${active}:${pinned}`} className={still ? "tab-progress still" : "tab-progress"} style={{ animationDuration: `${ROTATE_MS}ms` }} />
                  ) : null}
                </button>
              ))}
            </div>
            <p className="hero-desc" key={tab.id} role="tabpanel" aria-live="off">
              {tab.line}{" "}
              <a href={tab.id === "playground" ? "/playground" : `#${tab.id}`} onClick={tab.id === "playground" ? open : undefined}>
                {tab.id === "playground" ? "Open it" : "Read more"}
              </a>
            </p>
            <div className="hero-actions">
              <a className="btn primary" href="/playground" onClick={open}>
                Open the playground
              </a>
              <a className="btn" href="/paper">
                Read the paper
              </a>
            </div>
          </div>
        </header>
      )}
      <App expanded={expanded} />
      {expanded ? null : (
        <>
          <section className="spec-strip" aria-label="Specifications">
            {SPECS.map(([lead, rest]) => (
              <p key={rest}>
                <strong>{lead}</strong>
                <span>{rest}</span>
              </p>
            ))}
          </section>

          <section className="capability playground-section" id="playground">
            <Reveal>
              <p className="cap-kicker">The Playground</p>
              <h2>Play with the digital twin of the chip.</h2>
              <p className="cap-body">
                The Playground opens on the Yard — a forest court with the live digital twin of the chip. Clear the scene to build from scratch: walls, food, landing pads, and hunters. Flies, bees, and food move under the same 256-neuron controller that targets Arduino and Raspberry Pi, stepping every 50&nbsp;ms. Not a cutscene — the genome running in the browser.
              </p>
              <ul className="playground-points">
                <li>
                  <strong>Yard default</strong>
                  <span>One room to learn, then clear and rebuild</span>
                </li>
                <li>
                  <strong>Live genome</strong>
                  <span>The wasm tick is the firmware step</span>
                </li>
                <li>
                  <strong>Full die below</strong>
                  <span>Highlight chip blocks under the yard</span>
                </li>
              </ul>
              <p className="chip-band-action">
                <a className="btn primary" href="/playground" onClick={open}>
                  Open the playground
                </a>
              </p>
            </Reveal>
          </section>

          <section className="capability escape-section" id="escape">
            <Reveal>
              <p className="cap-kicker">01 Escape</p>
              <h2>Turn away from the loom in one tick.</h2>
              <p className="cap-body">
                Looming is eight non-overlapping body-frame bins. Each bin drives one LPLC2-like cell; those cells also drive LC4. Both drive the giant fiber. The giant fiber drives the escape pair and a PSI; the PSI drives thrust. Each LPLC2 yaws away from its side. The two rear bins are weaker, so a threat already behind leaves the heading.
              </p>
              <figure className="cap-figure">
                <Escape />
              </figure>
              <p className="cap-aside">That chain uses cells already in the 256. No new neurons.</p>
            </Reveal>
          </section>

          <section className="capability search-section" id="search">
            <Reveal>
              <p className="cap-kicker">02 Search</p>
              <h2>Scent flows around every wall.</h2>
              <p className="cap-body">
                Food odor falls with walking distance, so it threads corridors and doorways instead of cutting through hedges. The two antennae read the downhill heading of that field. Direct vision and odor wires steer cruise yaw while the fly is free of a threat.
              </p>
              <ul className="cap-priority" aria-label="Priority order">
                <li>
                  <strong>1</strong>
                  <span>Predator</span>
                  <em>Escape outranks everything</em>
                </li>
                <li>
                  <strong>2</strong>
                  <span>Food</span>
                  <em>When the room is clear</em>
                </li>
                <li>
                  <strong>3</strong>
                  <span>Landing pad</span>
                  <em>When no food remains</em>
                </li>
              </ul>
            </Reveal>
          </section>

          <section className="capability land-section" id="land">
            <Reveal>
              <p className="cap-kicker">03 Land</p>
              <h2>A pad is home when the meal is gone.</h2>
              <p className="cap-body">
                Contact cells close the loop at a landing pad. The land and rest motors settle the body. If a predator ends a flight, the fly respawns on a random pad after a short shield. Build the room in the Playground; the controller adapts on the next tick.
              </p>
              <dl className="cap-facts">
                <div>
                  <dt>Contact</dt>
                  <dd>Pad sensors drive land and rest</dd>
                </div>
                <div>
                  <dt>Catch</dt>
                  <dd>Hunter radius plus 0.22 m returns the body</dd>
                </div>
                <div>
                  <dt>Shield</dt>
                  <dd>Thirty ticks before the next catch counts</dd>
                </div>
              </dl>
            </Reveal>
          </section>

          <section className="capability genome-section" id="genome">
            <Reveal>
              <p className="cap-kicker">04 Genome</p>
              <h2>A compiled escape path, not a whole brain.</h2>
              <p className="cap-body">
                FlyWire published 139,255 neurons. This tick keeps the looming detectors, the giant-fiber order, and the motor pairs in 256 cells so a 50&nbsp;ms frame fits a board you own. Feed, groom, walk, land, and rest stay on direct sensor-to-motor wires. Cruise, wall mix, and altitude hold live in the body plant beside the chip.
              </p>
              <div className="genome-split">
                <div>
                  <h3>On the chip</h3>
                  <ul>
                    <li>Eight loom bins and LPLC2</li>
                    <li>LC4, giant fiber, PSI</li>
                    <li>Twelve motor pairs</li>
                    <li>Direct sensor-to-motor edges</li>
                  </ul>
                </div>
                <div>
                  <h3>In the body</h3>
                  <ul>
                    <li>Cruise while a threat is present</li>
                    <li>Wall clearance and yaw mix</li>
                    <li>Pitch and lift toward the hunter band</li>
                    <li>Quiet rooms follow motor rates</li>
                  </ul>
                </div>
              </div>
            </Reveal>
          </section>

          <section className="hardware" id="hardware">
            <Reveal>
              <p className="cap-kicker">Hardware</p>
              <h2>Fees build the physical chip.</h2>
              <p className="cap-body">
                RoboFly runs a pump.fun token. Creator fees go toward chip development: a physical device based on the Arduino and Raspberry Pi reference designs already tested in the Playground and the paper. Fee claiming for this token runs via GitHub, beside the open controller. The same 256-neuron tick leaves the browser and lands on a board.
              </p>
              <div className="funding-row">
                <p>
                  {hasMint
                    ? "Open the coin on pump.fun. Creator fees fund the path from these reference circuits to silicon."
                    : "The coin link opens pump.fun. Set VITE_PUMP_MINT when the mint is live so this button goes straight to the coin."}
                  {github ? " Claim tooling and the project source live on GitHub." : " Set VITE_GITHUB_URL when the repo is public."}
                </p>
                <div className="hero-actions">
                  <a className="btn primary" href={pumpHref} target="_blank" rel="noopener noreferrer">
                    Open on pump.fun
                  </a>
                  {github ? (
                    <a className="btn" href={github} target="_blank" rel="noopener noreferrer">
                      GitHub
                    </a>
                  ) : null}
                  {arxiv ? (
                    <a className="btn" href={arxiv} target="_blank" rel="noopener noreferrer">
                      arXiv
                    </a>
                  ) : null}
                  <a className="btn" href="/paper">
                    Read the paper
                  </a>
                  <a className="btn" href="/playground" onClick={open}>
                    Open the playground
                  </a>
                </div>
              </div>

              <div className="board-grid">
                <article className="board-col">
                  <img className="board-logo" src="/brands/raspberry-pi.svg" alt="Raspberry Pi" width="260" height="48" />
                  <p className="board-tag">Python · floating point</p>
                  <p>
                    The Pi runs the same floating-point step as the Playground. Wire loom range and bearing in, PWM thrust and yaw out, and a digital escape line. Drop the controller into a robot that already has ordinary motor limiters.
                  </p>
                  <h4>Pin map</h4>
                  <table>
                    <tbody>
                      {PI_PINS.map(([pin, role]) => (
                        <tr key={pin}>
                          <th>{pin}</th>
                          <td>{role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
                <article className="board-col">
                  <img className="board-logo" src="/brands/arduino.svg" alt="Arduino" width="280" height="48" />
                  <p className="board-tag">Fixed point · AVR / ESP32</p>
                  <p>
                    Arduino runs the same 256 cells and 670 synapses as a short fixed-point loop. A 50&nbsp;ms frame fits a common AVR board and an ESP32-class board. The SystemVerilog core verifies the spike rule; the board firmware is the tick.
                  </p>
                  <h4>Pin map</h4>
                  <table>
                    <tbody>
                      {ARDUINO_PINS.map(([pin, role]) => (
                        <tr key={pin}>
                          <th>{pin}</th>
                          <td>{role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              </div>

              <div className="standalone-beat">
                <h3>Standalone into any robot</h3>
                <p>
                  The chip is also a component: five wires for range, bearing, thrust, two yaw directions, and escape. It is not a full flight stack. Your machine keeps its conventional limiter around the motors; RoboFly supplies the sensorimotor genome.
                </p>
              </div>

              <p className="inspiration">
                RoboFly takes inspiration from the University of Washington RoboFly of Chukewad, James, Singh, and Fuller. Raspberry Pi and Arduino are trademarks of their respective owners.
              </p>
            </Reveal>
          </section>

          <section className="chip-band" id="chip">
            <Reveal>
              <p className="cap-kicker">The chip</p>
              <h2>One die, one 50&nbsp;ms tick.</h2>
              <p className="cap-body">
                Sensors into the membranes, spikes through the synapse memory, twelve motor pairs into the body. Open the Playground for the live die and full breakdown; the figure below is the same tick drawn for the paper.
              </p>
              <figure className="chip-band-figure">
                <Tick />
                <figcaption>Sensory current, 256 membranes, 670 weights, twelve motor pairs, then the body plant.</figcaption>
              </figure>
              <p className="chip-band-action">
                <a className="btn" href="/paper">
                  Read the paper
                </a>
                <a className="btn" href="/playground" onClick={open}>
                  Open the playground
                </a>
              </p>
            </Reveal>
          </section>

          <section className="close-band">
            <Reveal>
              <h2>Read the account, then fly it.</h2>
              <div className="hero-actions">
                <a className="btn primary" href="/playground" onClick={open}>
                  Open the playground
                </a>
                <a className="btn" href="/paper">
                  Paper
                </a>
                {github ? (
                  <a className="btn" href={github} target="_blank" rel="noopener noreferrer">
                    GitHub
                  </a>
                ) : null}
                {arxiv ? (
                  <a className="btn" href={arxiv} target="_blank" rel="noopener noreferrer">
                    arXiv
                  </a>
                ) : null}
                <a className="btn" href={pumpHref} target="_blank" rel="noopener noreferrer">
                  pump.fun
                </a>
              </div>
            </Reveal>
          </section>

          <footer className="site-foot">
            <span>RoboFly Project</span>
            <a href="/playground" onClick={open}>
              The Playground
            </a>
            <a href="/paper">Paper</a>
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
            <a href={pumpHref} target="_blank" rel="noopener noreferrer">
              pump.fun
            </a>
          </footer>
        </>
      )}
    </div>
  );
}
