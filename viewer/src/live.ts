import type { Frame, Layout, Scenario } from "./types";

export type NeuronStage = {
  held: number;
  decayed: number;
  drive: number;
  input: number;
  sum: number;
  spike: boolean;
  refractory: number;
};

export type LiveFrame = Frame & {
  stages: NeuronStage[];
};

const SCENARIO_ID: Record<Scenario, number> = {
  food: 0,
  loom: 1,
  obstacle: 2,
  landing: 3,
  silent: 4,
};

const SNAP_LEN = 7144;
const MOTOR_COUNT = 12;
const LAYOUT_LEN = 792;

type Exports = {
  memory: WebAssembly.Memory;
  snapshot_ptr: () => number;
  snapshot_len: () => number;
  layout_ptr: () => number;
  layout_len: () => number;
  layout_buffer: () => number;
  layout_buffer_cap: () => number;
  reset: (scenario: number) => number;
  set_layout: (len: number) => number;
  set_hold: (action: number) => void;
  step: () => void;
};

export type LiveSim = {
  reset: (scenario: Scenario) => void;
  setLayout: (layout: Layout) => void;
  setHold: (action: number) => void;
  step: () => void;
  read: () => LiveFrame;
  readLayout: () => Layout;
};

function viewOf(memory: WebAssembly.Memory, ptr: number, len: number): DataView {
  return new DataView(memory.buffer, ptr, len);
}

function readObj(data: DataView, offset: number): { x: number; y: number; z: number; radius: number } {
  return {
    x: data.getFloat64(offset, true),
    y: data.getFloat64(offset + 8, true),
    z: data.getFloat64(offset + 16, true),
    radius: data.getFloat64(offset + 24, true),
  };
}

function readFrame(memory: WebAssembly.Memory, ptr: number): LiveFrame {
  const data = viewOf(memory, ptr, SNAP_LEN);
  const ticks = data.getUint32(0, true);
  const cycles = data.getUint32(4, true);
  const spikeCount = data.getUint32(8, true);
  const drivenCount = data.getUint32(12, true);
  const foodCount = data.getUint32(16, true);
  const threatCount = data.getUint32(20, true);
  const eaten = data.getUint32(24, true) !== 0;
  const inside = data.getUint32(28, true) !== 0;
  const pose = {
    x: data.getFloat64(32, true),
    y: data.getFloat64(40, true),
    z: data.getFloat64(48, true),
    yaw: data.getFloat64(56, true),
    pitch: data.getFloat64(64, true),
    speed: data.getFloat64(72, true),
  };
  const thrust = data.getFloat64(80, true);
  const yaw = data.getFloat64(88, true);
  const pitch = data.getFloat64(96, true);
  const land = data.getUint32(104, true) !== 0;
  const escape = data.getUint32(108, true) !== 0;
  const motor_rates: Record<string, number> = {};
  const motorNames = [
    "thrust",
    "yaw_left",
    "yaw_right",
    "pitch_up",
    "land",
    "escape",
    "walk",
    "groom_fore",
    "groom_hind",
    "groom_wing",
    "feed",
    "rest",
  ];
  motorNames.forEach((name, index) => {
    motor_rates[name] = data.getFloat32(112 + index * 4, true);
  });
  const driveNonzero = data.getUint32(112 + MOTOR_COUNT * 4, true);
  const base = 112 + MOTOR_COUNT * 4 + 8;
  const plane = 256 * 4;
  const stages: NeuronStage[] = [];
  for (let id = 0; id < 256; id += 1) {
    const at = id * 4;
    stages.push({
      held: data.getFloat32(base + at, true),
      decayed: data.getFloat32(base + plane + at, true),
      drive: data.getFloat32(base + plane * 2 + at, true),
      input: data.getFloat32(base + plane * 3 + at, true),
      sum: data.getFloat32(base + plane * 4 + at, true),
      spike: data.getUint8(base + plane * 5 + id) !== 0,
      refractory: data.getUint8(base + plane * 5 + 256 + id),
    });
  }
  const idBase = base + plane * 5 + 512;
  const spikes: number[] = [];
  for (let index = 0; index < spikeCount; index += 1) {
    spikes.push(data.getUint16(idBase + index * 2, true));
  }
  const driven: number[] = [];
  for (let index = 0; index < drivenCount; index += 1) {
    driven.push(data.getUint16(idBase + 512 + index * 2, true));
  }
  const foodAt = idBase + 1024;
  const foods = [];
  for (let index = 0; index < foodCount; index += 1) {
    foods.push({ kind: "food", ...readObj(data, foodAt + index * 32) });
  }
  const threatAt = foodAt + 6 * 32;
  const predators = [];
  for (let index = 0; index < threatCount; index += 1) {
    predators.push({ kind: "threat", ...readObj(data, threatAt + index * 32) });
  }
  const voltage_sample = stages.slice(0, 32).map((stage) => (stage.spike ? 0 : stage.sum));
  return {
    step: ticks,
    pose,
    command: { thrust, yaw, pitch, land, escape },
    spikes,
    motor_rates,
    population_rates: {},
    cycles,
    drive_nonzero: driveNonzero,
    voltage_sample,
    eaten,
    inside_room: inside,
    food: foods[0] ?? null,
    foods,
    predator: predators[0] ?? null,
    predators,
    driven,
    stages,
  };
}

function readLayout(memory: WebAssembly.Memory, ptr: number): Layout {
  const data = viewOf(memory, ptr, LAYOUT_LEN);
  const room = {
    min_x: data.getFloat64(0, true),
    max_x: data.getFloat64(8, true),
    min_y: data.getFloat64(16, true),
    max_y: data.getFloat64(24, true),
  };
  const pose = {
    x: data.getFloat64(32, true),
    y: data.getFloat64(40, true),
    z: data.getFloat64(48, true),
    yaw: data.getFloat64(56, true),
    pitch: data.getFloat64(64, true),
  };
  const nFood = data.getUint32(72, true);
  const nThreat = data.getUint32(76, true);
  const nLand = data.getUint32(80, true);
  const nWall = data.getUint32(84, true);
  const foods = [];
  for (let index = 0; index < nFood; index += 1) {
    foods.push({ kind: "food", ...readObj(data, 88 + index * 32) });
  }
  const threats = [];
  for (let index = 0; index < nThreat; index += 1) {
    threats.push({ kind: "threat", ...readObj(data, 280 + index * 32) });
  }
  const landings = [];
  for (let index = 0; index < nLand; index += 1) {
    landings.push({ kind: "landing", ...readObj(data, 408 + index * 32) });
  }
  const obstacles = [];
  for (let index = 0; index < nWall; index += 1) {
    const at = 536 + index * 32;
    obstacles.push({
      min_x: data.getFloat64(at, true),
      max_x: data.getFloat64(at + 8, true),
      min_y: data.getFloat64(at + 16, true),
      max_y: data.getFloat64(at + 24, true),
    });
  }
  return { room, foods, threats, landings, obstacles, pose };
}

function packLayout(layout: Layout): ArrayBuffer {
  const foods = layout.foods.slice(0, 6);
  const threats = layout.threats.slice(0, 4);
  const landings = layout.landings.slice(0, 4);
  const walls = layout.obstacles.slice(0, 8);
  const bytes = new ArrayBuffer(88 + (foods.length + threats.length + landings.length) * 32 + walls.length * 32);
  const data = new DataView(bytes);
  let cursor = 0;
  const f64 = (value: number) => {
    data.setFloat64(cursor, value, true);
    cursor += 8;
  };
  const u32 = (value: number) => {
    data.setUint32(cursor, value, true);
    cursor += 4;
  };
  const obj = (item: { x: number; y: number; z: number; radius?: number }) => {
    f64(item.x);
    f64(item.y);
    f64(item.z);
    f64(item.radius ?? 0.45);
  };
  f64(layout.room.min_x);
  f64(layout.room.max_x);
  f64(layout.room.min_y);
  f64(layout.room.max_y);
  f64(layout.pose.x);
  f64(layout.pose.y);
  f64(layout.pose.z);
  f64(layout.pose.yaw);
  f64(layout.pose.pitch);
  u32(foods.length);
  u32(threats.length);
  u32(landings.length);
  u32(walls.length);
  foods.forEach(obj);
  threats.forEach(obj);
  landings.forEach(obj);
  walls.forEach((wall) => {
    f64(wall.min_x);
    f64(wall.max_x);
    f64(wall.min_y);
    f64(wall.max_y);
  });
  return bytes;
}

const LAYOUT_ERRORS = ["ok", "room bounds are empty", "layout exceeds the room limits", "object is outside the room", "wall bounds are empty"];

export async function loadLive(): Promise<LiveSim> {
  const response = await fetch("/robofly.wasm");
  if (!response.ok) throw new Error(`Could not load the live tick (${response.status})`);
  const wasm = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const api = wasm.instance.exports as Exports;
  if (api.snapshot_len() !== SNAP_LEN || api.layout_len() !== LAYOUT_LEN) {
    throw new Error("Live tick snapshot does not match this page");
  }
  const read = () => readFrame(api.memory, api.snapshot_ptr());
  const readLayoutNow = () => readLayout(api.memory, api.layout_ptr());
  return {
    reset(scenario) {
      api.reset(SCENARIO_ID[scenario]);
    },
    setLayout(layout) {
      const packed = new Uint8Array(packLayout(layout));
      const ptr = api.layout_buffer();
      new Uint8Array(api.memory.buffer, ptr, packed.length).set(packed);
      const code = api.set_layout(packed.length);
      if (code !== 0) throw new Error(LAYOUT_ERRORS[code] ?? "layout was rejected");
    },
    setHold(action: number) {
      api.set_hold(action);
    },
    step() {
      api.step();
    },
    read,
    readLayout: readLayoutNow,
  };
}
