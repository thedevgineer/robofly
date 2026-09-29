import { useEffect, useState } from "react";
import { fetchGraph } from "./api";
import { ChipScene, STRUCTURES, type StructureName } from "./ChipScene";
import type { LiveFrame, NeuronStage } from "./live";
import type { ChipGraph } from "./types";
import { MOTOR_NAMES, motorNeuronIds, neuronKind } from "./types";

const KIND_COLOR: Record<string, string> = {
  vision: "#3d7ea6",
  odor: "#3f8f6b",
  contact: "#c4a15a",
  loom: "#c45a4e",
  inter: "#4d5d73",
  thrust: "#e7eef6",
  yaw_left: "#7aa2ff",
  yaw_right: "#5b86e0",
  pitch_up: "#c9a0ff",
  land: "#8fd18a",
  escape: "#ff6b4a",
  walk: "#d08a4a",
  groom_fore: "#e0b4c8",
  groom_hind: "#c48aaa",
  groom_wing: "#9aa7e0",
  feed: "#d6f25a",
  rest: "#b7c4d1",
};

const LEGEND = [
  ["neuron stage", "#f0b429"],
  ["SRAM", "#3f8f6b"],
  ["motor_accum", "#ff6b4a"],
] as const;

const STRUCTURE_NOTES: Record<StructureName, string> = {
  "v[256]":
    "Membrane voltage for all 256 neurons. On a live tick a cell that is not refractory becomes its old voltage times 0.92, plus sensory drive and synaptic input. A spike clears that cell to 0.",
  spikes:
    "One bit per neuron, set when that membrane crosses threshold. The live threshold is 1. The bit lasts one tick and is what turns on every synapse leaving the cell.",
  "weight sram":
    "One stored word per synapse: which cell fires, which cell receives, and the weight. Sensor-to-motor wires stay in this memory. The giant-fiber chain is the same kind of word, drawn as the pipes above the die.",
  decay_add:
    "Leaks one membrane and adds its sensory drive. The block on the die is an arithmetic right shift of the stored voltage plus the drive. The live tick multiplies by 0.92 instead of shifting.",
  spike_cmp:
    "Turns the updated membrane into a spike bit. The live step spikes at 1 or above. The generated comparator uses a threshold of 256, in the fixed-point units of the Verilog.",
  synapse_add:
    "If the presynaptic cell spiked, adds that synapse's weight into the postsynaptic membrane. If it did not spike, the postsynaptic voltage stays as it is.",
  motor_inc:
    "Walks the spiked neurons that belong to a motor group and adds one to that group's count.",
  tick_ctrl:
    "Opens a tick when tick is high and raises done when the neuron, synapse, and motor passes finish. Reset clears the membranes, the spike register, the motor counts, and the cycle counter.",
  cycle_count:
    "Adds the work of the tick: one cycle per neuron and one per synapse. The live step also counts each sensory cell that was driven.",
  motor_accum:
    "Twelve counts, one per fly action. Each action is a pair of neurons, so one spike is a rate of 0.5 and both spikes are 1. Those rates drive thrust, turn, land, escape, walk, groom, feed, and rest.",
  LPLC2:
    "Eight looming detectors, neurons 96–103, one for each loom channel. A looming sensor spike drives its own LPLC2. This is the first hop of the escape chain.",
  LC4:
    "Neuron 104. Every loom channel drives it, so one cell gathers the whole looming population and passes that on to the giant fiber.",
  GF:
    "The giant fiber, neuron 105. LPLC2 and LC4 both drive it. Its spike drives the escape motor pair and the PSI.",
  PSI:
    "Neuron 106, driven by the giant fiber. Its spike drives the thrust pair, the stand-in for the wing-depressor motor neurons.",
};

function pinnedNeuron(ids: number[], stages: NeuronStage[], spikes: number[]): number {
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) {
    return ids.reduce((best, id) => ((stages[id]?.sum ?? 0) > (stages[best]?.sum ?? 0) ? id : best), ids[0]);
  }
  return spikes[0] ?? 0;
}

function describeStage(id: number, stage: NeuronStage | undefined): string {
  if (!stage) return "Click a spike row, a memory cell, or something in the room.";
  const syn = stage.input - stage.drive;
  const added = Math.abs(syn) > 1e-4 ? `${stage.drive.toFixed(3)} + ${syn.toFixed(3)} syn` : stage.drive.toFixed(3);
  const cmp = stage.sum >= 1 ? "≥ 1 spike" : "< 1";
  return `neuron ${id} ${neuronKind(id)}  v ${stage.held.toFixed(3)} × 0.92 + ${added} = ${stage.sum.toFixed(3)} ${cmp}`;
}

function ClockWave({ index }: { index: number }) {
  const slots = 32;
  const width = 360;
  const height = 44;
  const start = Math.max(0, index - slots + 1);
  const commands: string[] = [];
  const yLow = height - 7;
  const yHigh = 7;
  for (let slot = 0; slot < slots; slot += 1) {
    const step = start + slot;
    const seen = step <= index;
    const x0 = (slot / slots) * width;
    const rise = ((slot + 0.16) / slots) * width;
    const fall = ((slot + 0.7) / slots) * width;
    const x1 = ((slot + 1) / slots) * width;
    const y = seen ? yHigh : yLow;
    if (slot === 0) commands.push(`M ${x0.toFixed(2)} ${yLow}`);
    commands.push(
      `L ${rise.toFixed(2)} ${yLow}`,
      `L ${rise.toFixed(2)} ${y}`,
      `L ${fall.toFixed(2)} ${y}`,
      `L ${fall.toFixed(2)} ${yLow}`,
      `L ${x1.toFixed(2)} ${yLow}`,
    );
  }

  return (
    <svg className="clock-wave" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Chip clock edges">
      <path d={commands.join(" ")} fill="none" stroke="#f0b429" strokeWidth="2" />
    </svg>
  );
}

export function ChipView({
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
}: {
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
}) {
  const delta = frame.cycles - previousCycles;
  const pinned = pinnedNeuron(focusIds, frame.stages, frame.spikes);
  const [graph, setGraph] = useState<ChipGraph | null>(null);
  const [fitView, setFitView] = useState(0);
  const [open, setOpen] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [structure, setStructure] = useState<StructureName | null>(null);
  const pickStructure = (name: StructureName) => setStructure((current) => (current === name ? null : name));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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

  return (
    <>
    {open ? <button type="button" className="chip-backdrop" aria-label="Close chip" onClick={() => setOpen(false)} /> : null}
    <aside className={open ? "chip chip-modal" : "chip"}>
      <header className="chip-head">
        <div>
          <p className="eyebrow">robofly_core</p>
          <h2>Chip</h2>
        </div>
        <span key={frame.step} className="clock-led" aria-hidden="true" />
      </header>
      <ClockWave index={frame.step} />
      <div className="cycle-readout">
        <div>
          <span>cycles</span>
          <strong>{frame.cycles.toLocaleString()}</strong>
        </div>
        <div>
          <span>this tick</span>
          <strong>+{delta.toLocaleString()}</strong>
        </div>
        <div>
          <span>step</span>
          <strong>{frame.step.toLocaleString()}</strong>
        </div>
      </div>
      <div className="chip-stage">
        {graph ? (
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
            onSelectNeuron={(id) => onFocus([id])}
            structure={structure}
            onPickStructure={pickStructure}
          />
        ) : (
          <p className="empty">{graphError ?? "Loading circuit…"}</p>
        )}
      </div>
      <p className="inspect">{describeStage(pinned, frame.stages[pinned])}</p>
      <div className="structures">
        {STRUCTURES.map((name) => (
          <button type="button" key={name} className={structure === name ? "active" : undefined} onClick={() => pickStructure(name)}>
            {name}
          </button>
        ))}
      </div>
      {structure ? (
        <p className="structure-note">
          <strong>{structure}</strong>
          {STRUCTURE_NOTES[structure]}
        </p>
      ) : null}
      <div className="legend">
        {LEGEND.map(([kind, color]) => (
          <span key={kind}>
            <i style={{ background: color }} />
            {kind}
          </span>
        ))}
      </div>
      <div className="die-controls">
        <button type="button" onClick={() => setFitView((value) => value + 1)}>
          Fit die
        </button>
        <button type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "Full screen"}
        </button>
      </div>
      {open ? (
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
          <strong>{frame.step.toLocaleString()}</strong>
        </div>
      ) : null}
      <div className="motors">
        {MOTOR_NAMES.map((name) => {
          const value = frame.motor_rates[name] ?? 0;
          return (
            <button type="button" className="motor" key={name} onClick={() => onFocus(motorNeuronIds(name))}>
              <span>{name}</span>
              <div className="motor-track">
                <div
                  className="motor-fill"
                  style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: KIND_COLOR[name] }}
                />
              </div>
              <span className="motor-value">{value.toFixed(2)}</span>
            </button>
          );
        })}
      </div>
    </aside>
    </>
  );
}
