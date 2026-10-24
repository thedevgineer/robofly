import { useEffect, useState, type RefObject } from "react";
import { ChipScene, pointerState, type StructureName, type ViewCmd, type ViewCmdKind } from "./ChipScene";
import type { LiveFrame, NeuronStage } from "./live";
import type { ChipGraph } from "./types";
import { MOTOR_NAMES, motorNeuronIds, neuronKind } from "./types";

const MOTOR_LABEL: Record<(typeof MOTOR_NAMES)[number], string> = {
  thrust: "Thrust",
  yaw_left: "Yaw left",
  yaw_right: "Yaw right",
  pitch_up: "Pitch up",
  land: "Land",
  escape: "Escape",
  walk: "Walk",
  groom_fore: "Groom fore",
  groom_hind: "Groom hind",
  groom_wing: "Groom wing",
  feed: "Feed",
  rest: "Rest",
};

type StructureInfo = {
  name: StructureName;
  title: string;
  role: string;
  body: string;
};

type StructureGroup = {
  label: string;
  items: StructureInfo[];
};

const STRUCTURE_GROUPS: StructureGroup[] = [
  {
    label: "Memory",
    items: [
      {
        name: "v[256]",
        title: "Membranes",
        role: "256 cell voltages for the live tick.",
        body: "Membrane voltage for all 256 neurons. On a live tick a cell that is not refractory becomes its old voltage times 0.92, plus sensory drive and synaptic input. A spike clears that cell to 0.",
      },
      {
        name: "spikes",
        title: "Spike bits",
        role: "One bit per neuron for the current tick.",
        body: "One bit per neuron, set when that membrane crosses threshold. The live threshold is 1. The bit lasts one tick and is what turns on every synapse leaving the cell.",
      },
      {
        name: "weight sram",
        title: "Weight SRAM",
        role: "Synapse words: pre, post, and weight.",
        body: "One stored word per synapse: which cell fires, which cell receives, and the weight. Sensor-to-motor wires stay in this memory. The giant-fiber chain is the same kind of word, drawn as the pipes above the die.",
      },
    ],
  },
  {
    label: "Tick path",
    items: [
      {
        name: "decay_add",
        title: "Decay + drive",
        role: "Leak the membrane and add sensory drive.",
        body: "Leaks one membrane and adds its sensory drive. The block on the die is an arithmetic right shift of the stored voltage plus the drive. The live tick multiplies by 0.92 instead of shifting.",
      },
      {
        name: "spike_cmp",
        title: "Spike compare",
        role: "Compare the updated membrane to threshold.",
        body: "Turns the updated membrane into a spike bit. The live step spikes at 1 or above. The generated comparator uses a threshold of 256, in the fixed-point units of the Verilog.",
      },
      {
        name: "synapse_add",
        title: "Synapse add",
        role: "Add weight when the pre cell spiked.",
        body: "If the presynaptic cell spiked, adds that synapse's weight into the postsynaptic membrane. If it did not spike, the postsynaptic voltage stays as it is.",
      },
      {
        name: "motor_inc",
        title: "Motor increment",
        role: "Count spikes into motor groups.",
        body: "Walks the spiked neurons that belong to a motor group and adds one to that group's count.",
      },
      {
        name: "tick_ctrl",
        title: "Tick control",
        role: "Open a tick and raise done when finished.",
        body: "Opens a tick when tick is high and raises done when the neuron, synapse, and motor passes finish. Reset clears the membranes, the spike register, the motor counts, and the cycle counter.",
      },
      {
        name: "cycle_count",
        title: "Cycle count",
        role: "Accumulate work cycles for the tick.",
        body: "Adds the work of the tick: one cycle per neuron and one per synapse. The live step also counts each sensory cell that was driven.",
      },
      {
        name: "motor_accum",
        title: "Motor accumulators",
        role: "Twelve action rates for the body.",
        body: "Twelve counts, one per fly action. Each action is a pair of neurons, so one spike is a rate of 0.5 and both spikes are 1. Those rates drive thrust, turn, land, escape, walk, groom, feed, and rest.",
      },
    ],
  },
  {
    label: "Escape",
    items: [
      {
        name: "LPLC2",
        title: "LPLC2",
        role: "Eight looming detectors by azimuth.",
        body: "Eight looming detectors, neurons 96–103, one body-frame azimuth bin each. A looming sensor spike drives its own LPLC2, the first hop of the escape chain. That cell also drives the yaw pair that turns away from its bin. The rear bins are weaker.",
      },
      {
        name: "LC4",
        title: "LC4",
        role: "Gathers every loom channel.",
        body: "Neuron 104. Every loom channel drives it, so one cell gathers the whole looming population and passes that on to the giant fiber.",
      },
      {
        name: "GF",
        title: "Giant fiber",
        role: "Drives escape and PSI.",
        body: "The giant fiber, neuron 105. LPLC2 and LC4 both drive it. Its spike drives the escape motor pair and the PSI.",
      },
      {
        name: "PSI",
        title: "PSI",
        role: "Thrust stand-in after giant fiber.",
        body: "Neuron 106, driven by the giant fiber. Its spike drives the thrust pair, the stand-in for the wing-depressor motor neurons.",
      },
    ],
  },
];

const STRUCTURE_BY_NAME = Object.fromEntries(
  STRUCTURE_GROUPS.flatMap((group) => group.items.map((item) => [item.name, item])),
) as Record<StructureName, StructureInfo>;

function pinnedNeuron(ids: number[], stages: NeuronStage[], spikes: number[]): number {
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) {
    return ids.reduce((best, id) => ((stages[id]?.sum ?? 0) > (stages[best]?.sum ?? 0) ? id : best), ids[0]);
  }
  return spikes[0] ?? 0;
}

function describeStage(id: number, stage: NeuronStage | undefined): string {
  if (!stage) return "Pick a block on the die or a name in the rail.";
  const syn = stage.input - stage.drive;
  const added = Math.abs(syn) > 1e-4 ? `${stage.drive.toFixed(3)} + ${syn.toFixed(3)} syn` : stage.drive.toFixed(3);
  const cmp = stage.sum >= 1 ? "≥ 1 spike" : "< 1";
  return `neuron ${id} ${neuronKind(id)}  v ${stage.held.toFixed(3)} × 0.92 + ${added} = ${stage.sum.toFixed(3)} ${cmp}`;
}

function Motors({ frame, onFocus }: { frame: LiveFrame; onFocus: (ids: number[]) => void }) {
  return (
    <div className="motors">
      {MOTOR_NAMES.map((name) => {
        const value = frame.motor_rates[name] ?? 0;
        return (
          <button type="button" className="motor" key={name} onClick={() => onFocus(motorNeuronIds(name))}>
            <span>{MOTOR_LABEL[name]}</span>
            <div className="motor-track">
              <div
                className={name === "escape" ? "motor-fill escape" : "motor-fill"}
                style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
              />
            </div>
            <span className="motor-value">{value.toFixed(2)}</span>
          </button>
        );
      })}
    </div>
  );
}

function Transport({
  playing,
  ready,
  index,
  lastIndex,
  step,
  onTogglePlay,
  onBack,
  onStep,
  onScrub,
}: {
  playing: boolean;
  ready: boolean;
  index: number;
  lastIndex: number;
  step: number;
  onTogglePlay: () => void;
  onBack: () => void;
  onStep: () => void;
  onScrub: (index: number) => void;
}) {
  return (
    <div className="chip-transport">
      <button type="button" onClick={onTogglePlay} disabled={!ready}>
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={onBack} disabled={index <= 0}>
        Back
      </button>
      <button type="button" onClick={onStep} disabled={!ready}>
        Step
      </button>
      <input
        className="scrubber"
        type="range"
        min={0}
        max={lastIndex}
        value={index}
        disabled={!ready}
        onChange={(event) => onScrub(Number(event.target.value))}
        aria-label="Live step"
      />
      <strong>{step.toLocaleString()}</strong>
    </div>
  );
}

export function ChipView({
  presentation = "modal",
  open,
  onClose,
  closeRef,
  frame,
  previousCycles,
  focusIds,
  onFocus,
  playing,
  ready,
  index,
  lastIndex,
  onTogglePlay,
  onBack,
  onStep,
  onScrub,
  graph,
  graphError,
}: {
  open: boolean;
  onClose: () => void;
  closeRef?: RefObject<HTMLButtonElement | null>;
  frame: LiveFrame;
  previousCycles: number;
  focusIds: number[];
  onFocus: (ids: number[]) => void;
  playing: boolean;
  ready: boolean;
  index: number;
  lastIndex: number;
  onTogglePlay: () => void;
  onBack: () => void;
  onStep: () => void;
  onScrub: (index: number) => void;
  presentation?: "modal" | "breakdown";
  graph: ChipGraph | null;
  graphError?: string | null;
}) {
  const delta = frame.cycles - previousCycles;
  const pinned = pinnedNeuron(focusIds, frame.stages, frame.spikes);
  const [fitView, setFitView] = useState(0);
  const [viewCmd, setViewCmd] = useState<ViewCmd | null>(null);
  const [structure, setStructure] = useState<StructureName | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [drawer, setDrawer] = useState<"motors" | "live" | null>(null);
  const pickStructure = (name: StructureName) => {
    setStructure((current) => {
      const next = current === name ? null : name;
      if (next) {
        const at = STRUCTURE_GROUPS.findIndex((group) => group.items.some((item) => item.name === next));
        if (at >= 0) setGroupIndex(at);
      }
      return next;
    });
  };
  const breakdown = presentation === "breakdown";
  const selected = structure ? STRUCTURE_BY_NAME[structure] : null;
  const activeGroup = STRUCTURE_GROUPS[groupIndex] ?? STRUCTURE_GROUPS[0];

  useEffect(() => {
    if (!structure) return;
    const at = STRUCTURE_GROUPS.findIndex((group) => group.items.some((item) => item.name === structure));
    if (at >= 0) setGroupIndex(at);
  }, [structure]);

  useEffect(() => {
    if (!open || breakdown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, breakdown]);

  const sendView = (kind: ViewCmdKind) => {
    if (kind === "reset" || kind === "iso") setFitView((value) => value + 1);
    setViewCmd((current) => ({ n: (current?.n ?? 0) + 1, kind }));
  };

  const scene = graph ? (
    <ChipScene
      graph={graph}
      spikes={frame.spikes}
      driven={frame.driven ?? []}
      stages={frame.stages}
      pinned={pinned}
      step={frame.step}
      motorRates={frame.motor_rates}
      focusIds={focusIds}
      fitView={fitView}
      viewCmd={viewCmd}
      onSelectNeuron={(id) => onFocus([id])}
      structure={structure}
      onPickStructure={pickStructure}
    />
  ) : (
    <p className="empty">{graphError ?? "Loading circuit…"}</p>
  );

  const toggleDrawer = (name: "motors" | "live") => setDrawer((current) => (current === name ? null : name));

  return (
    <section className={breakdown ? "chip die-shell breakdown" : "chip die-shell modal"} aria-label={breakdown ? "Chip breakdown" : "Chip"}>
      <header className="die-topbar">
        <div className="die-topbar-brand">
          <p className="eyebrow">robofly_core</p>
          <h2>Chip</h2>
        </div>
        <p className="die-live">
          <span>
            cycles <strong>{frame.cycles.toLocaleString()}</strong>
          </span>
          <span>
            tick <strong>+{delta.toLocaleString()}</strong>
          </span>
          <span>
            step <strong>{frame.step.toLocaleString()}</strong>
          </span>
          <i key={frame.step} className="clock-led" aria-hidden="true" />
        </p>
        {!breakdown ? (
          <button ref={closeRef} type="button" className="die-close" onClick={onClose}>
            Close
          </button>
        ) : null}
      </header>

      <div className="die-stage">
        <div className="chip-stage">{scene}</div>

        <aside className={selected ? "die-dock-end die-hotspot open" : "die-dock-end die-hotspot"}>
          {selected ? (
            <>
              <header>
                <div>
                  <p className="inspector-label">Selected</p>
                  <h3>{selected.title}</h3>
                  <p className="structure-role">{selected.role}</p>
                </div>
                <button type="button" className="structure-clear" onClick={() => setStructure(null)}>
                  Clear
                </button>
              </header>
              <p className="structure-body">{selected.body}</p>
              <p className="inspect">{describeStage(pinned, frame.stages[pinned])}</p>
            </>
          ) : (
            <>
              <p className="structure-hint">Drag the die or use the view cube. Pick a block to highlight it.</p>
              <p className="inspect">{describeStage(pinned, frame.stages[pinned])}</p>
            </>
          )}
        </aside>

        <div className="die-dock-bottom">
          <div className="die-cube-gutter">
            <button type="button" className="die-reset-btn" onClick={() => sendView("reset")}>
              Reset view
            </button>
          </div>
          <div className="die-dock-stack">
            <nav className="die-picker" aria-label="Chip components">
              <div className="die-picker-head">
                <p className="inspector-label">Components</p>
                <div className="die-group-switch" role="tablist" aria-label="Component groups">
                  {STRUCTURE_GROUPS.map((group, index) => (
                    <button
                      type="button"
                      key={group.label}
                      role="tab"
                      aria-selected={index === groupIndex}
                      className={index === groupIndex ? "active" : undefined}
                      onClick={() => setGroupIndex(index)}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="die-tiles" role="toolbar" aria-label={activeGroup.label}>
                {activeGroup.items.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    className={structure === item.name ? "die-tile active" : "die-tile"}
                    onClick={() => pickStructure(item.name)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.role}</span>
                  </button>
                ))}
              </div>
            </nav>
            <div className="die-drawers">
              <div className="die-drawer-toggles" role="toolbar" aria-label="Chip drawers">
                <button type="button" className={drawer === "motors" ? "active" : undefined} onClick={() => toggleDrawer("motors")}>
                  Motors
                </button>
                <button type="button" className={drawer === "live" ? "active" : undefined} onClick={() => toggleDrawer("live")}>
                  Live
                </button>
              </div>
              {drawer === "motors" ? (
                <div className="die-drawer-panel">
                  <Motors frame={frame} onFocus={onFocus} />
                </div>
              ) : null}
              {drawer === "live" ? (
                <div className="die-drawer-panel">
                  <Transport
                    playing={playing}
                    ready={ready}
                    index={index}
                    lastIndex={lastIndex}
                    step={frame.step}
                    onTogglePlay={onTogglePlay}
                    onBack={onBack}
                    onStep={onStep}
                    onScrub={onScrub}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ChipMini({
  frame,
  onOpen,
  corner = "left",
  graph,
}: {
  frame: LiveFrame;
  onOpen: () => void;
  corner?: "left" | "right";
  graph: ChipGraph | null;
}) {
  return (
    <div
      className={corner === "right" ? "chip-mini right" : "chip-mini"}
      role="button"
      tabIndex={0}
      aria-label="Open the chip view"
      onClick={() => {
        if (!pointerState.panned) onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="chip-mini-stage">
        {graph ? (
          <ChipScene
            transparent
            compact
            graph={graph}
            spikes={frame.spikes}
            driven={frame.driven ?? []}
            stages={frame.stages}
            pinned={frame.spikes[0] ?? 0}
            step={frame.step}
            motorRates={frame.motor_rates}
            focusIds={[]}
            fitView={1}
            onSelectNeuron={() => undefined}
            structure={null}
            onPickStructure={() => undefined}
          />
        ) : null}
      </div>
      <span className="chip-mini-label">
        <i key={frame.step} className="clock-led" aria-hidden="true" />
        Chip · <b>{frame.spikes.length}</b> spikes
        <em>Open</em>
      </span>
    </div>
  );
}
