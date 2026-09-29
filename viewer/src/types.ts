export type Pose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
};

export type Frame = {
  step: number;
  pose: Pose;
  command: {
    thrust: number;
    yaw: number;
    pitch: number;
    land: boolean;
    escape: boolean;
  };
  spikes: number[];
  motor_rates: Record<string, number>;
  population_rates: Record<string, number>;
  cycles: number;
  drive_nonzero: number;
  voltage_sample: number[];
  eaten: boolean;
  inside_room: boolean;
  food: Landmark | null;
  foods?: Landmark[];
  predator: Landmark | null;
  predators?: Landmark[];
  driven?: number[];
};

export type Landmark = {
  kind: string;
  x: number;
  y: number;
  z: number;
  radius: number;
};

export type Room = {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
};

export type Barrier = Landmark & {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
};

export type Landmarks = {
  room: Room;
  food: Landmark | null;
  landing: Landmark | null;
  threat: Landmark | null;
  obstacles: Barrier[];
};

export type ChipGraph = {
  seed: number;
  neurons: { id: number; type: string; motor: string | null; circuit?: string | null }[];
  synapses: { pre: number[]; post: number[]; weight: number[] };
};

export type Layout = {
  room: Room;
  foods: Landmark[];
  threats: Landmark[];
  landings: Landmark[];
  obstacles: Array<Pick<Barrier, "min_x" | "max_x" | "min_y" | "max_y">>;
  pose: { x: number; y: number; z: number; yaw: number; pitch: number };
};

export type TraceResponse = {
  id: string;
  scenario: string;
  topology: { neurons: number; synapses: number } | null;
  landmarks: Landmarks;
  layout?: Layout;
  frames: Frame[];
};

export type EditorTool = "move" | "wall" | "food" | "enemy" | "pad" | "erase";

export type WorldPick = "food" | "enemy" | "pad" | "wall";

export type RunSummary = {
  id: string;
  scenario: string;
  run_dir?: string;
};

export const SCENARIOS = ["food", "loom", "obstacle", "landing", "silent"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const MOTOR_NAMES = [
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
] as const;
export const MOTOR_GROUP = 2;

export function populationIds(kind: WorldPick): number[] {
  if (kind === "food") return range(64, 80);
  if (kind === "enemy") return range(88, 96);
  if (kind === "pad") return range(80, 88);
  return range(0, 64);
}

export function motorNeuronIds(name: string): number[] {
  const index = MOTOR_NAMES.indexOf(name as (typeof MOTOR_NAMES)[number]);
  if (index < 0) return [];
  const start = 232 + index * MOTOR_GROUP;
  return range(start, start + MOTOR_GROUP);
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, offset) => start + offset);
}

export function neuronKind(id: number): string {
  if (id < 64) return "vision";
  if (id < 80) return "odor";
  if (id < 88) return "contact";
  if (id < 96) return "loom";
  if (id < 232) return "inter";
  const motor = MOTOR_NAMES[Math.floor((id - 232) / MOTOR_GROUP)];
  return motor ?? "motor";
}
