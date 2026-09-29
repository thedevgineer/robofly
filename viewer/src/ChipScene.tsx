import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { NeuronStage } from "./live";
import { MOTOR_GROUP, MOTOR_NAMES, neuronKind, type ChipGraph } from "./types";

const pointerState = { panned: false };

const ROW_Z = 0.72;
const STATE_PITCH = 0.1;
const STATE_CENTER: [number, number] = [-3.28, ROW_Z];
const SPIKE_PITCH = 0.1;
const SPIKE_CENTER: [number, number] = [-0.42, ROW_Z];
const COMPARE_X = -1.85;
const SRAM_COLS = 46;
const SRAM_PITCH_X = 0.052;
const SRAM_PITCH_Z = 0.038;
const SRAM_CENTER: [number, number] = [2.02, ROW_Z];
const INDEX_PITCH = 0.062;
const INDEX_CENTER: [number, number] = [-3.28, -1.35];
const MOTOR_X0 = -3.55;
const MOTOR_PITCH = 0.64;
const CELL_Y = 0.3;
const NET = {
  drive_rd: 0.72,
  v_rd: 0.96,
  v_shift: 1.2,
  v_sum: 1.44,
  spike_bit: 0.84,
  spikes: 1.68,
  pre_rd: 1.08,
  syn_en: 1.32,
  weight_rd: 1.56,
  v_post_rd: 1.8,
  post_rd: 2.04,
  v_post_sum: 2.28,
  motor_spike: 0.96,
  motor_sel: 1.2,
  accum_sum: 1.44,
  clk: 2.52,
  rst: 2.28,
  tick: 2.04,
  done: 1.8,
  cycle: 1.56,
} as const;
const TONE = { data: "#a7844a", ctrl: "#cbbd9a", write: "#7d5e38", addr: "#6e8c98" };

export const STRUCTURES = [
  "v[256]",
  "spikes",
  "weight sram",
  "decay_add",
  "spike_cmp",
  "synapse_add",
  "motor_inc",
  "tick_ctrl",
  "cycle_count",
  "motor_accum",
  "LPLC2",
  "LC4",
  "GF",
  "PSI",
] as const;
export type StructureName = (typeof STRUCTURES)[number];

const STRUCTURE_NETS: Partial<Record<StructureName, Net[]>> = {
  decay_add: ["drive", "v_rd", "v_shift"],
  "v[256]": ["v_rd", "v_sum", "v_post_rd", "v_post_sum"],
  spike_cmp: ["v_sum", "spike_bit"],
  spikes: ["spike_bit", "spikes"],
  "weight sram": ["pre_rd", "weight_rd", "post_rd"],
  synapse_add: ["pre_rd", "syn_en", "weight_rd", "v_post_rd", "post_rd", "v_post_sum"],
  motor_inc: ["motor_spike", "motor_sel", "accum_sum"],
  motor_accum: ["motor_spike", "motor_sel", "accum_sum"],
  tick_ctrl: ["clk", "rst", "tick", "done", "cycle"],
  cycle_count: ["clk", "rst", "tick", "done", "cycle"],
};
const STATE_X0 = STATE_CENTER[0] - (15 * STATE_PITCH) / 2;
const STATE_X1 = STATE_X0 + 15 * STATE_PITCH;
const V_X0 = STATE_X0;
const V_X1 = STATE_X1;
const V_RD_Z = 1.68;
const V_SUM_Z = -0.28;
const V_POST_RD_Z = -0.52;
const V_POST_SUM_Z = -0.76;
const POST_ADDR_Z = -1.02;
const SPIKE_X0 = SPIKE_CENTER[0] - (15 * SPIKE_PITCH) / 2;
const SPIKE_X1 = SPIKE_X0 + 15 * SPIKE_PITCH;
const SP_X0 = SPIKE_X0;
const SP_X1 = SPIKE_X1;
const SPIKE_BIT_Z = 1.55;
const SPIKES_BUS_Z = 1.95;
const SYN_EN_Z = ROW_Z - 0.2;
const MOTOR_SPIKE_Z = -0.22;
const PRE_X = 0.55;
const WEIGHT_X = 0.7;
const POST_X = 0.85;
const SYN_X = 1.15;
const SYN_Z = -0.38;
const MINC_X = -1.55;
const MINC_Z = -1.95;
const INDEX_X0 = -3.78;
const INDEX_X1 = -2.78;
const INDEX_SEL_Z = -2.02;
const ACCUM_RAIL_Z = -2.18;
const BLOCK_TOP = 0.24;
const PAD_Y = 0.2;
const NORTH = 2.72;
const TICK_CTRL: [number, number] = [2.55, -0.72];
const DECAY_AT: [number, number] = [-4.2, ROW_Z];
const DECAY_VRD: [number, number] = [-3.98, ROW_Z + 0.1];
const DECAY_VSUM: [number, number] = [-3.98, ROW_Z - 0.1];
type Net =
  | "drive"
  | "v_rd"
  | "v_shift"
  | "v_sum"
  | "spike_bit"
  | "spikes"
  | "pre_rd"
  | "syn_en"
  | "weight_rd"
  | "v_post_rd"
  | "post_rd"
  | "v_post_sum"
  | "motor_spike"
  | "motor_sel"
  | "accum_sum"
  | "clk"
  | "rst"
  | "tick"
  | "done"
  | "cycle";
type Run = { a: [number, number]; b: [number, number]; y: number; color: string; net: Net };
type Riser = { x: number; z: number; y0: number; y1: number; color: string; net: Net };
type Seg = [number, number, number, number, number, number];

const CLOCK_PATH = [
  new THREE.Vector3(-3.15, PAD_Y, 3.2),
  new THREE.Vector3(-3.15, NET.clk, 3.2),
  new THREE.Vector3(-3.15, NET.clk, NORTH),
  new THREE.Vector3(3.35, NET.clk, NORTH),
  new THREE.Vector3(3.35, NET.clk, TICK_CTRL[1]),
  new THREE.Vector3(TICK_CTRL[0], NET.clk, TICK_CTRL[1]),
  new THREE.Vector3(TICK_CTRL[0], BLOCK_TOP, TICK_CTRL[1]),
];

function labelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("label canvas unavailable");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#1c2836";
  context.font = "600 64px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function Label({ text, position, width = 1.5 }: { text: string; position: [number, number, number]; width?: number }) {
  const texture = useMemo(() => labelTexture(text), [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position} rotation={[-Math.PI / 2, HOME_THETA, 0]} raycast={() => null}>
      <planeGeometry args={[width, width * 0.25]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

function gridOrigin(center: [number, number], count: number, pitchX: number, pitchZ: number, cols: number): [number, number] {
  const rows = Math.ceil(count / cols);
  return [center[0] - ((cols - 1) * pitchX) / 2, center[1] - ((rows - 1) * pitchZ) / 2];
}

const HOME_TARGET = new THREE.Vector3(0, 1.05, 0.15);
const HOME_THETA = 0.68;
const HOME_PHI = 1.18;
const HOME_RADIUS = 19;

function OrbitView({ fitView }: { fitView: number }) {
  const { camera, gl, size } = useThree();
  const target = useRef(HOME_TARGET.clone());
  const theta = useRef(HOME_THETA);
  const phi = useRef(HOME_PHI);
  const radius = useRef(HOME_RADIUS);
  const scratch = useMemo(
    () => ({
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      eye: new THREE.Vector3(),
    }),
    [],
  );

  const apply = useMemo(() => {
    return () => {
      const sinPhi = Math.sin(phi.current);
      scratch.eye.set(
        target.current.x + radius.current * sinPhi * Math.sin(theta.current),
        target.current.y + radius.current * Math.cos(phi.current),
        target.current.z + radius.current * sinPhi * Math.cos(theta.current),
      );
      camera.up.set(0, 1, 0);
      camera.position.copy(scratch.eye);
      camera.lookAt(target.current);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.near = 0.08;
        camera.far = 90;
        camera.updateProjectionMatrix();
      }
    };
  }, [camera, scratch.eye]);

  const frameDie = useMemo(() => {
    return () => {
      theta.current = HOME_THETA;
      phi.current = HOME_PHI;
      radius.current = HOME_RADIUS;
      target.current.copy(HOME_TARGET);
      apply();
    };
  }, [apply]);

  useLayoutEffect(() => {
    frameDie();
  }, [frameDie, fitView]);

  useEffect(() => {
    apply();
  }, [apply, size.height, size.width]);

  useEffect(() => {
    const el = gl.domElement;
    let down = false;
    let shift = false;
    let startX = 0;
    let startY = 0;
    let originTheta = 0;
    let originPhi = 0;
    const originTarget = new THREE.Vector3();

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      radius.current = THREE.MathUtils.clamp(radius.current * (event.deltaY > 0 ? 1.08 : 0.92), 5.5, 36);
      apply();
    }

    function onDown(event: PointerEvent) {
      if (event.button !== 0) return;
      down = true;
      shift = event.shiftKey;
      pointerState.panned = false;
      startX = event.clientX;
      startY = event.clientY;
      originTheta = theta.current;
      originPhi = phi.current;
      originTarget.copy(target.current);
    }

    function onMove(event: PointerEvent) {
      if (!down) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.hypot(dx, dy) < 4) return;
      pointerState.panned = true;
      if (event.shiftKey || shift) {
        scratch.forward.subVectors(target.current, camera.position).normalize();
        scratch.right.crossVectors(scratch.forward, camera.up).normalize();
        scratch.up.crossVectors(scratch.right, scratch.forward).normalize();
        const scale = radius.current * 0.0016;
        target.current.copy(originTarget);
        target.current.addScaledVector(scratch.right, -dx * scale);
        target.current.addScaledVector(scratch.up, dy * scale);
        target.current.x = THREE.MathUtils.clamp(target.current.x, -6, 6);
        target.current.y = THREE.MathUtils.clamp(target.current.y, -0.2, 2.4);
        target.current.z = THREE.MathUtils.clamp(target.current.z, -4.5, 4.5);
      } else {
        theta.current = originTheta - dx * 0.005;
        phi.current = THREE.MathUtils.clamp(originPhi + dy * 0.004, 0.28, 1.48);
      }
      apply();
    }

    function onUp() {
      down = false;
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("dblclick", frameDie);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("dblclick", frameDie);
    };
  }, [apply, camera, frameDie, gl, scratch]);

  return null;
}

function ClockPulse({ step, dim }: { step: number; dim: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const phase = useRef(1);
  const seen = useRef(step);
  const lengths = useMemo(() => {
    const segment = CLOCK_PATH.slice(1).map((point, index) => point.distanceTo(CLOCK_PATH[index]));
    const total = segment.reduce((sum, length) => sum + length, 0);
    return { segment, total };
  }, []);

  useFrame((_, delta) => {
    if (!mesh.current) return;
    if (seen.current !== step) {
      seen.current = step;
      if (phase.current >= 1) phase.current = 0;
    }
    if (phase.current >= 1) {
      mesh.current.position.copy(CLOCK_PATH[0]);
      return;
    }
    phase.current = Math.min(1, phase.current + delta * 2.4);
    let distance = phase.current * lengths.total;
    let index = 0;
    while (index < lengths.segment.length - 1 && distance > lengths.segment[index]) {
      distance -= lengths.segment[index];
      index += 1;
    }
    const span = lengths.segment[index] || 1;
    mesh.current.position.lerpVectors(CLOCK_PATH[index], CLOCK_PATH[index + 1], distance / span);
  });

  return (
    <mesh ref={mesh} position={CLOCK_PATH[0]}>
      <sphereGeometry args={[0.11, 16, 12]} />
      <meshStandardMaterial color="#f0b429" emissive="#f0b429" emissiveIntensity={dim ? 0 : 2.2} transparent={dim} opacity={dim ? 0.05 : 1} depthWrite={!dim} />
    </mesh>
  );
}

function BitGrid({
  center,
  pitch,
  cell,
  idle,
  hot,
  spikes,
  mark,
  onPick,
  dim = false,
}: {
  center: [number, number];
  pitch: number;
  cell: number;
  idle: string;
  hot?: string;
  spikes?: Set<number>;
  mark?: Set<number>;
  onPick?: (id: number) => void;
  dim?: boolean;
}) {
  const mesh = useMemo(() => {
    const geometry = new THREE.BoxGeometry(cell, 0.05, cell);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.45 });
    const instanced = new THREE.InstancedMesh(geometry, material, 256);
    const dummy = new THREE.Object3D();
    const [originX, originZ] = gridOrigin(center, 256, pitch, pitch, 16);
    for (let id = 0; id < 256; id += 1) {
      dummy.position.set(originX + (id % 16) * pitch, 0.2, originZ + Math.floor(id / 16) * pitch);
      dummy.updateMatrix();
      instanced.setMatrixAt(id, dummy.matrix);
    }
    return instanced;
  }, [cell, center, pitch]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    };
  }, [mesh]);

  useLayoutEffect(() => {
    const color = new THREE.Color();
    for (let id = 0; id < 256; id += 1) {
      if (spikes?.has(id) && hot) color.set(hot);
      else if (mark?.has(id)) color.set("#7ec8ff");
      else color.set(idle);
      mesh.setColorAt(id, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.transparent = dim;
    material.opacity = dim ? 0.15 : 1;
  }, [dim, hot, idle, mark, mesh, spikes]);

  return (
    <primitive
      object={mesh}
      onClick={(event: { stopPropagation: () => void; instanceId?: number }) => {
        if (pointerState.panned || !onPick) return;
        event.stopPropagation();
        if (typeof event.instanceId === "number") onPick(event.instanceId);
      }}
    />
  );
}

function Metal({
  from,
  to,
  y,
  color,
  active,
  girth = 0.045,
  height = 0.03,
  dim = false,
}: {
  from: [number, number];
  to: [number, number];
  y: number;
  color: string;
  active: boolean;
  girth?: number;
  height?: number;
  dim?: boolean;
}) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  if (length < 0.008) return null;
  const lit = active && !dim;
  const shown = lit ? "#f0b429" : color;
  return (
    <mesh position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]} raycast={() => null}>
      <boxGeometry args={[length, height, girth]} />
      <meshStandardMaterial color={shown} emissive={shown} emissiveIntensity={lit ? 0.65 : 0} metalness={0.82} roughness={0.22} transparent={dim} opacity={dim ? 0.05 : 1} depthWrite={!dim} />
    </mesh>
  );
}

function Riser({
  x,
  z,
  y0,
  y1,
  color,
  active,
  girth = 0.045,
  dim = false,
}: {
  x: number;
  z: number;
  y0: number;
  y1: number;
  color: string;
  active: boolean;
  girth?: number;
  dim?: boolean;
}) {
  const height = Math.abs(y1 - y0);
  if (height < 0.02) return null;
  const lit = active && !dim;
  const shown = lit ? "#f0b429" : color;
  return (
    <mesh position={[x, (y0 + y1) / 2, z]} raycast={() => null}>
      <boxGeometry args={[girth, height, girth]} />
      <meshStandardMaterial color={shown} emissive={shown} emissiveIntensity={lit ? 0.65 : 0} metalness={0.82} roughness={0.22} transparent={dim} opacity={dim ? 0.05 : 1} depthWrite={!dim} />
    </mesh>
  );
}

function PickBlock({
  name,
  picked,
  dim,
  hot,
  idle,
  position,
  size,
  onPick,
}: {
  name: StructureName;
  picked: boolean;
  dim: boolean;
  hot: boolean;
  idle: string;
  position: [number, number, number];
  size: [number, number, number];
  onPick: (name: StructureName) => void;
}) {
  const color = hot && !dim ? "#f0b429" : idle;
  return (
    <group position={position}>
      {picked ? (
        <mesh raycast={() => null}>
          <boxGeometry args={[size[0] + 0.08, size[1] + 0.08, size[2] + 0.08]} />
          <meshStandardMaterial color="#7ec8ff" emissive="#7ec8ff" emissiveIntensity={0.9} transparent opacity={0.55} />
        </mesh>
      ) : null}
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onPick(name);
        }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={color}
          emissive={picked ? "#7ec8ff" : hot && !dim ? "#f0b429" : "#000000"}
          emissiveIntensity={picked ? 0.75 : hot && !dim ? 0.45 : 0}
          metalness={0.4}
          roughness={0.4}
          transparent={dim}
          opacity={dim ? 0.15 : 1}
        />
      </mesh>
    </group>
  );
}

type GateFace = {
  name: StructureName;
  hot: boolean;
  dim: boolean;
  picked: boolean;
  onPick: (name: StructureName) => void;
};

const THIN = 0.012;

function MarkWire({
  from,
  to,
  face,
  color = "#8ea0b5",
}: {
  from: [number, number];
  to: [number, number];
  face: GateFace;
  color?: string;
}) {
  return <Metal from={from} to={to} y={0} color={color} active={face.hot} dim={face.dim} girth={THIN} height={0.01} />;
}

function CellShell({
  face,
  w = 0.34,
  d = 0.28,
  children,
}: {
  face: GateFace;
  w?: number;
  d?: number;
  children?: ReactNode;
}) {
  const lit = face.hot && !face.dim;
  const hw = w / 2;
  const hd = d / 2;
  const well = lit ? "#f3d48a" : "#d5dee8";
  return (
    <>
      <mesh
        onClick={(event) => {
          if (pointerState.panned) return;
          event.stopPropagation();
          face.onPick(face.name);
        }}
      >
        <boxGeometry args={[w, 0.03, d]} />
        <meshStandardMaterial
          color={well}
          emissive={face.picked ? "#7ec8ff" : lit ? "#f0b429" : "#000000"}
          emissiveIntensity={face.picked ? 0.4 : lit ? 0.2 : 0}
          metalness={0.12}
          roughness={0.72}
          transparent={face.dim}
          opacity={face.dim ? 0.16 : 0.95}
          depthWrite={!face.dim}
        />
      </mesh>
      <group position={[0, 0.022, 0]}>
        <MarkWire face={face} color="#6d7e94" from={[-hw, -hd]} to={[hw, -hd]} />
        <MarkWire face={face} color="#6d7e94" from={[hw, -hd]} to={[hw, hd]} />
        <MarkWire face={face} color="#6d7e94" from={[hw, hd]} to={[-hw, hd]} />
        <MarkWire face={face} color="#6d7e94" from={[-hw, hd]} to={[-hw, -hd]} />
        {children}
      </group>
    </>
  );
}

function Outline({ size, position }: { size: [number, number, number]; position: [number, number, number] }) {
  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, [size[0], size[1], size[2]]);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <lineSegments position={position} geometry={edges} raycast={() => null}>
      <lineBasicMaterial color="#7ec8ff" />
    </lineSegments>
  );
}

function Jump({
  from,
  to,
  y,
  hot,
  dim,
  color = "#cbbd9a",
}: {
  from: [number, number];
  to: [number, number];
  y: number;
  hot: boolean;
  dim: boolean;
  color?: string;
}) {
  return <Metal from={from} to={to} y={y} color={color} active={hot} dim={dim} girth={THIN} height={0.01} />;
}

function ShiftMark({ at, face }: { at: [number, number, number]; face: GateFace }) {
  return (
    <group position={at}>
      <CellShell face={face}>
        <MarkWire face={face} from={[0.17, 0]} to={[0.06, 0]} />
        <MarkWire face={face} from={[0.06, -0.05]} to={[-0.02, -0.05]} />
        <MarkWire face={face} from={[0.02, 0]} to={[-0.06, 0]} />
        <MarkWire face={face} from={[-0.02, 0.05]} to={[-0.1, 0.05]} />
        <MarkWire face={face} from={[0, 0]} to={[0, -0.14]} />
      </CellShell>
    </group>
  );
}

function AddMark({ at, face }: { at: [number, number, number]; face: GateFace }) {
  return (
    <group position={at}>
      <CellShell face={face}>
        <MarkWire face={face} color="#7f93ab" from={[-0.17, 0.05]} to={[0, 0]} />
        <MarkWire face={face} color="#7f93ab" from={[-0.17, -0.05]} to={[0, 0]} />
        <MarkWire face={face} color="#7f93ab" from={[0, 0.14]} to={[0, 0]} />
        <MarkWire face={face} color="#7f93ab" from={[0, 0]} to={[0.17, 0]} />
      </CellShell>
    </group>
  );
}

function ChevronMark({ at, face }: { at: [number, number, number]; face: GateFace }) {
  return (
    <group position={at}>
      <CellShell face={face}>
        <MarkWire face={face} color="#c4a56a" from={[-0.17, 0]} to={[-0.02, 0]} />
        <MarkWire face={face} color="#e4d7bc" from={[-0.02, -0.08]} to={[-0.02, 0.08]} />
        <MarkWire face={face} color="#c4a56a" from={[-0.02, 0]} to={[0, 0.14]} />
      </CellShell>
    </group>
  );
}

function MuxMark({ at, face }: { at: [number, number, number]; face: GateFace }) {
  return (
    <group position={at}>
      <CellShell face={face}>
        <MarkWire face={face} color="#6e8c98" from={[-0.17, 0.06]} to={[0.04, 0]} />
        <MarkWire face={face} color="#6e8c98" from={[-0.17, -0.06]} to={[0.04, 0]} />
        <MarkWire face={face} color="#cbbd9a" from={[0, 0.14]} to={[0, 0]} />
        <MarkWire face={face} color="#a7844a" from={[0, -0.14]} to={[0.04, 0]} />
        <MarkWire face={face} color="#7d5e38" from={[0.04, 0]} to={[0.17, 0]} />
      </CellShell>
    </group>
  );
}

function AndMark({ at, face }: { at: [number, number, number]; face: GateFace }) {
  return (
    <group position={at}>
      <CellShell face={face}>
        <MarkWire face={face} from={[-0.17, 0]} to={[0.17, 0]} />
        <MarkWire face={face} color="#6e8c98" from={[-0.05, -0.08]} to={[-0.05, 0.08]} />
        <MarkWire face={face} color="#6e8c98" from={[0, -0.14]} to={[0, 0.08]} />
      </CellShell>
    </group>
  );
}

function InvMark({ at, face }: { at: [number, number, number]; face: GateFace }) {
  const lit = face.hot && !face.dim;
  const shown = lit ? "#f0b429" : "#cbbd9a";
  return (
    <group position={at}>
      <CellShell face={face}>
        <MarkWire face={face} color="#cbbd9a" from={[-0.17, 0]} to={[-0.02, 0]} />
        <MarkWire face={face} color="#cbbd9a" from={[-0.02, -0.08]} to={[-0.02, 0.08]} />
        <MarkWire face={face} color="#cbbd9a" from={[-0.02, 0]} to={[0.1, 0]} />
        <MarkWire face={face} color="#cbbd9a" from={[0.06, 0]} to={[0, -0.14]} />
        <mesh position={[0.12, 0, 0]} raycast={() => null}>
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color={shown} emissive={lit ? shown : "#000000"} emissiveIntensity={lit ? 0.45 : 0} transparent={face.dim} opacity={face.dim ? 0.15 : 1} depthWrite={!face.dim} />
        </mesh>
        <MarkWire face={face} color="#cbbd9a" from={[0.14, 0]} to={[0.17, 0]} />
      </CellShell>
    </group>
  );
}

function RegMark({ at, face, wide = 0.18, depth = 0.22 }: { at: [number, number, number]; face: GateFace; wide?: number; depth?: number }) {
  const hw = wide / 2;
  const hd = depth / 2;
  return (
    <group position={at}>
      <CellShell face={face} w={wide} d={depth}>
        <MarkWire face={face} color="#7f93ab" from={[-hw, 0]} to={[hw, 0]} />
        <MarkWire face={face} color="#7f93ab" from={[-hw * 0.45, 0.035]} to={[hw * 0.45, 0.035]} />
        <MarkWire face={face} color="#7f93ab" from={[hw * 0.45, 0.035]} to={[hw * 0.45, -0.02]} />
        <MarkWire face={face} color="#7f93ab" from={[hw * 0.45, -0.02]} to={[-hw * 0.45, -0.02]} />
        <MarkWire face={face} color="#7f93ab" from={[-hw * 0.45, -0.02]} to={[-hw * 0.45, 0.035]} />
        <MarkWire face={face} color="#cbbd9a" from={[0, 0]} to={[0, hd]} />
      </CellShell>
    </group>
  );
}

function DecayGates(face: GateFace) {
  return (
    <group position={[-4.2, 0, ROW_Z]}>
      {face.picked ? <Outline size={[0.9, 0.28, 0.95]} position={[-0.12, 0.55, 0.02]} /> : null}
      <ShiftMark at={[-0.18, 0.55, 0.28]} face={face} />
      <AddMark at={[-0.18, 0.55, -0.28]} face={face} />
      <Jump from={[-0.18, 0.14]} to={[-0.18, -0.14]} y={0.68} hot={face.hot} dim={face.dim} color="#cbbd9a" />
      <Jump from={[-0.42, 0]} to={[-0.35, -0.28]} y={0.62} hot={face.hot} dim={face.dim} color="#a7844a" />
      <Jump from={[-0.01, 0.28]} to={[0.22, 0.1]} y={0.72} hot={face.hot} dim={face.dim} />
      <Jump from={[-0.01, -0.28]} to={[0.22, -0.1]} y={0.74} hot={face.hot} dim={face.dim} color="#7d5e38" />
      <Riser x={-0.42} z={0} y0={0.62} y1={NET.drive_rd} color="#a7844a" active={face.hot} dim={face.dim} girth={THIN} />
      <Riser x={0.22} z={0.1} y0={0.72} y1={NET.v_rd} color="#a7844a" active={face.hot} dim={face.dim} girth={THIN} />
      <Riser x={0.22} z={-0.1} y0={0.74} y1={NET.v_sum} color="#7d5e38" active={face.hot} dim={face.dim} girth={THIN} />
    </group>
  );
}

function CompareGates(face: GateFace) {
  return (
    <group position={[COMPARE_X, 0, ROW_Z]}>
      {face.picked ? <Outline size={[0.95, 0.28, 0.7]} position={[-0.16, 0.55, 0.04]} /> : null}
      <ChevronMark at={[-0.22, 0.55, 0]} face={face} />
      <Jump from={[-0.39, 0]} to={[0, 0]} y={0.66} hot={face.hot} dim={face.dim} color="#7d5e38" />
      <Riser x={-0.22} z={0.14} y0={0.66} y1={NET.spike_bit} color="#cbbd9a" active={face.hot} dim={face.dim} girth={THIN} />
      <Jump from={[-0.22, 0.14]} to={[0, 0]} y={NET.spike_bit} hot={face.hot} dim={face.dim} />
    </group>
  );
}

function SynapseGates(face: GateFace) {
  return (
    <group position={[SYN_X, 0, SYN_Z]}>
      {face.picked ? <Outline size={[1.15, 0.28, 0.7]} position={[-0.02, 0.55, 0.02]} /> : null}
      <AddMark at={[-0.34, 0.55, 0]} face={face} />
      <MuxMark at={[0.28, 0.55, 0.06]} face={face} />
      <Jump from={[-0.17, 0]} to={[0.11, 0.06]} y={0.7} hot={face.hot} dim={face.dim} color="#a7844a" />
      <Jump from={[0, 0]} to={[0.28, 0.2]} y={0.64} hot={face.hot} dim={face.dim} />
      <Jump from={[0.45, 0.06]} to={[0, 0]} y={0.76} hot={face.hot} dim={face.dim} color="#7d5e38" />
      <Riser x={-0.34} z={0.14} y0={0.74} y1={NET.weight_rd} color="#a7844a" active={face.hot} dim={face.dim} girth={THIN} />
      <Jump from={[-0.34, 0.14]} to={[0, 0]} y={NET.weight_rd} hot={face.hot} dim={face.dim} color="#a7844a" />
      <Riser x={0.28} z={-0.08} y0={0.7} y1={NET.v_post_rd} color="#a7844a" active={face.hot} dim={face.dim} girth={THIN} />
      <Jump from={[0.28, -0.08]} to={[0, 0]} y={NET.v_post_rd} hot={face.hot} dim={face.dim} color="#a7844a" />
    </group>
  );
}

function MotorGates(face: GateFace) {
  return (
    <group position={[MINC_X, 0, MINC_Z]}>
      {face.picked ? <Outline size={[1.15, 0.28, 0.75]} position={[0.02, 0.55, 0]} /> : null}
      <AndMark at={[-0.32, 0.55, 0.16]} face={face} />
      <AddMark at={[0.28, 0.55, -0.16]} face={face} />
      <Jump from={[-0.15, 0.16]} to={[0.11, -0.16]} y={0.7} hot={face.hot} dim={face.dim} />
      <Jump from={[-0.32, 0.02]} to={[0, 0]} y={0.74} hot={face.hot} dim={face.dim} />
      <Jump from={[0, 0]} to={[-0.49, 0.16]} y={0.66} hot={face.hot} dim={face.dim} color="#6e8c98" />
      <Jump from={[0.45, -0.16]} to={[0, 0]} y={0.76} hot={face.hot} dim={face.dim} color="#7d5e38" />
    </group>
  );
}

function TickGates(face: GateFace) {
  return (
    <group position={[TICK_CTRL[0], 0, TICK_CTRL[1]]}>
      {face.picked ? <Outline size={[1.35, 0.32, 0.95]} position={[0, 0.55, 0]} /> : null}
      <InvMark at={[-0.4, 0.55, 0.28]} face={face} />
      <AndMark at={[0.36, 0.55, 0.28]} face={face} />
      <AddMark at={[-0.38, 0.55, -0.28]} face={face} />
      <MuxMark at={[0.38, 0.55, -0.26]} face={face} />
      <Jump from={[-0.23, 0.28]} to={[0.19, 0.28]} y={0.7} hot={face.hot} dim={face.dim} />
      <Jump from={[-0.4, 0.14]} to={[-0.38, -0.14]} y={0.64} hot={face.hot} dim={face.dim} color="#cbbd9a" />
      <Jump from={[-0.21, -0.28]} to={[0.21, -0.26]} y={0.74} hot={face.hot} dim={face.dim} color="#a7844a" />
      <Jump from={[0, 0]} to={[-0.57, 0.28]} y={0.6} hot={face.hot} dim={face.dim} />
      <Jump from={[0, 0]} to={[0.36, 0.14]} y={0.66} hot={face.hot} dim={face.dim} />
      <Jump from={[0, 0]} to={[-0.55, -0.28]} y={0.72} hot={face.hot} dim={face.dim} color="#a7844a" />
      <Jump from={[0.55, -0.26]} to={[0, 0]} y={0.78} hot={face.hot} dim={face.dim} color="#7d5e38" />
    </group>
  );
}

function CycleGates(face: GateFace) {
  const slots = [-0.42, -0.21, 0, 0.21, 0.42];
  return (
    <group position={[-1.7, 0, -2.45]}>
      {face.picked ? <Outline size={[1.2, 0.28, 0.48]} position={[0, 0.46, 0]} /> : null}
      {slots.map((x, index) => (
        <group key={x}>
          <RegMark at={[x, 0.42, 0]} face={face} wide={0.16} depth={0.2} />
          {index < slots.length - 1 ? (
            <Jump from={[x + 0.08, 0]} to={[slots[index + 1] - 0.08, 0]} y={0.58} hot={face.hot} dim={face.dim} color="#a7844a" />
          ) : null}
        </group>
      ))}
      <Jump from={[0, 0.1]} to={[0, 0.2]} y={0.64} hot={face.hot} dim={face.dim} />
    </group>
  );
}

function AccumBit({ x, face }: { x: number; face: GateFace }) {
  return (
    <group position={[x, 0, -2.45]}>
      {face.picked ? <Outline size={[0.46, 0.24, 0.48]} position={[0, 0.42, 0.08]} /> : null}
      <RegMark at={[0, 0.4, 0]} face={face} wide={0.34} depth={0.28} />
      <Jump from={[0, 0.14]} to={[0, 0.24]} y={0.56} hot={face.hot} dim={face.dim} color="#a7844a" />
    </group>
  );
}

function NeuronBody({ wide, face }: { wide: number; face: GateFace }) {
  const lit = face.hot && !face.dim;
  const shown = lit ? "#f0b429" : "#8d6b3a";
  const depth = Math.max(0.32, wide * 0.62);
  return (
    <group>
      {face.picked ? <Outline size={[wide + 0.1, 0.18, depth + 0.1]} position={[0, 0.05, 0]} /> : null}
      <mesh
        position={[0, 0.04, 0]}
        onClick={(event) => {
          if (pointerState.panned) return;
          event.stopPropagation();
          face.onPick(face.name);
        }}
      >
        <boxGeometry args={[wide, 0.07, depth]} />
        <meshStandardMaterial
          color={shown}
          emissive={face.picked ? "#7ec8ff" : lit ? shown : "#000000"}
          emissiveIntensity={face.picked ? 0.7 : lit ? 0.55 : 0}
          metalness={0.55}
          roughness={0.35}
          transparent={face.dim}
          opacity={face.dim ? 0.15 : 1}
        />
      </mesh>
      <Metal from={[0, -depth / 2]} to={[0, -depth / 2 - 0.35]} y={0.14} color="#8d6b3a" active={face.hot} dim={face.dim} girth={0.014} height={0.01} />
      <Metal from={[0, depth / 2]} to={[0, depth / 2 + 0.35]} y={0.14} color="#8d6b3a" active={face.hot} dim={face.dim} girth={0.014} height={0.01} />
    </group>
  );
}

function SynapseSram({ pre, spikes, show, mark, dim = false }: { pre: number[]; spikes: Set<number>; show: boolean; mark: Set<number>; dim?: boolean }) {
  const mesh = useMemo(() => {
    const geometry = new THREE.BoxGeometry(0.05, 0.035, 0.032);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 });
    const instanced = new THREE.InstancedMesh(geometry, material, pre.length);
    const dummy = new THREE.Object3D();
    const [originX, originZ] = gridOrigin(SRAM_CENTER, pre.length, SRAM_PITCH_X, SRAM_PITCH_Z, SRAM_COLS);
    for (let row = 0; row < pre.length; row += 1) {
      dummy.position.set(
        originX + (row % SRAM_COLS) * SRAM_PITCH_X,
        0.18,
        originZ + Math.floor(row / SRAM_COLS) * SRAM_PITCH_Z,
      );
      dummy.updateMatrix();
      instanced.setMatrixAt(row, dummy.matrix);
    }
    return instanced;
  }, [pre]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    };
  }, [mesh]);

  useLayoutEffect(() => {
    const color = new THREE.Color();
    for (let row = 0; row < pre.length; row += 1) {
      if (show && spikes.has(pre[row])) color.set("#f2c14e");
      else if (mark.has(pre[row])) color.set("#7ec8ff");
      else color.set("#6e9a86");
      mesh.setColorAt(row, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.transparent = dim;
    material.opacity = dim ? 0.15 : 1;
  }, [dim, mark, mesh, pre, show, spikes]);

  return <primitive object={mesh} />;
}

function MotorIndex({ spikes, show, mark, onPick, dim = false }: { spikes: Set<number>; show: boolean; mark: Set<number>; onPick: (id: number) => void; dim?: boolean }) {
  const mesh = useMemo(() => {
    const geometry = new THREE.BoxGeometry(0.055, 0.04, 0.055);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.35 });
    const instanced = new THREE.InstancedMesh(geometry, material, 256);
    const dummy = new THREE.Object3D();
    const [originX, originZ] = gridOrigin(INDEX_CENTER, 256, INDEX_PITCH, INDEX_PITCH, 16);
    for (let id = 0; id < 256; id += 1) {
      dummy.position.set(originX + (id % 16) * INDEX_PITCH, 0.18, originZ + Math.floor(id / 16) * INDEX_PITCH);
      dummy.updateMatrix();
      instanced.setMatrixAt(id, dummy.matrix);
    }
    return instanced;
  }, []);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    };
  }, [mesh]);

  useLayoutEffect(() => {
    const color = new THREE.Color();
    for (let id = 0; id < 256; id += 1) {
      if (show && spikes.has(id)) color.set("#9ec0ff");
      else if (mark.has(id)) color.set("#7ec8ff");
      else color.set("#8aa0b8");
      mesh.setColorAt(id, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.transparent = dim;
    material.opacity = dim ? 0.15 : 1;
  }, [dim, mark, mesh, show, spikes]);

  return (
    <primitive
      object={mesh}
      onClick={(event: { stopPropagation: () => void; instanceId?: number }) => {
        if (pointerState.panned) return;
        event.stopPropagation();
        if (typeof event.instanceId === "number") onPick(event.instanceId);
      }}
    />
  );
}

function padName(name: string): string {
  const short: Record<string, string> = {
    yaw_left: "YAW L",
    yaw_right: "YAW R",
    pitch_up: "PITCH",
    groom_fore: "GRM F",
    groom_hind: "GRM H",
    groom_wing: "GRM W",
    escape: "ESC",
  };
  return short[name] ?? name.toUpperCase();
}

function Pad({ name, position, width = 0.42 }: { name: string; position: [number, number, number]; width?: number }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[width, 0.08, 0.28]} />
        <meshStandardMaterial color="#c6a15a" metalness={0.75} roughness={0.28} />
      </mesh>
      <Label text={name} position={[0, 0.1, 0]} width={width + 0.12} />
    </group>
  );
}

function cellXZ(center: [number, number], pitch: number, id: number): [number, number] {
  const [originX, originZ] = gridOrigin(center, 256, pitch, pitch, 16);
  return [originX + (id % 16) * pitch, originZ + Math.floor(id / 16) * pitch];
}

function rowXZ(count: number, row: number): [number, number] {
  const [originX, originZ] = gridOrigin(SRAM_CENTER, count, SRAM_PITCH_X, SRAM_PITCH_Z, SRAM_COLS);
  return [originX + (row % SRAM_COLS) * SRAM_PITCH_X, originZ + Math.floor(row / SRAM_COLS) * SRAM_PITCH_Z];
}

function Vias({ segments, color, opacity = 1 }: { segments: Seg[]; color: string; opacity?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const start = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  useLayoutEffect(() => {
    const drawn = mesh.current;
    if (!drawn) return;
    let count = 0;
    segments.forEach((seg) => {
      start.set(seg[0], seg[1], seg[2]);
      end.set(seg[3], seg[4], seg[5]);
      dir.subVectors(end, start);
      const length = dir.length();
      if (length < 0.01) return;
      dir.multiplyScalar(1 / length);
      dummy.position.copy(start).addScaledVector(dir, length / 2);
      dummy.quaternion.setFromUnitVectors(up, dir);
      dummy.scale.set(1, length, 1);
      dummy.updateMatrix();
      drawn.setMatrixAt(count, dummy.matrix);
      count += 1;
    });
    drawn.count = count;
    drawn.instanceMatrix.needsUpdate = true;
  }, [dir, dummy, end, segments, start, up]);

  if (segments.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, segments.length]} frustumCulled={false} raycast={() => null}>
      <cylinderGeometry args={[0.008, 0.008, 1, 5]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={opacity < 1 ? 0 : 0.45} metalness={0.62} roughness={0.3} transparent={opacity < 1} opacity={opacity} />
    </instancedMesh>
  );
}

const BRAIN_Y = 4.35;
const BRAIN_GIRTH = 0.014;
const LPLC2_X0 = -3.5;
const LPLC2_PITCH = 1;
const LPLC2_Z = 1.9;

function isGiantFiberEdge(preId: number, postId: number, neurons: { circuit?: string | null; motor: string | null }[]): boolean {
  const pre = neurons[preId];
  const post = neurons[postId];
  const loom = preId >= 88 && preId < 96;
  if (loom && post?.circuit === "lplc2") return true;
  if (loom && post?.circuit === "lc4") return true;
  if (pre?.circuit === "lplc2" && post?.circuit === "gf") return true;
  if (pre?.circuit === "lc4" && post?.circuit === "gf") return true;
  if (pre?.circuit === "gf" && post?.circuit === "psi") return true;
  if (pre?.circuit === "gf" && post?.motor === "escape") return true;
  if (pre?.circuit === "psi" && post?.motor === "thrust") return true;
  return false;
}

function circuitXZ(neurons: { id: number; circuit?: string | null }[]): Map<number, [number, number]> {
  const placed = new Map<number, [number, number]>();
  const lplc2 = neurons.filter((neuron) => neuron.circuit === "lplc2").sort((a, b) => a.id - b.id);
  lplc2.forEach((neuron, index) => placed.set(neuron.id, [LPLC2_X0 + index * LPLC2_PITCH, LPLC2_Z]));
  const lc4 = neurons.find((neuron) => neuron.circuit === "lc4");
  const gf = neurons.find((neuron) => neuron.circuit === "gf");
  const psi = neurons.find((neuron) => neuron.circuit === "psi");
  if (lc4) placed.set(lc4.id, [4.2, 0.9]);
  if (gf) placed.set(gf.id, [0.5, -0.4]);
  if (psi) placed.set(psi.id, [-1.5, -0.4]);
  return placed;
}

function neuronXZ(id: number, blocks: Map<number, [number, number]>): [number, number] {
  const block = blocks.get(id);
  if (block) return block;
  if (id >= 232) {
    const slot = Math.floor((id - 232) / MOTOR_GROUP);
    const side = (id - 232) % MOTOR_GROUP === 0 ? -0.12 : 0.12;
    return [MOTOR_X0 + slot * MOTOR_PITCH + side, -2.45];
  }
  return cellXZ(SPIKE_CENTER, SPIKE_PITCH, id);
}

function BrainHop({
  from,
  to,
  active,
  dim,
  fromSheet,
  toSheet,
}: {
  from: [number, number];
  to: [number, number];
  active: boolean;
  dim: boolean;
  fromSheet: boolean;
  toSheet: boolean;
}) {
  return (
    <group>
      {fromSheet ? null : <Riser x={from[0]} z={from[1]} y0={CELL_Y} y1={BRAIN_Y} color="#8d6b3a" active={active} girth={BRAIN_GIRTH} dim={dim} />}
      <Metal from={from} to={[to[0], from[1]]} y={BRAIN_Y} color="#8d6b3a" active={active} girth={BRAIN_GIRTH} height={0.01} dim={dim} />
      <Metal from={[to[0], from[1]]} to={to} y={BRAIN_Y} color="#8d6b3a" active={active} girth={BRAIN_GIRTH} height={0.01} dim={dim} />
      {toSheet ? null : <Riser x={to[0]} z={to[1]} y0={0.46} y1={BRAIN_Y} color="#8d6b3a" active={active} girth={BRAIN_GIRTH} dim={dim} />}
    </group>
  );
}

function circuitStructure(circuit: string | null | undefined): StructureName | null {
  if (circuit === "lplc2") return "LPLC2";
  if (circuit === "lc4") return "LC4";
  if (circuit === "gf") return "GF";
  if (circuit === "psi") return "PSI";
  return null;
}

function GiantFiber({
  neurons,
  pre,
  post,
  spiked,
  structure,
  onPick,
}: {
  neurons: { id: number; circuit?: string | null; motor: string | null }[];
  pre: number[];
  post: number[];
  spiked: Set<number>;
  structure: StructureName | null;
  onPick: (name: StructureName) => void;
}) {
  const blocks = useMemo(() => circuitXZ(neurons), [neurons]);
  const edges = useMemo(() => {
    const found: { pre: number; post: number }[] = [];
    pre.forEach((preId, index) => {
      const postId = post[index];
      if (isGiantFiberEdge(preId, postId, neurons)) found.push({ pre: preId, post: postId });
    });
    return found;
  }, [neurons, post, pre]);
  const hot = (id: number) => spiked.has(id);
  return (
    <group>
      {neurons
        .filter((neuron) => neuron.circuit === "lplc2" || neuron.circuit === "lc4" || neuron.circuit === "gf" || neuron.circuit === "psi")
        .map((neuron) => {
          const at = blocks.get(neuron.id);
          if (!at) return null;
          const wide = neuron.circuit === "lplc2" ? 0.42 : neuron.circuit === "gf" ? 0.9 : 0.72;
          const label = neuron.circuit === "lplc2" ? "" : neuron.circuit === "lc4" ? "LC4" : neuron.circuit === "gf" ? "GF" : "PSI";
          const firing = hot(neuron.id);
          const blockName = circuitStructure(neuron.circuit);
          const picked = blockName !== null && structure === blockName;
          const dim = structure !== null && !picked;
          return (
            <group key={neuron.id} position={[at[0], BRAIN_Y - 0.12, at[1]]}>
              <NeuronBody
                wide={wide}
                face={{ name: blockName ?? "GF", picked, dim, hot: firing, onPick }}
              />
              {label ? <Label text={label} position={[0, 0.32, 0.55]} width={1.05} /> : null}
            </group>
          );
        })}
      {blocks.size > 0 ? (
        <Label text="LPLC2" position={[LPLC2_X0 + 3.5 * LPLC2_PITCH, BRAIN_Y + 0.28, LPLC2_Z + 0.55]} width={1.5} />
      ) : null}
      {edges.map((edge) => {
        const from = neuronXZ(edge.pre, blocks);
        const to = neuronXZ(edge.post, blocks);
        const preCircuit = circuitStructure(neurons[edge.pre]?.circuit);
        const postCircuit = circuitStructure(neurons[edge.post]?.circuit);
        const kept = structure === null || structure === preCircuit || structure === postCircuit;
        return (
          <BrainHop
            key={`${edge.pre}-${edge.post}`}
            from={from}
            to={to}
            active={hot(edge.pre)}
            dim={!kept}
            fromSheet={blocks.has(edge.pre)}
            toSheet={blocks.has(edge.post)}
          />
        );
      })}
    </group>
  );
}

function WireLines({ segments, color, opacity = 1 }: { segments: Seg[]; color: string; opacity?: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(segments.length * 6);
    segments.forEach((segment, index) => {
      positions.set(segment, index * 6);
    });
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return next;
  }, [segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (segments.length === 0) return null;
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </lineSegments>
  );
}

function StageBoard({
  stages,
  spikes,
  pinned,
  onSelect,
}: {
  stages: NeuronStage[];
  spikes: number[];
  pinned: number;
  onSelect: (id: number) => void;
}) {
  const stage = stages[pinned];
  const syn = stage ? stage.input - stage.drive : 0;
  const blocks = stage
    ? [
        ["v", stage.held.toFixed(3)],
        ["×0.92", stage.decayed.toFixed(3)],
        [Math.abs(syn) > 1e-4 ? "+in" : "+drive", (Math.abs(syn) > 1e-4 ? stage.input : stage.drive).toFixed(3)],
        ["≥1", stage.sum.toFixed(3)],
        ["spike", stage.spike ? "1" : "0"],
      ]
    : [];
  const rows = spikes.slice(0, 8);
  if (stage && !rows.includes(pinned)) rows.unshift(pinned);
  return (
    <group>
      {blocks.map(([title, value], index) => (
        <group key={title} position={[-3.5 + index * 1.22, 0.24, 2.18]}>
          <mesh>
            <boxGeometry args={[1.12, 0.07, 0.34]} />
            <meshStandardMaterial
              color={title === "spike" && stage?.spike ? "#f0b429" : "#6d7e94"}
              emissive={title === "spike" && stage?.spike ? "#f0b429" : "#000000"}
              emissiveIntensity={title === "spike" && stage?.spike ? 0.45 : 0}
              metalness={0.35}
              roughness={0.45}
            />
          </mesh>
          <Label text={`${title} ${value}`} position={[0, 0.1, 0]} width={1.08} />
        </group>
      ))}
      {rows.map((id, row) => {
        const sum = stages[id]?.sum ?? 0;
        const length = (Math.min(Math.max(sum, 0), 2) / 2) * 0.7;
        const spiked = stages[id]?.spike ?? false;
        return (
          <group key={id} position={[3.72, 0.22, 1.55 - row * 0.16]}>
            <mesh
              position={[0, 0, 0]}
              onClick={(event) => {
                if (pointerState.panned) return;
                event.stopPropagation();
                onSelect(id);
              }}
            >
              <boxGeometry args={[Math.max(length, 0.08), 0.06, 0.12]} />
              <meshStandardMaterial
                color={id === pinned ? "#7ec8ff" : spiked ? "#f0b429" : "#3d7ea6"}
                emissive={id === pinned ? "#7ec8ff" : spiked ? "#f0b429" : "#000000"}
                emissiveIntensity={id === pinned || spiked ? 0.35 : 0}
              />
            </mesh>
            <Label text={`${id} ${neuronKind(id)}`} position={[0.72, 0.08, 0]} width={0.85} />
          </group>
        );
      })}
    </group>
  );
}

function Die({
  graph,
  spikes,
  driven,
  stages,
  pinned,
  step,
  motorRates,
  focusIds,
  onSelectNeuron,
  structure,
  onPickStructure,
}: {
  graph: ChipGraph;
  spikes: number[];
  driven: number[];
  stages: NeuronStage[];
  pinned: number;
  step: number;
  motorRates: Record<string, number>;
  focusIds: number[];
  onSelectNeuron: (id: number) => void;
  structure: StructureName | null;
  onPickStructure: (name: StructureName) => void;
}) {
  const phase: number = 4;
  const spiked = useMemo(() => new Set(spikes), [spikes]);
  const drivenSet = useMemo(() => new Set(driven), [driven]);
  const focus = useMemo(() => new Set(focusIds), [focusIds]);
  const words = graph.synapses.pre.length;
  const sramRows = Math.ceil(words / SRAM_COLS);
  const showSpikes = phase >= 1;
  const showSynapses = phase >= 2;
  const showMotors = phase >= 3;
  const writeback = useMemo(() => {
    const ids = new Set<number>();
    if (phase < 2) return ids;
    graph.synapses.pre.forEach((pre, row) => {
      if (spiked.has(pre)) ids.add(graph.synapses.post[row]);
    });
    return ids;
  }, [graph.synapses.post, graph.synapses.pre, phase, spiked]);
  const motorSpikes = useMemo(() => {
    const ids = new Set<number>();
    graph.neurons.forEach((neuron) => {
      if (neuron.motor && spiked.has(neuron.id)) ids.add(neuron.id);
    });
    return ids;
  }, [graph.neurons, spiked]);
  const synapseHot = useMemo(() => graph.synapses.pre.some((id) => spiked.has(id)), [graph.synapses.pre, spiked]);
  const motorHot = motorSpikes.size > 0 || MOTOR_NAMES.some((name) => (motorRates[name] ?? 0) > 0);
  const [clockHot, setClockHot] = useState(false);
  const clockSeen = useRef(false);
  useEffect(() => {
    if (!clockSeen.current) {
      clockSeen.current = true;
      return;
    }
    setClockHot(true);
    const timer = window.setTimeout(() => setClockHot(false), 420);
    return () => window.clearTimeout(timer);
  }, [step]);
  const layout = useMemo(() => buildTrunks(words), [words]);
  const rest = useMemo(() => buildRestWires(graph), [graph]);
  const dimNet = (net: Net) => structure !== null && !STRUCTURE_NETS[structure]?.includes(net);
  const dimOf = (name: StructureName) => structure !== null && structure !== name;
  const netHot = (net: Net) => {
    if (net === "drive" || net === "v_rd" || net === "v_shift") return driven.length > 0;
    if (net === "v_sum" || net === "spike_bit" || net === "spikes") return spikes.length > 0;
    if (net === "pre_rd" || net === "syn_en" || net === "weight_rd" || net === "v_post_rd" || net === "post_rd" || net === "v_post_sum") return synapseHot;
    if (net === "motor_spike" || net === "motor_sel" || net === "accum_sum") return motorHot;
    if (net === "clk" || net === "tick" || net === "done" || net === "cycle") return clockHot;
    return false;
  };
  const vias = useMemo(() => buildVias(graph, spiked, drivenSet, focus, phase), [drivenSet, focus, graph, phase, spiked]);
  const litState = useMemo(() => new Set([...drivenSet, ...writeback]), [drivenSet, writeback]);

  return (
    <group>
      <mesh>
        <boxGeometry args={[10.2, 0.14, 7.3]} />
        <meshStandardMaterial color="#c5ced6" metalness={0.45} roughness={0.38} />
      </mesh>
      <ClockPulse step={step} dim={structure !== null && structure !== "tick_ctrl" && structure !== "cycle_count"} />

      <PickBlock
        name="v[256]"
        picked={structure === "v[256]"}
        dim={dimOf("v[256]")}
        hot={false}
        idle="#c5d0dc"
        position={[STATE_CENTER[0], 0.12, STATE_CENTER[1]]}
        size={[16 * STATE_PITCH + 0.06, 0.04, 16 * STATE_PITCH + 0.06]}
        onPick={onPickStructure}
      />
      <BitGrid
        center={STATE_CENTER}
        pitch={STATE_PITCH}
        cell={0.072}
        idle="#7f93ab"
        hot="#f0b429"
        spikes={litState}
        mark={focus}
        onPick={onSelectNeuron}
        dim={dimOf("v[256]")}
      />
      <Label text="v[256]" position={[STATE_CENTER[0], 0.42, ROW_Z + 1.05]} width={0.85} />

      <DecayGates
        name="decay_add"
        picked={structure === "decay_add"}
        dim={dimOf("decay_add")}
        hot={(phase === 0 || phase >= 4) && driven.length > 0}
        onPick={onPickStructure}
      />
      <Label text="decay_add" position={[-4.2, 0.42, ROW_Z - 0.42]} width={1.05} />

      <CompareGates
        name="spike_cmp"
        picked={structure === "spike_cmp"}
        dim={dimOf("spike_cmp")}
        hot={showSpikes && spikes.length > 0}
        onPick={onPickStructure}
      />
      <Label text="spike_cmp" position={[COMPARE_X, 0.44, ROW_Z + 0.42]} width={0.95} />

      <PickBlock
        name="spikes"
        picked={structure === "spikes"}
        dim={dimOf("spikes")}
        hot={false}
        idle="#e4d7bc"
        position={[SPIKE_CENTER[0], 0.12, SPIKE_CENTER[1]]}
        size={[16 * SPIKE_PITCH + 0.06, 0.04, 16 * SPIKE_PITCH + 0.06]}
        onPick={onPickStructure}
      />
      <BitGrid
        center={SPIKE_CENTER}
        pitch={SPIKE_PITCH}
        cell={0.072}
        idle="#c4a56a"
        hot="#f0b429"
        spikes={showSpikes ? spiked : undefined}
        mark={focus}
        onPick={onSelectNeuron}
        dim={dimOf("spikes")}
      />
      <Label text="spikes[255:0]" position={[SPIKE_CENTER[0], 0.42, ROW_Z + 1.05]} width={1.25} />
      <StageBoard stages={stages} spikes={spikes} pinned={pinned} onSelect={onSelectNeuron} />

      {layout.runs.map((run, index) => (
        <Metal key={index} from={run.a} to={run.b} y={run.y} color={run.color} active={netHot(run.net)} dim={dimNet(run.net)} />
      ))}
      {layout.risers.map((riser, index) => (
        <Riser key={index} x={riser.x} z={riser.z} y0={riser.y0} y1={riser.y1} color={riser.color} active={netHot(riser.net)} dim={dimNet(riser.net)} />
      ))}
      <WireLines segments={rest.structure} color="#4e6274" opacity={structure && structure !== "v[256]" && structure !== "spikes" ? 0.12 : 0.85} />
      <GiantFiber neurons={graph.neurons} pre={graph.synapses.pre} post={graph.synapses.post} spiked={spiked} structure={structure} onPick={onPickStructure} />
      <Vias segments={vias.data} color="#f0b429" opacity={structure ? 0.12 : 1} />
      <Vias segments={vias.ctrl} color="#f3e2b3" opacity={structure ? 0.12 : 1} />
      <Vias segments={vias.write} color="#ff9a4a" opacity={structure ? 0.12 : 1} />
      <Vias segments={vias.addr} color="#8fd0c4" opacity={structure ? 0.12 : 1} />
      <Vias segments={vias.focus} color="#7ec8ff" />

      <PickBlock
        name="weight sram"
        picked={structure === "weight sram"}
        dim={dimOf("weight sram")}
        hot={false}
        idle="#c5ddd2"
        position={[SRAM_CENTER[0], 0.12, SRAM_CENTER[1]]}
        size={[SRAM_COLS * SRAM_PITCH_X + 0.12, 0.04, sramRows * SRAM_PITCH_Z + 0.1]}
        onPick={onPickStructure}
      />
      <SynapseSram pre={graph.synapses.pre} spikes={spiked} show={showSynapses} mark={focus} dim={dimOf("weight sram")} />
      <Label text="weight sram" position={[SRAM_CENTER[0], 0.42, ROW_Z + 1.05]} width={1.35} />

      <TickGates name="tick_ctrl" picked={structure === "tick_ctrl"} dim={dimOf("tick_ctrl")} hot={clockHot} onPick={onPickStructure} />
      <Label text="tick_ctrl" position={[2.55, 0.38, -0.4]} width={0.9} />

      <SynapseGates
        name="synapse_add"
        picked={structure === "synapse_add"}
        dim={dimOf("synapse_add")}
        hot={showSynapses && synapseHot}
        onPick={onPickStructure}
      />
      <Label text="synapse_add" position={[SYN_X, 0.46, SYN_Z - 0.42]} width={1.15} />

      <MotorGates name="motor_inc" picked={structure === "motor_inc"} dim={dimOf("motor_inc")} hot={showMotors && motorHot} onPick={onPickStructure} />
      <Label text="motor_inc" position={[MINC_X, 0.46, MINC_Z + 0.42]} width={1.05} />

      <mesh position={[INDEX_CENTER[0], 0.12, INDEX_CENTER[1]]}>
        <boxGeometry args={[16 * INDEX_PITCH + 0.1, 0.04, 16 * INDEX_PITCH + 0.1]} />
        <meshStandardMaterial color="#c5d0dc" />
      </mesh>
      <MotorIndex spikes={motorSpikes} show={showMotors} mark={focus} onPick={onSelectNeuron} dim={structure !== null} />
      <Label text="motor_index" position={[INDEX_CENTER[0], 0.4, INDEX_CENTER[1] - 0.78]} width={1.35} />

      {MOTOR_NAMES.map((name, index) => {
        const active = (motorRates[name] ?? 0) > 0;
        const x = MOTOR_X0 + index * MOTOR_PITCH;
        return (
          <AccumBit
            key={name}
            x={x}
            face={{ name: "motor_accum", picked: structure === "motor_accum", dim: dimOf("motor_accum"), hot: active, onPick: onPickStructure }}
          />
        );
      })}
      <Label text="motor_accum" position={[MOTOR_X0 + 5.5 * MOTOR_PITCH, 0.46, -2.05]} width={1.8} />

      <CycleGates name="cycle_count" picked={structure === "cycle_count"} dim={dimOf("cycle_count")} hot={clockHot} onPick={onPickStructure} />
      <Label text="cycle_count" position={[-1.7, 0.42, -2.85]} width={1.6} />

      <Pad name="CLK" position={[-3.15, 0.16, 3.2]} />
      <Pad name="RST" position={[-1.7, 0.16, 3.2]} />
      <Pad name="TICK" position={[-0.25, 0.16, 3.2]} />
      <Pad name="DRIVE" position={[-4.55, 0.16, ROW_Z]} />
      <Pad name="spikes out" position={[4.42, 0.16, 1.25]} width={0.7} />
      <Pad name="DONE" position={[4.55, 0.16, 0.15]} />
      {MOTOR_NAMES.map((name, index) => (
        <Pad key={name} name={padName(name)} position={[MOTOR_X0 + index * MOTOR_PITCH, 0.16, -3.28]} width={0.55} />
      ))}
    </group>
  );
}

function pushRun(runs: Run[], x1: number, z1: number, x2: number, z2: number, y: number, color: string, net: Net) {
  if (Math.abs(x1 - x2) < 0.001 && Math.abs(z1 - z2) < 0.001) return;
  if (Math.abs(x1 - x2) < 0.001 || Math.abs(z1 - z2) < 0.001) {
    runs.push({ a: [x1, z1], b: [x2, z2], y, color, net });
    return;
  }
  runs.push({ a: [x1, z1], b: [x2, z1], y, color, net });
  runs.push({ a: [x2, z1], b: [x2, z2], y, color, net });
}

function sramZRange(words: number): [number, number] {
  const rows = Math.max(1, Math.ceil(words / SRAM_COLS));
  const z0 = SRAM_CENTER[1] - ((rows - 1) * SRAM_PITCH_Z) / 2;
  return [z0, z0 + (rows - 1) * SRAM_PITCH_Z];
}

function buildRestWires(graph: ChipGraph): { structure: Seg[] } {
  const structure = emptyVias();
  for (let id = 0; id < graph.neurons.length; id += 1) {
    decayTaps(structure, id);
    compareTaps(structure, id);
    const motor = graph.neurons[id]?.motor;
    if (motor) motorTaps(structure, id, motor);
  }
  return {
    structure: [...structure.data, ...structure.ctrl, ...structure.write, ...structure.addr],
  };
}

function buildTrunks(words: number): { runs: Run[]; risers: Riser[] } {
  const runs: Run[] = [];
  const risers: Riser[] = [];
  const add = (x1: number, z1: number, x2: number, z2: number, y: number, color: string, net: Net) =>
    pushRun(runs, x1, z1, x2, z2, y, color, net);
  const rise = (x: number, z: number, y0: number, y1: number, color: string, net: Net) => {
    risers.push({ x, z, y0, y1, color, net });
  };
  const [sramZ0, sramZ1] = sramZRange(words);
  const accumX1 = MOTOR_X0 + (MOTOR_NAMES.length - 1) * MOTOR_PITCH;

  add(-4.55, ROW_Z, DECAY_AT[0], DECAY_AT[1], NET.drive_rd, TONE.data, "drive");
  rise(-4.55, ROW_Z, PAD_Y, NET.drive_rd, TONE.data, "drive");
  add(V_X0, V_RD_Z, V_X1, V_RD_Z, NET.v_rd, TONE.data, "v_rd");
  add(V_X0, V_RD_Z, DECAY_VRD[0], DECAY_VRD[1], NET.v_rd, TONE.data, "v_rd");
  rise(DECAY_VRD[0], DECAY_VRD[1], NET.v_rd, NET.v_shift, TONE.data, "v_rd");
  add(DECAY_VRD[0], DECAY_VRD[1], DECAY_AT[0], ROW_Z + 0.1, NET.v_shift, TONE.ctrl, "v_shift");
  add(DECAY_AT[0], ROW_Z + 0.1, DECAY_AT[0], ROW_Z - 0.1, NET.v_shift, TONE.ctrl, "v_shift");
  add(DECAY_AT[0], ROW_Z - 0.1, DECAY_VSUM[0], DECAY_VSUM[1], NET.v_shift, TONE.ctrl, "v_shift");
  rise(DECAY_AT[0], DECAY_AT[1], BLOCK_TOP, NET.v_shift, TONE.ctrl, "v_shift");
  add(V_X0, V_SUM_Z, COMPARE_X, V_SUM_Z, NET.v_sum, TONE.write, "v_sum");
  add(DECAY_VSUM[0], DECAY_VSUM[1], DECAY_VSUM[0], V_SUM_Z, NET.v_sum, TONE.write, "v_sum");
  add(COMPARE_X, V_SUM_Z, COMPARE_X, ROW_Z, NET.v_sum, TONE.write, "v_sum");
  rise(COMPARE_X, ROW_Z, BLOCK_TOP, NET.v_sum, TONE.write, "v_sum");
  add(SP_X0, SPIKE_BIT_Z, SP_X1, SPIKE_BIT_Z, NET.spike_bit, TONE.ctrl, "spike_bit");
  add(COMPARE_X, ROW_Z, SP_X0, SPIKE_BIT_Z, NET.spike_bit, TONE.ctrl, "spike_bit");
  add(SP_X0, SPIKES_BUS_Z, 4.42, SPIKES_BUS_Z, NET.spikes, TONE.write, "spikes");
  add(4.42, SPIKES_BUS_Z, 4.42, 1.25, NET.spikes, TONE.write, "spikes");
  rise(4.42, 1.25, PAD_Y, NET.spikes, TONE.write, "spikes");
  add(PRE_X, sramZ0, PRE_X, sramZ1, NET.pre_rd, TONE.addr, "pre_rd");
  add(PRE_X, ROW_Z, SP_X1, ROW_Z, NET.pre_rd, TONE.addr, "pre_rd");
  add(SP_X0, SYN_EN_Z, SP_X1, SYN_EN_Z, NET.syn_en, TONE.ctrl, "syn_en");
  add(SP_X1, SYN_EN_Z, SYN_X, SYN_Z, NET.syn_en, TONE.ctrl, "syn_en");
  add(WEIGHT_X, sramZ1, WEIGHT_X, SYN_Z, NET.weight_rd, TONE.data, "weight_rd");
  add(WEIGHT_X, SYN_Z, SYN_X, SYN_Z, NET.weight_rd, TONE.data, "weight_rd");
  add(V_X0, V_POST_RD_Z, V_X1, V_POST_RD_Z, NET.v_post_rd, TONE.data, "v_post_rd");
  add(V_X1, V_POST_RD_Z, SYN_X, SYN_Z, NET.v_post_rd, TONE.data, "v_post_rd");
  add(POST_X, POST_ADDR_Z, POST_X, sramZ1, NET.post_rd, TONE.addr, "post_rd");
  add(POST_X, POST_ADDR_Z, V_X0, POST_ADDR_Z, NET.post_rd, TONE.addr, "post_rd");
  add(V_X0, V_POST_SUM_Z, V_X1, V_POST_SUM_Z, NET.v_post_sum, TONE.write, "v_post_sum");
  add(SYN_X, SYN_Z, V_X1, V_POST_SUM_Z, NET.v_post_sum, TONE.write, "v_post_sum");
  rise(SYN_X, SYN_Z, BLOCK_TOP, NET.v_post_sum, TONE.write, "syn_en");
  add(SP_X0, MOTOR_SPIKE_Z, SP_X1, MOTOR_SPIKE_Z, NET.motor_spike, TONE.ctrl, "motor_spike");
  add(SP_X0, MOTOR_SPIKE_Z, MINC_X, MINC_Z, NET.motor_spike, TONE.ctrl, "motor_spike");
  add(INDEX_X0, INDEX_SEL_Z, INDEX_X1, INDEX_SEL_Z, NET.motor_sel, TONE.addr, "motor_sel");
  add(INDEX_X1, INDEX_SEL_Z, MINC_X, MINC_Z, NET.motor_sel, TONE.addr, "motor_sel");
  add(MINC_X, MINC_Z, MINC_X, ACCUM_RAIL_Z, NET.accum_sum, TONE.write, "accum_sum");
  add(MOTOR_X0, ACCUM_RAIL_Z, accumX1, ACCUM_RAIL_Z, NET.accum_sum, TONE.write, "accum_sum");
  rise(MINC_X, MINC_Z, BLOCK_TOP, NET.accum_sum, TONE.write, "motor_spike");
  add(-3.15, 3.2, -3.15, NORTH, NET.clk, TONE.ctrl, "clk");
  add(-3.15, NORTH, 3.35, NORTH, NET.clk, TONE.ctrl, "clk");
  add(3.35, NORTH, 3.35, TICK_CTRL[1], NET.clk, TONE.ctrl, "clk");
  add(3.35, TICK_CTRL[1], TICK_CTRL[0], TICK_CTRL[1], NET.clk, TONE.ctrl, "clk");
  rise(-3.15, 3.2, PAD_Y, NET.clk, TONE.ctrl, "clk");
  rise(TICK_CTRL[0], TICK_CTRL[1], BLOCK_TOP, NET.clk, TONE.ctrl, "clk");
  add(-1.7, 3.2, -1.7, NORTH, NET.rst, TONE.ctrl, "rst");
  add(-1.7, NORTH, 3.58, NORTH, NET.rst, TONE.ctrl, "rst");
  add(3.58, NORTH, 3.58, TICK_CTRL[1], NET.rst, TONE.ctrl, "rst");
  add(3.58, TICK_CTRL[1], TICK_CTRL[0], TICK_CTRL[1], NET.rst, TONE.ctrl, "rst");
  rise(-1.7, 3.2, PAD_Y, NET.rst, TONE.ctrl, "rst");
  add(-0.25, 3.2, -0.25, NORTH, NET.tick, TONE.ctrl, "tick");
  add(-0.25, NORTH, 3.82, NORTH, NET.tick, TONE.ctrl, "tick");
  add(3.82, NORTH, 3.82, TICK_CTRL[1], NET.tick, TONE.ctrl, "tick");
  add(3.82, TICK_CTRL[1], TICK_CTRL[0], TICK_CTRL[1], NET.tick, TONE.ctrl, "tick");
  rise(-0.25, 3.2, PAD_Y, NET.tick, TONE.ctrl, "tick");
  add(TICK_CTRL[0], TICK_CTRL[1], 4.55, 0.15, NET.done, TONE.write, "done");
  rise(4.55, 0.15, PAD_Y, NET.done, TONE.write, "done");
  add(TICK_CTRL[0], TICK_CTRL[1], TICK_CTRL[0], -2.45, NET.cycle, TONE.data, "cycle");
  add(TICK_CTRL[0], -2.45, -1.7, -2.45, NET.cycle, TONE.data, "cycle");
  rise(-1.7, -2.45, BLOCK_TOP, NET.cycle, TONE.data, "cycle");
  return { runs, risers };
}

function tapZ(segs: Seg[], x: number, z: number, railZ: number, y: number, fromY = CELL_Y, lift = 0) {
  const top = y + lift;
  segs.push([x, fromY, z, x, top, z]);
  if (Math.abs(z - railZ) > 0.01) segs.push([x, top, z, x, top, railZ]);
}

function tapX(segs: Seg[], x: number, z: number, railX: number, y: number, lift = 0) {
  const top = y + lift;
  segs.push([x, CELL_Y, z, x, top, z]);
  if (Math.abs(x - railX) > 0.01) segs.push([x, top, z, railX, top, z]);
}

type ViaSet = { data: Seg[]; ctrl: Seg[]; write: Seg[]; addr: Seg[] };

function emptyVias(): ViaSet {
  return { data: [], ctrl: [], write: [], addr: [] };
}

function decayTaps(into: ViaSet, id: number, lift = 0) {
  const [x, z] = cellXZ(STATE_CENTER, STATE_PITCH, id);
  tapZ(into.data, x, z - 0.012, V_RD_Z, NET.v_rd, CELL_Y, lift);
  tapZ(into.write, x, z + 0.012, V_SUM_Z, NET.v_sum, CELL_Y, lift);
}

function compareTaps(into: ViaSet, id: number, lift = 0) {
  const [x, z] = cellXZ(SPIKE_CENTER, SPIKE_PITCH, id);
  tapZ(into.ctrl, x - 0.012, z, SPIKE_BIT_Z, NET.spike_bit, CELL_Y, lift);
  tapZ(into.write, x + 0.012, z, SPIKES_BUS_Z, NET.spikes, CELL_Y, lift);
}

const NEURAL_Y = 0.5;

function neuralWire(into: Seg[], pre: number, post: number, y = NEURAL_Y) {
  const from = cellXZ(SPIKE_CENTER, SPIKE_PITCH, pre);
  const to = cellXZ(STATE_CENTER, STATE_PITCH, post);
  into.push([from[0], CELL_Y, from[1], from[0], y, from[1]]);
  into.push([from[0], y, from[1], to[0], y, from[1]]);
  if (Math.abs(from[1] - to[1]) > 0.001) into.push([to[0], y, from[1], to[0], y, to[1]]);
  into.push([to[0], y, to[1], to[0], CELL_Y, to[1]]);
}

function synapseTaps(into: ViaSet, pre: number, row: number, post: number, words: number, lift = 0) {
  const spike = cellXZ(SPIKE_CENTER, SPIKE_PITCH, pre);
  const word = rowXZ(words, row);
  const dest = cellXZ(STATE_CENTER, STATE_PITCH, post);
  tapX(into.addr, word[0] - 0.01, word[1], PRE_X, NET.pre_rd, lift);
  tapZ(into.ctrl, spike[0], spike[1], SYN_EN_Z, NET.syn_en, CELL_Y, lift);
  tapX(into.data, word[0], word[1], WEIGHT_X, NET.weight_rd, lift);
  tapZ(into.data, dest[0], dest[1] - 0.016, V_POST_RD_Z, NET.v_post_rd, CELL_Y, lift);
  tapX(into.addr, word[0] + 0.01, word[1], POST_X, NET.post_rd, lift);
  tapZ(into.addr, dest[0], dest[1] + 0.016, POST_ADDR_Z, NET.post_rd, CELL_Y, lift);
  tapZ(into.write, dest[0] + 0.016, dest[1], V_POST_SUM_Z, NET.v_post_sum, CELL_Y, lift);
}

function motorTaps(into: ViaSet, id: number, motorName: string, lift = 0) {
  const spike = cellXZ(SPIKE_CENTER, SPIKE_PITCH, id);
  const index = cellXZ(INDEX_CENTER, INDEX_PITCH, id);
  const motor = MOTOR_NAMES.indexOf(motorName as (typeof MOTOR_NAMES)[number]);
  const accumX = MOTOR_X0 + Math.max(motor, 0) * MOTOR_PITCH;
  tapZ(into.ctrl, spike[0], spike[1], MOTOR_SPIKE_Z, NET.motor_spike, CELL_Y, lift);
  tapZ(into.addr, index[0], index[1], INDEX_SEL_Z, NET.motor_sel, CELL_Y, lift);
  tapZ(into.write, accumX, -2.45, ACCUM_RAIL_Z, NET.accum_sum, 0.32, lift);
}

function buildVias(
  graph: ChipGraph,
  spiked: Set<number>,
  driven: Set<number>,
  focus: Set<number>,
  phase: number,
): ViaSet & { focus: Seg[] } {
  const active = emptyVias();
  const held = emptyVias();
  const words = graph.synapses.pre.length;
  if (phase === 0 || phase >= 4) driven.forEach((id) => decayTaps(active, id));
  if (phase >= 1) spiked.forEach((id) => compareTaps(active, id));
  if (phase >= 2) {
    graph.synapses.pre.forEach((pre, row) => {
      if (spiked.has(pre)) synapseTaps(active, pre, row, graph.synapses.post[row], words);
    });
  }
  if (phase >= 3) {
    graph.neurons.forEach((neuron) => {
      if (neuron.motor && spiked.has(neuron.id)) motorTaps(active, neuron.id, neuron.motor);
    });
  }
  focus.forEach((id) => {
    decayTaps(held, id, 0.05);
    compareTaps(held, id, 0.05);
    const neuron = graph.neurons[id];
    if (neuron?.motor) motorTaps(held, id, neuron.motor, 0.05);
  });
  if (focus.size > 0) {
    graph.synapses.pre.forEach((pre, row) => {
      if (focus.has(pre) || focus.has(graph.synapses.post[row])) {
        synapseTaps(held, pre, row, graph.synapses.post[row], words, 0.05);
        neuralWire(held.data, pre, graph.synapses.post[row], NEURAL_Y + 0.12);
      }
    });
  }
  return {
    data: active.data,
    ctrl: active.ctrl,
    write: active.write,
    addr: active.addr,
    focus: [...held.data, ...held.ctrl, ...held.write, ...held.addr],
  };
}

export function ChipScene({
  graph,
  spikes,
  driven,
  stages,
  pinned,
  step,
  motorRates,
  focusIds,
  fitView,
  onSelectNeuron,
  structure,
  onPickStructure,
}: {
  graph: ChipGraph;
  spikes: number[];
  driven: number[];
  stages: NeuronStage[];
  pinned: number;
  step: number;
  motorRates: Record<string, number>;
  focusIds: number[];
  fitView: number;
  onSelectNeuron: (id: number) => void;
  structure: StructureName | null;
  onPickStructure: (name: StructureName) => void;
}) {
  return (
    <Canvas camera={{ position: [11.04, 8.24, 13.79], fov: 30, near: 0.08, far: 90 }}>
      <color attach="background" args={["#e7eef5"]} />
      <ambientLight intensity={1.15} />
      <hemisphereLight args={["#f4f7fb", "#c5d0dc", 0.55]} />
      <directionalLight position={[4, 12, 6]} intensity={1.55} />
      <directionalLight position={[-8, 6, -4]} intensity={0.65} />
      <OrbitView fitView={fitView} />
      <Die
        graph={graph}
        spikes={spikes}
        driven={driven}
        stages={stages}
        pinned={pinned}
        step={step}
        motorRates={motorRates}
        focusIds={focusIds}
        onSelectNeuron={onSelectNeuron}
        structure={structure}
        onPickStructure={onPickStructure}
      />
    </Canvas>
  );
}
