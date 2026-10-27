import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { releaseSpring, resist, stopAll } from "./orbitMotion";
import { MOTOR_NAMES, type Barrier, type EditorTool, type Frame, type Landmark, type Layout, type Pose, type Room, type Scenario, type WorldPick } from "./types";

function leadingAction(rates: Record<string, number>): string {
  let best = "rest";
  let score = 0;
  for (const name of MOTOR_NAMES) {
    const value = rates[name] ?? 0;
    if (value > score) {
      best = name;
      score = value;
    }
  }
  return best;
}

const BUSY_ACTIONS = new Set(["thrust", "yaw_left", "yaw_right", "pitch_up", "escape", "walk"]);

function shownAction(rates: Record<string, number>, pose: Pose, override: string): string {
  if (override !== "auto") return override;
  const lead = leadingAction(rates);
  if (lead === "land" || pose.z <= 0.35) return "land";
  if (BUSY_ACTIONS.has(lead) || lead === "groom_fore" || lead === "groom_hind" || lead === "groom_wing" || lead === "feed" || lead === "walk") return lead;
  return "thrust";
}

function simToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

const TICK_MS = 50;
const SNAP_M = 2.2;

type Sample = { x: number; y: number; z: number; yaw: number; pitch: number };
type Track = { from: Sample; to: Sample; at: number };
type MotionBus = { fly: Track; bees: Track[] };

function poseSample(pose: Pose): Sample {
  return { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch };
}

function markSample(mark: { x: number; y: number; z: number }): Sample {
  return { x: mark.x, y: mark.y, z: mark.z, yaw: 0, pitch: 0 };
}

function freshTrack(sample: Sample): Track {
  return { from: sample, to: sample, at: performance.now() };
}

function armTrack(track: Track, next: Sample, snap = false) {
  const jump = Math.hypot(next.x - track.to.x, next.y - track.to.y, next.z - track.to.z);
  track.from = snap || jump > SNAP_M ? next : { ...track.to };
  track.to = next;
  track.at = performance.now();
}

function blendSample(from: Sample, to: Sample, t: number): Sample {
  const turn = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
    yaw: from.yaw + turn * t,
    pitch: from.pitch + (to.pitch - from.pitch) * t,
  };
}

function readTrack(track: Track, now = performance.now()): Sample {
  const t = Math.min(1, Math.max(0, (now - track.at) / TICK_MS));
  return blendSample(track.from, track.to, t);
}

type Column = { minX: number; maxX: number; minZ: number; maxZ: number; top: number };

function wallTop(box: { height?: number }): number {
  return box.height && box.height > 0 ? box.height : CEILING / 2;
}

function solidColumns(room: Room, obstacles: Layout["obstacles"]): Column[] {
  const cols = obstacles.map((box) => ({ minX: box.min_x, maxX: box.max_x, minZ: box.min_y, maxZ: box.max_y, top: wallTop(box) }));
  for (const cell of perimeterCells(room)) cols.push({ minX: cell.x, maxX: cell.x + 1, minZ: cell.z, maxZ: cell.z + 1, top: CEILING });
  return cols;
}

function followColumns(obstacles: Layout["obstacles"]): Column[] {
  return obstacles.map((box) => ({ minX: box.min_x, maxX: box.max_x, minZ: box.min_y, maxZ: box.max_y, top: wallTop(box) }));
}

function eyeInside(col: Column, x: number, y: number, z: number): boolean {
  if (y >= col.top - 0.04) return false;
  const pad = 0.16;
  return y > -0.05 && x > col.minX - pad && x < col.maxX + pad && z > col.minZ - pad && z < col.maxZ + pad;
}

function segmentHitsColumn(col: Column, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  const axes: [number, number, number, number][] = [
    [dx, ax, col.minX, col.maxX],
    [dy, ay, 0, col.top],
    [dz, az, col.minZ, col.maxZ],
  ];
  for (const [delta, origin, min, max] of axes) {
    if (Math.abs(delta) < 1e-8) {
      if (origin <= min || origin >= max) return false;
      continue;
    }
    let t1 = (min - origin) / delta;
    let t2 = (max - origin) / delta;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmax > 0.03 && tmin < 0.97;
}

function sightBlocked(cols: Column[], target: THREE.Vector3, eye: THREE.Vector3): boolean {
  if (cols.some((col) => eyeInside(col, eye.x, eye.y, eye.z))) return true;
  return cols.some((col) => segmentHitsColumn(col, target.x, target.y, target.z, eye.x, eye.y, eye.z));
}

function visibleAim(eye: THREE.Vector3, target: THREE.Vector3, cols: Column[]): THREE.Vector3 {
  if (!sightBlocked(cols, target, eye)) return target.clone();
  let lo = 0.12;
  let hi = 1;
  for (let step = 0; step < 12; step += 1) {
    const mid = (lo + hi) / 2;
    const point = eye.clone().lerp(target, mid);
    if (sightBlocked(cols, point, eye)) hi = mid;
    else lo = mid;
  }
  return eye.clone().lerp(target, lo);
}

function pullClear(target: THREE.Vector3, eye: THREE.Vector3, cols: Column[]): THREE.Vector3 {
  const blockedAt = (t: number) => sightBlocked(cols, target, target.clone().lerp(eye, t));
  if (!blockedAt(1)) return eye.clone();
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 14; step += 1) {
    const mid = (lo + hi) / 2;
    if (blockedAt(mid)) hi = mid;
    else lo = mid;
  }
  if (lo < 0.08) return new THREE.Vector3(target.x, CEILING + 1.35, target.z + 0.2);
  return target.clone().lerp(eye, lo);
}

export type CameraMode = "follow" | "orbit" | "overview";
type Orbit = { theta: number; phi: number; radius: number; roomKey: string; panX: number; panZ: number };

function orbitEye(anchor: THREE.Vector3, orbit: Orbit, clampHeight: boolean): THREE.Vector3 {
  const sin = Math.sin(orbit.phi);
  const height = 0.55 + orbit.radius * Math.cos(orbit.phi);
  return new THREE.Vector3(
    anchor.x + orbit.radius * sin * Math.sin(orbit.theta),
    clampHeight ? THREE.MathUtils.clamp(height, 0.45, CEILING - 0.15) : height,
    anchor.z + orbit.radius * sin * Math.cos(orbit.theta),
  );
}

function pushOutOfHedges(body: THREE.Vector3, offset: THREE.Vector3, cols: Column[]) {
  for (let step = 0; step < 6; step += 1) {
    const ex = body.x + offset.x;
    const ey = body.y + offset.y;
    const ez = body.z + offset.z;
    if (!cols.some((col) => eyeInside(col, ex, ey, ez))) return;
    offset.multiplyScalar(1.22);
  }
}

function ChaseCamera({
  motion,
  obstacles,
  orbit,
  mode,
}: {
  motion: MutableRefObject<MotionBus>;
  obstacles: Layout["obstacles"];
  orbit: MutableRefObject<Orbit>;
  mode: CameraMode;
}) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const { camera } = useThree();
  const cols = useRef<Column[]>([]);
  const offset = useRef(new THREE.Vector3());
  const offsetVel = useRef(new THREE.Vector3());
  const ready = useRef(false);
  const body = useRef(new THREE.Vector3());
  const goal = useRef(new THREE.Vector3());
  cols.current = followColumns(obstacles);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const sample = readTrack(motion.current.fly);
    body.current.set(sample.x, sample.z, sample.y);
    if (modeRef.current === "orbit") orbit.current.theta += dt * 0.3;
    if (modeRef.current === "overview") {
      const ease = Math.min(1, dt * 3);
      orbit.current.radius += (20 - orbit.current.radius) * ease;
      orbit.current.phi += (0.6 - orbit.current.phi) * ease;
    }
    goal.current.copy(orbitEye(body.current, orbit.current, false)).sub(body.current);
    pushOutOfHedges(body.current, goal.current, cols.current);
    if (!ready.current) {
      offset.current.copy(goal.current);
      offsetVel.current.set(0, 0, 0);
      ready.current = true;
    }
    springToward(offset.current, offsetVel.current, goal.current, 6, dt);
    camera.up.set(0, 1, 0);
    if (camera.far < 500) {
      camera.far = 500;
      camera.updateProjectionMatrix();
    }
    camera.position.copy(body.current).add(offset.current);
    camera.lookAt(body.current);
  });

  return null;
}

function springToward(pos: THREE.Vector3, vel: THREE.Vector3, goal: THREE.Vector3, omega: number, dt: number) {
  const ax = omega * omega * (goal.x - pos.x) - 2 * omega * vel.x;
  const ay = omega * omega * (goal.y - pos.y) - 2 * omega * vel.y;
  const az = omega * omega * (goal.z - pos.z) - 2 * omega * vel.z;
  vel.set(vel.x + ax * dt, vel.y + ay * dt, vel.z + az * dt);
  pos.set(pos.x + vel.x * dt, pos.y + vel.y * dt, pos.z + vel.z * dt);
}

function OrbitInput({
  orbit,
  pageScroll = false,
  primaryOrbit = false,
}: {
  orbit: MutableRefObject<Orbit>;
  pageScroll?: boolean;
  primaryOrbit?: boolean;
}) {
  const { gl } = useThree();
  const drag = useRef(false);
  const armed = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const coast = useRef<ReturnType<typeof releaseSpring>[]>([]);
  const sample = useRef({ x: 0, y: 0, t: 0, px: 0, py: 0, pt: 0 });
  const keys = useRef({ left: false, right: false, up: false, down: false });

  useEffect(() => {
    const dom = gl.domElement;
    const isOrbitButton = (event: PointerEvent) =>
      event.button === 1 || event.button === 2 || (event.button === 0 && primaryOrbit);
    const onDown = (event: PointerEvent) => {
      if (!isOrbitButton(event)) return;
      stopAll(coast.current);
      coast.current = [];
      armed.current = true;
      drag.current = event.button !== 0;
      start.current = { x: event.clientX, y: event.clientY };
      const now = performance.now();
      sample.current = { x: event.clientX, y: event.clientY, t: now, px: event.clientX, py: event.clientY, pt: now };
      if (event.button !== 0) event.preventDefault();
    };
    const onMove = (event: PointerEvent) => {
      if (!armed.current) return;
      if (!drag.current) {
        const dist = Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y);
        if (dist < 4) return;
        drag.current = true;
      }
      orbit.current.theta -= event.movementX * 0.005;
      orbit.current.phi = resist(orbit.current.phi + event.movementY * 0.004, 0.25, 1.45);
      const now = performance.now();
      sample.current.px = sample.current.x;
      sample.current.py = sample.current.y;
      sample.current.pt = sample.current.t;
      sample.current.x = event.clientX;
      sample.current.y = event.clientY;
      sample.current.t = now;
    };
    const onUp = () => {
      const wasDrag = drag.current;
      armed.current = false;
      drag.current = false;
      if (!wasDrag) return;
      const s = sample.current;
      const dt = (s.t - s.pt) / 1000;
      const usable = dt > 0.001 && dt < 0.12;
      const thetaV = usable ? (-(s.x - s.px) / dt) * 0.005 : 0;
      const phiV = usable ? ((s.y - s.py) / dt) * 0.004 : 0;
      coast.current = [
        releaseSpring(orbit.current.theta, thetaV, null, null, (value) => {
          orbit.current.theta = value;
        }),
        releaseSpring(orbit.current.phi, phiV, 0.25, 1.45, (value) => {
          orbit.current.phi = value;
        }),
      ];
    };
    const onWheel = (event: WheelEvent) => {
      if (pageScroll) return;
      event.preventDefault();
      orbit.current.radius = THREE.MathUtils.clamp(orbit.current.radius * (event.deltaY > 0 ? 1.08 : 0.92), 1.4, 24);
    };
    const onMenu = (event: Event) => event.preventDefault();
    const onAux = (event: MouseEvent) => event.preventDefault();
    const setKey = (event: KeyboardEvent, down: boolean) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "ArrowLeft") keys.current.left = down;
      else if (event.key === "ArrowRight") keys.current.right = down;
      else if (event.key === "ArrowUp") keys.current.up = down;
      else if (event.key === "ArrowDown") keys.current.down = down;
      else return;
      event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => setKey(event, true);
    const onKeyUp = (event: KeyboardEvent) => setKey(event, false);
    const clear = () => {
      armed.current = false;
      drag.current = false;
      keys.current.left = false;
      keys.current.right = false;
      keys.current.up = false;
      keys.current.down = false;
    };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    if (!pageScroll) dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("contextmenu", onMenu);
    dom.addEventListener("auxclick", onAux);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!pageScroll) dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("contextmenu", onMenu);
      dom.removeEventListener("auxclick", onAux);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
    };
  }, [gl, orbit, pageScroll, primaryOrbit]);

  useFrame((_, delta) => {
    const turn = Math.min(delta, 0.05) * 1.6;
    if (keys.current.left) orbit.current.theta += turn;
    if (keys.current.right) orbit.current.theta -= turn;
    if (keys.current.up) orbit.current.phi = THREE.MathUtils.clamp(orbit.current.phi - turn, 0.25, 1.45);
    if (keys.current.down) orbit.current.phi = THREE.MathUtils.clamp(orbit.current.phi + turn, 0.25, 1.45);
  });
  return null;
}

function Trail({ frames }: { frames: Frame[] }) {
  const line = useMemo(() => {
    const points = frames.map((frame) => new THREE.Vector3(frame.pose.x, frame.pose.z, frame.pose.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: "#8fb4ff" });
    return new THREE.Line(geometry, material);
  }, [frames]);

  useEffect(() => {
    return () => {
      line.geometry.dispose();
      const material = line.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    };
  }, [line]);

  if (frames.length < 2) return null;
  return <primitive object={line} />;
}

const LEG_STATIONS = [
  { x: 0.13, z: 0.07, phase: 0 },
  { x: 0.13, z: -0.07, phase: Math.PI },
  { x: 0.02, z: 0.078, phase: Math.PI },
  { x: 0.02, z: -0.078, phase: 0 },
  { x: -0.1, z: 0.064, phase: 0 },
  { x: -0.1, z: -0.064, phase: Math.PI },
];

type LegJoints = { coxa: THREE.Group | null; femur: THREE.Group | null; tibia: THREE.Group | null };

function setLeg(leg: LegJoints, side: number, coxa: number, femur: number, tibia: number) {
  if (leg.coxa) leg.coxa.rotation.z = -side * coxa;
  if (leg.femur) leg.femur.rotation.z = -side * femur;
  if (leg.tibia) leg.tibia.rotation.z = -side * tibia;
}

function Leg({ index, joints, femur, tibia }: { index: number; joints: MutableRefObject<LegJoints[]>; femur: string; tibia: string }) {
  const station = LEG_STATIONS[index];
  const side = station.z > 0 ? 1 : -1;
  return (
    <group
      ref={(node) => {
        joints.current[index].coxa = node;
      }}
      position={[station.x, -0.02, station.z]}
    >
      <mesh position={[0.025 * side, 0, 0]}>
        <boxGeometry args={[0.05, 0.016, 0.016]} />
        <meshStandardMaterial color={femur} />
      </mesh>
      <group
        ref={(node) => {
          joints.current[index].femur = node;
        }}
        position={[0.05 * side, 0, 0]}
      >
        <mesh position={[0.04 * side, 0, 0]}>
          <boxGeometry args={[0.08, 0.014, 0.014]} />
          <meshStandardMaterial color={femur} />
        </mesh>
        <group
          ref={(node) => {
            joints.current[index].tibia = node;
          }}
          position={[0.08 * side, 0, 0]}
        >
          <mesh position={[0.035 * side, 0, 0]}>
            <boxGeometry args={[0.07, 0.01, 0.01]} />
            <meshStandardMaterial color={tibia} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function RobotFly({
  pose,
  thrust,
  escape,
  action,
  playing,
  motion,
}: {
  pose: Pose;
  thrust: number;
  escape: boolean;
  action: string;
  playing: boolean;
  motion: MutableRefObject<MotionBus>;
}) {
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const abdomen = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const joints = useRef<LegJoints[]>(Array.from({ length: 6 }, () => ({ coxa: null, femur: null, tibia: null })));
  const thrustRef = useRef(thrust);
  const escapeRef = useRef(escape);
  const actionRef = useRef(action);
  const poseRef = useRef(pose);
  const playingRef = useRef(playing);
  const prev = useRef({ x: pose.x, y: pose.y, ready: false });
  const born = useRef(-1);
  thrustRef.current = thrust;
  escapeRef.current = escape;
  actionRef.current = action;
  poseRef.current = pose;
  playingRef.current = playing;

  useLayoutEffect(() => {
    const sample = readTrack(motion.current.fly);
    if (root.current) {
      root.current.position.set(sample.x, sample.z + 0.06, sample.y);
      root.current.rotation.y = -sample.yaw;
      root.current.scale.setScalar(0.72);
    }
    if (body.current) body.current.rotation.z = sample.pitch;
  }, [motion]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const place = poseRef.current;
    if (prev.current.ready && Math.hypot(place.x - prev.current.x, place.y - prev.current.y) > SNAP_M) born.current = time;
    prev.current = { x: place.x, y: place.y, ready: true };
    const pop = born.current < 0 ? 1 : Math.min(1, 0.4 + (time - born.current) * 2.6);
    const sample = playingRef.current ? readTrack(motion.current.fly) : poseSample(poseRef.current);
    if (root.current) {
      root.current.position.set(sample.x, sample.z + 0.06, sample.y);
      root.current.rotation.y = -sample.yaw;
      root.current.scale.setScalar(0.72 * pop);
    }
    if (body.current) body.current.rotation.z = sample.pitch;
    const current = actionRef.current;
    const flying = current === "thrust" || current === "escape" || current === "yaw_left" || current === "yaw_right" || current === "pitch_up" || escapeRef.current;
    const landing = current === "land";
    const rate = current === "escape" || escapeRef.current ? 22 : flying ? 8 + thrustRef.current * 12 : landing ? 5 : 1.5;
    const beat = Math.sin(time * rate);
    const flap = beat * (flying ? 0.55 : landing ? 0.18 : 0.03);
    if (wingL.current) wingL.current.rotation.x = flying || landing ? 0.15 + flap : current === "groom_wing" ? 0.7 : 1.05;
    if (wingR.current) wingR.current.rotation.x = flying || landing ? -0.15 - flap : current === "groom_wing" ? -0.35 + Math.sin(time * 9) * 0.55 : -1.05;
    if (body.current) body.current.position.y = flying ? beat * 0.012 : 0;
    if (head.current) head.current.rotation.z = current === "feed" ? 0.7 + Math.sin(time * 6) * 0.06 : 0;
    if (abdomen.current) abdomen.current.rotation.z = current === "walk" ? Math.sin(time * 14) * 0.06 : 0;
    joints.current.forEach((leg, index) => {
      const station = LEG_STATIONS[index];
      const side = station.z > 0 ? 1 : -1;
      const swing = Math.sin(time * 14 + station.phase);
      if (current === "walk") setLeg(leg, side, 0.25 + swing * 0.55, 0.65 + Math.max(0, swing) * 0.45, 0.45);
      else if (current === "groom_fore" && index < 2) setLeg(leg, side, 1.15 + Math.sin(time * 11) * 0.22, 0.15, 0.55);
      else if (current === "groom_hind" && index >= 4) setLeg(leg, side, -0.95 + Math.sin(time * 9) * 0.25, 0.2, 0.35);
      else if (current === "groom_wing" && index >= 4) setLeg(leg, side, -0.7, 0.15 + Math.sin(time * 9) * 0.2, 0.2);
      else if (current === "feed" && index < 2) setLeg(leg, side, 1.05, 0.35, 0.7);
      else if (flying) setLeg(leg, side, 0.15, -0.35, -0.15);
      else if (landing) setLeg(leg, side, 0.1, 1.15, 0.25);
      else setLeg(leg, side, 0.2, 0.95, 0.65);
    });
  });

  const chassis = escape ? "#6a3a3a" : "#4c5c64";
  const panel = escape ? "#ff6b4a" : "#1f9a8a";

  return (
    <group ref={root}>
      <group ref={body}>
        <mesh castShadow position={[0.02, 0, 0]}>
          <boxGeometry args={[0.24, 0.1, 0.15]} />
          <meshStandardMaterial color={chassis} metalness={0.48} roughness={0.36} />
        </mesh>
        <mesh position={[0.03, 0.052, 0]}>
          <boxGeometry args={[0.12, 0.012, 0.08]} />
          <meshStandardMaterial color={panel} emissive={panel} emissiveIntensity={0.35} metalness={0.2} roughness={0.4} />
        </mesh>
        <group ref={abdomen} position={[-0.2, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.16, 0.09, 0.13]} />
            <meshStandardMaterial color="#243036" metalness={0.4} roughness={0.42} />
          </mesh>
          {[-0.04, 0, 0.04].map((x) => (
            <mesh key={x} position={[x, 0.048, 0]}>
              <boxGeometry args={[0.026, 0.012, 0.11]} />
              <meshStandardMaterial color="#3dbea8" metalness={0.15} roughness={0.4} />
            </mesh>
          ))}
        </group>
        <group ref={head} position={[0.18, 0.02, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.1, 0.08, 0.13]} />
            <meshStandardMaterial color="#3a4a52" metalness={0.42} roughness={0.38} />
          </mesh>
          {[1, -1].map((side) => (
            <mesh key={side} position={[0.03, 0.01, 0.055 * side]}>
              <boxGeometry args={[0.035, 0.05, 0.03]} />
              <meshStandardMaterial color="#c0392b" emissive="#ff3b2a" emissiveIntensity={0.4} />
            </mesh>
          ))}
          {[1, -1].map((side) => (
            <group key={`ant-${side}`} position={[0.06, 0.04, 0.03 * side]}>
              <mesh position={[0.04, 0.03, 0]}>
                <boxGeometry args={[0.08, 0.012, 0.012]} />
                <meshStandardMaterial color="#2a3338" metalness={0.3} roughness={0.45} />
              </mesh>
              <mesh position={[0.085, 0.03, 0]}>
                <boxGeometry args={[0.02, 0.02, 0.02]} />
                <meshStandardMaterial color="#1f9a8a" />
              </mesh>
            </group>
          ))}
        </group>
        <group ref={wingL} position={[0.02, 0.07, 0.08]}>
          <mesh position={[0.01, 0, 0.12]} castShadow>
            <boxGeometry args={[0.26, 0.012, 0.2]} />
            <meshStandardMaterial color="#c5dcea" transparent opacity={0.72} metalness={0.15} roughness={0.2} />
          </mesh>
        </group>
        <group ref={wingR} position={[0.02, 0.07, -0.08]}>
          <mesh position={[0.01, 0, -0.12]} castShadow>
            <boxGeometry args={[0.26, 0.012, 0.2]} />
            <meshStandardMaterial color="#c5dcea" transparent opacity={0.72} metalness={0.15} roughness={0.2} />
          </mesh>
        </group>
        {LEG_STATIONS.map((station, index) => (
          <Leg key={`${station.x}:${station.z}`} index={index} joints={joints} femur="#2c353b" tibia="#1c2428" />
        ))}
      </group>
    </group>
  );
}

function Fly({
  pose,
  thrust,
  escape,
  action,
  variant = "fly",
  marked = false,
  playing = false,
  motion,
  beeIndex,
}: {
  pose: Pose;
  thrust: number;
  escape: boolean;
  action: string;
  variant?: "fly" | "hunter";
  marked?: boolean;
  playing?: boolean;
  motion?: MutableRefObject<MotionBus>;
  beeIndex?: number;
}) {
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const abdomen = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const joints = useRef<LegJoints[]>(Array.from({ length: 6 }, () => ({ coxa: null, femur: null, tibia: null })));
  const thrustRef = useRef(thrust);
  const escapeRef = useRef(escape);
  const actionRef = useRef(action);
  const poseRef = useRef(pose);
  const playingRef = useRef(playing);
  const gait = useRef({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch });
  thrustRef.current = thrust;
  escapeRef.current = escape;
  actionRef.current = action;
  poseRef.current = pose;
  playingRef.current = playing;
  const hunter = variant === "hunter";

  useLayoutEffect(() => {
    if (!hunter || !root.current) return;
    root.current.position.set(pose.x, pose.z + 0.054, pose.y);
  }, [hunter, motion]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    if (hunter && root.current) {
      const bus = motion?.current;
      const track = bus && beeIndex !== undefined ? bus.bees[beeIndex] : undefined;
      const sample = playingRef.current && track ? readTrack(track) : poseSample(poseRef.current);
      const dx = sample.x - gait.current.x;
      const dy = sample.y - gait.current.y;
      const dz = sample.z - gait.current.z;
      if (dx * dx + dy * dy > 1e-8) gait.current.yaw = Math.atan2(dy, dx);
      const horiz = Math.hypot(dx, dy);
      if (horiz > 1e-4 || Math.abs(dz) > 1e-4) {
        const nose = Math.atan2(dz, Math.max(horiz, 0.04));
        gait.current.pitch = gait.current.pitch * 0.65 + Math.max(-0.6, Math.min(0.6, nose)) * 0.35;
      }
      gait.current.x = sample.x;
      gait.current.y = sample.y;
      gait.current.z = sample.z;
      root.current.position.set(sample.x, sample.z + 0.054, sample.y);
      root.current.rotation.y = -gait.current.yaw;
      if (body.current) body.current.rotation.z = gait.current.pitch;
    }
    const current = actionRef.current;
    const flying = hunter || current === "thrust" || current === "escape" || current === "yaw_left" || current === "yaw_right" || current === "pitch_up" || escapeRef.current;
    const landing = !hunter && current === "land";
    const rate = hunter || current === "escape" || escapeRef.current ? 22 : flying ? 8 + thrustRef.current * 12 : landing ? 5 : 1.5;
    const beat = Math.sin(time * rate);
    const flap = beat * (flying ? 0.55 : landing ? 0.18 : 0.03);
    if (wingL.current) wingL.current.rotation.x = flying || landing ? 0.2 + flap : current === "groom_wing" ? 0.7 : 1.15;
    if (wingR.current) {
      wingR.current.rotation.x = flying || landing ? -0.2 - flap : current === "groom_wing" ? -0.35 + Math.sin(time * 9) * 0.55 : -1.15;
    }
    if (body.current) body.current.position.y = flying ? beat * 0.014 : 0;
    if (head.current) head.current.rotation.z = current === "feed" ? 0.85 + Math.sin(time * 6) * 0.08 : Math.sin(time * 3) * 0.04;
    if (abdomen.current) abdomen.current.rotation.z = current === "walk" ? Math.sin(time * 14) * 0.08 : current === "rest" ? 0.18 : 0.05;
    joints.current.forEach((leg, index) => {
      const station = LEG_STATIONS[index];
      const side = station.z > 0 ? 1 : -1;
      const swing = Math.sin(time * 14 + station.phase);
      if (!hunter && current === "walk") {
        setLeg(leg, side, 0.25 + swing * 0.55, 0.65 + Math.max(0, swing) * 0.45, 0.45);
      } else if (!hunter && current === "groom_fore" && index < 2) {
        setLeg(leg, side, 1.15 + Math.sin(time * 11) * 0.22, 0.15, 0.55);
      } else if (!hunter && current === "groom_hind" && index >= 4) {
        setLeg(leg, side, -0.95 + Math.sin(time * 9) * 0.25, 0.2, 0.35);
      } else if (!hunter && current === "groom_wing" && index >= 4) {
        setLeg(leg, side, -0.7, 0.15 + Math.sin(time * 9) * 0.2, 0.2);
      } else if (!hunter && current === "feed" && index < 2) {
        setLeg(leg, side, 1.05, 0.35, 0.7);
      } else if (flying) {
        setLeg(leg, side, 0.15, -0.35, -0.15);
      } else if (landing) {
        setLeg(leg, side, 0.1, 1.15, 0.25);
      } else {
        setLeg(leg, side, 0.2, 0.95, 0.65);
      }
    });
  });

  const thorax = hunter ? "#161616" : escape ? "#ff6b4a" : "#c4894a";
  const abdomenColor = hunter ? "#141414" : "#f0c14a";
  const band = hunter ? "#f0b429" : "#5c3a1c";
  const wing = hunter ? "#2a261f" : "#d5e6f6";
  const eye = hunter ? "#ff2a1a" : "#6b2e22";
  const femur = hunter ? "#1c1c1c" : "#8d5a32";
  const tibia = hunter ? "#111111" : "#6b4428";

  const placed = hunter
    ? {}
    : { position: [pose.x, pose.z + 0.054, pose.y] as [number, number, number], rotation: [0, -pose.yaw, 0] as [number, number, number] };
  const tilted = hunter ? {} : { rotation: [0, 0, pose.pitch] as [number, number, number] };

  return (
    <group ref={root} {...placed} scale={hunter ? 1.02 : 0.6}>
      <group ref={body} {...tilted}>
        <mesh castShadow position={[0.04, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.07, 0.16, 4, 10]} />
          <meshStandardMaterial color={thorax} roughness={0.46} metalness={0.08} />
        </mesh>
        {hunter ? (
          <mesh position={[0.02, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.074, 0.074, 0.02, 12]} />
            <meshStandardMaterial color={band} roughness={0.4} />
          </mesh>
        ) : null}
        <group ref={abdomen} position={[-0.12, 0, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} position={[-0.07, 0, 0]}>
            <capsuleGeometry args={[0.055, 0.1, 4, 8]} />
            <meshStandardMaterial color={abdomenColor} roughness={0.5} />
          </mesh>
          {[-0.02, -0.055, -0.09].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.058, 0.058, 0.016, 12]} />
              <meshStandardMaterial color={band} roughness={0.42} />
            </mesh>
          ))}
        </group>
        <group ref={head} position={[0.18, 0.02, 0]}>
          <mesh>
            <sphereGeometry args={[0.062, 16, 12]} />
            <meshStandardMaterial color={hunter ? "#1a1a1a" : "#8d5a32"} roughness={0.5} />
          </mesh>
          {[1, -1].map((side) => (
            <mesh key={side} position={[0.03, 0.012, 0.04 * side]}>
              <sphereGeometry args={[hunter ? 0.034 : 0.03, 12, 10]} />
              <meshStandardMaterial color={eye} emissive={eye} emissiveIntensity={hunter ? 0.55 : 0.2} />
            </mesh>
          ))}
          {[1, -1].map((side) => (
            <group key={`ant-${side}`} position={[0.04, 0.04, 0.015 * side]} rotation={[0, 0, -0.9]}>
              <mesh position={[0, 0.045, 0]}>
                <cylinderGeometry args={[0.004, 0.006, 0.09, 6]} />
                <meshStandardMaterial color={hunter ? "#2a2418" : "#3a2a1c"} />
              </mesh>
              <mesh position={[0, 0.095, 0]}>
                <sphereGeometry args={[0.012, 8, 8]} />
                <meshStandardMaterial color={hunter ? "#f0b429" : "#2a1c12"} />
              </mesh>
            </group>
          ))}
        </group>
        <group ref={wingL} position={[0.02, 0.06, 0.07]}>
          <mesh position={[0.02, 0, 0.12]} castShadow>
            <boxGeometry args={[0.28, 0.012, 0.22]} />
            <meshStandardMaterial color={wing} transparent opacity={hunter ? 0.82 : 0.78} />
          </mesh>
        </group>
        <group ref={wingR} position={[0.02, 0.06, -0.07]}>
          <mesh position={[0.02, 0, -0.12]} castShadow>
            <boxGeometry args={[0.28, 0.012, 0.22]} />
            <meshStandardMaterial color={wing} transparent opacity={hunter ? 0.82 : 0.78} />
          </mesh>
        </group>
        {LEG_STATIONS.map((station, index) => (
          <Leg key={`${station.x}:${station.z}`} index={index} joints={joints} femur={femur} tibia={tibia} />
        ))}
        {marked ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]}>
            <ringGeometry args={[0.28, 0.34, 24]} />
            <meshBasicMaterial color="#f0b429" side={THREE.DoubleSide} />
          </mesh>
        ) : null}
      </group>
    </group>
  );
}

function Tag({ pick, index = 0, children }: { pick: string; index?: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    ref.current?.traverse((child) => {
      child.userData.pick = pick;
      child.userData.index = index;
    });
  }, [index, pick]);
  return <group ref={ref}>{children}</group>;
}

function FoodSphere({ item, selected }: { item: Landmark; selected: boolean }) {
  return (
    <mesh position={simToThree(item.x, item.y, item.z)}>
      <sphereGeometry args={[Math.max(0.18, item.radius * 0.55), 24, 16]} />
      <meshStandardMaterial color="#d6f25a" emissive={selected ? "#f0b429" : "#6d9214"} emissiveIntensity={selected ? 0.9 : 0.45} />
    </mesh>
  );
}

const BURGER_WIDTH = 0.44;

const BURGER_COLORS: Record<string, string> = {
  "bun-bottom": "#e0a04a",
  "bun-top": "#f3d29a",
  cheese: "#ffd34d",
  patty: "#6b3a24",
  salad: "#3f9a3a",
  tomato: "#d6453a",
};

function Burger({ item, selected }: { item: Landmark; selected: boolean }) {
  const gltf = useLoader(GLTFLoader, "/models/burger.glb");
  const model = useMemo(() => gltf.scene.clone(true), [gltf]);
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const color = BURGER_COLORS[mesh.name];
      if (color) {
        mesh.material = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 });
      }
    });
    const root = ref.current;
    if (!root) return;
    let node: THREE.Object3D | null = root;
    while (node && !node.userData.pick) node = node.parent;
    const pick = node?.userData.pick as string | undefined;
    const index = (node?.userData.index as number | undefined) ?? 0;
    if (!pick) return;
    root.traverse((child) => {
      child.userData.pick = pick;
      child.userData.index = index;
    });
  }, [model]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.45;
  });
  const scale = (item.radius * 2) / BURGER_WIDTH;
  return (
    <group ref={ref} position={simToThree(item.x, item.y, item.z)} scale={selected ? scale * 1.06 : scale}>
      <primitive object={model} position={[0, -0.145, 0]} />
    </group>
  );
}

function Food({ item, selected }: { item: Landmark; selected: boolean }) {
  return (
    <Suspense fallback={<FoodSphere item={item} selected={selected} />}>
      <Burger item={item} selected={selected} />
    </Suspense>
  );
}

function Threat({
  item,
  index,
  selected,
  playing,
  motion,
}: {
  item: Landmark;
  index: number;
  selected: boolean;
  playing: boolean;
  motion: MutableRefObject<MotionBus>;
}) {
  const pose: Pose = { x: item.x, y: item.y, z: item.z, yaw: 0, pitch: 0, speed: 0 };
  return <Fly pose={pose} thrust={1} escape action="escape" variant="hunter" marked={selected} playing={playing} motion={motion} beeIndex={index} />;
}

const CEILING = 2.35;
const BLOCK = 1;

function BlockColumn({
  x,
  z,
  width = BLOCK,
  depth = BLOCK,
  height = CEILING,
  selected = false,
  ghost = false,
  tone = "wall",
}: {
  x: number;
  z: number;
  width?: number;
  depth?: number;
  height?: number;
  selected?: boolean;
  ghost?: boolean;
  tone?: "wall" | "hedge" | "stone";
}) {
  const palette = {
    wall: ["#8a6a45", "#c4a574", "#5c4630"],
    hedge: ["#3e6a38", "#7dba62", "#2c4a28"],
    stone: ["#7d756c", "#b7aea4", "#564f48"],
  }[tone];
  const side = selected ? "#e2b656" : palette[0];
  const top = selected ? "#f0d48a" : palette[1];
  const bottom = selected ? "#b8903a" : palette[2];
  const shared = { roughness: 0.72, metalness: 0.04, transparent: ghost, opacity: ghost ? 0.42 : 1, depthWrite: !ghost };
  return (
    <mesh position={[x, height / 2, z]} castShadow={!ghost} raycast={ghost ? () => null : undefined}>
      <boxGeometry args={[Math.max(width, 0.08), Math.max(height, 0.08), Math.max(depth, 0.08)]} />
      <meshStandardMaterial attach="material-0" color={side} {...shared} />
      <meshStandardMaterial attach="material-1" color={side} {...shared} />
      <meshStandardMaterial attach="material-2" color={top} {...shared} />
      <meshStandardMaterial attach="material-3" color={bottom} {...shared} />
      <meshStandardMaterial attach="material-4" color={side} {...shared} />
      <meshStandardMaterial attach="material-5" color={side} {...shared} />
    </mesh>
  );
}

function HedgeRun({
  x,
  z,
  width,
  depth,
  height = CEILING / 2,
  selected = false,
  ghost = false,
}: {
  x: number;
  z: number;
  width: number;
  depth: number;
  height?: number;
  selected?: boolean;
  ghost?: boolean;
}) {
  const w = Math.max(width, 0.4);
  const d = Math.max(depth, 0.4);
  const nx = Math.max(1, Math.min(14, Math.ceil(w / 0.4 - 0.1)));
  const nz = Math.max(1, Math.min(14, Math.ceil(d / 0.4 - 0.1)));
  const base = selected ? "#8a6a32" : "#234828";
  const shared = { roughness: 0.92, metalness: 0, flatShading: true, transparent: ghost, opacity: ghost ? 0.42 : 1, depthWrite: !ghost };
  const pick = ghost ? () => null : undefined;
  return (
    <group position={[x, 0, z]} scale={[1, height / 0.97, 1]}>
      <mesh position={[0, 0.22, 0]} castShadow={!ghost} raycast={pick}>
        <boxGeometry args={[w * 0.96, 0.44, d * 0.96]} />
        <meshStandardMaterial color={base} {...shared} />
      </mesh>
      {Array.from({ length: nx * nz }, (_, n) => {
        const i = n % nx;
        const j = Math.floor(n / nx);
        const cx = (i + 0.5) * (w / nx) - w / 2;
        const cz = (j + 0.5) * (d / nz) - d / 2;
        const radius = Math.min(0.5, 0.34 + ((i + j) % 3) * 0.05);
        const sway = (((i + j) % 2) * 2 - 1) * 0.05;
        const leaf = selected ? "#c4a15a" : (i + j) % 2 === 0 ? "#3f7a3a" : "#4e8c45";
        return (
          <mesh key={n} position={[cx + sway, 0.56, cz - sway]} castShadow={!ghost} raycast={pick}>
            <icosahedronGeometry args={[radius, 0]} />
            <meshStandardMaterial color={leaf} {...shared} />
          </mesh>
        );
      })}
    </group>
  );
}

type HedgeBox = Layout["obstacles"][number];

function hedgeHeight(box: HedgeBox): number {
  return box.height && box.height > 0 ? box.height : CEILING / 2;
}

function mergeHedges(boxes: HedgeBox[]): HedgeBox[] {
  const out = boxes.map((box) => ({ ...box }));
  const eps = 1e-6;
  let again = true;
  while (again) {
    again = false;
    search: for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i];
        const b = out[j];
        if (Math.abs(hedgeHeight(a) - hedgeHeight(b)) > eps) continue;
        const sameRows = Math.abs(a.min_y - b.min_y) < eps && Math.abs(a.max_y - b.max_y) < eps;
        const sameCols = Math.abs(a.min_x - b.min_x) < eps && Math.abs(a.max_x - b.max_x) < eps;
        const touchX = b.min_x <= a.max_x + eps && a.min_x <= b.max_x + eps;
        const touchY = b.min_y <= a.max_y + eps && a.min_y <= b.max_y + eps;
        if ((sameRows && touchX) || (sameCols && touchY)) {
          out[i] = {
            ...a,
            min_x: Math.min(a.min_x, b.min_x),
            max_x: Math.max(a.max_x, b.max_x),
            min_y: Math.min(a.min_y, b.min_y),
            max_y: Math.max(a.max_y, b.max_y),
          };
          out.splice(j, 1);
          again = true;
          break search;
        }
      }
    }
  }
  return out;
}

function HedgeField({ obstacles, picked }: { obstacles: Layout["obstacles"]; picked: number | null }) {
  const merged = useMemo(() => mergeHedges(obstacles.filter((_, index) => index !== picked)), [obstacles, picked]);
  return (
    <>
      {merged.map((box, index) => (
        <HedgeRun
          key={`m${index}:${box.min_x}:${box.min_y}:${box.max_x}:${box.max_y}`}
          x={(box.min_x + box.max_x) / 2}
          z={(box.min_y + box.max_y) / 2}
          width={box.max_x - box.min_x}
          depth={box.max_y - box.min_y}
          height={hedgeHeight(box)}
        />
      ))}
      {obstacles.map((item, index) => {
        const height = hedgeHeight(item);
        return (
          <Tag key={`wall-${index}`} pick="wall" index={index}>
            {picked === index ? (
              <BarrierMesh item={item} selected tone="hedge" />
            ) : (
              <mesh position={[(item.min_x + item.max_x) / 2, height / 2, (item.min_y + item.max_y) / 2]}>
                <boxGeometry args={[item.max_x - item.min_x, height, item.max_y - item.min_y]} />
                <meshBasicMaterial visible={false} />
              </mesh>
            )}
          </Tag>
        );
      })}
    </>
  );
}

function BarrierMesh({
  item,
  selected,
  ghost = false,
  tone = "wall",
}: {
  item: Pick<Barrier, "min_x" | "max_x" | "min_y" | "max_y"> & { height?: number };
  selected: boolean;
  ghost?: boolean;
  tone?: "wall" | "hedge" | "stone";
}) {
  const width = item.max_x - item.min_x;
  const depth = item.max_y - item.min_y;
  const x = (item.min_x + item.max_x) / 2;
  const z = (item.min_y + item.max_y) / 2;
  const height = item.height && item.height > 0 ? item.height : CEILING / 2;
  if (tone === "hedge") return <HedgeRun x={x} z={z} width={width} depth={depth} height={height} selected={selected} ghost={ghost} />;
  return <BlockColumn x={x} z={z} width={width} depth={depth} height={height} selected={selected} ghost={ghost} tone={tone} />;
}

function perimeterCells(room: Room): { x: number; z: number }[] {
  const x0 = Math.floor(room.min_x);
  const x1 = Math.ceil(room.max_x);
  const z0 = Math.floor(room.min_y);
  const z1 = Math.ceil(room.max_y);
  const cells: { x: number; z: number }[] = [];
  for (let x = x0 - 1; x <= x1; x += 1) {
    cells.push({ x, z: z0 - 1 });
    cells.push({ x, z: z1 });
  }
  for (let z = z0; z < z1; z += 1) {
    cells.push({ x: x0 - 1, z });
    cells.push({ x: x1, z });
  }
  return cells;
}

function floorGrid(room: Room): THREE.BufferGeometry {
  const positions: number[] = [];
  const y = 0.025;
  for (let x = Math.ceil(room.min_x); x < room.max_x; x += 1) {
    positions.push(x, y, room.min_y, x, y, room.max_y);
  }
  for (let z = Math.ceil(room.min_y); z < room.max_y; z += 1) {
    positions.push(room.min_x, y, z, room.max_x, y, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

type SceneTheme = {
  floor: string;
  grid: string;
  sky: string;
  ceiling: string;
  blocks: "wall" | "hedge" | "stone";
  edge: boolean;
};

const SCENE_THEME: Record<Scenario, SceneTheme> = {
  yard: { floor: "#7d9a58", grid: "#6c8848", sky: "#d5e7c4", ceiling: "#e4f0d4", blocks: "hedge", edge: false },
  food: { floor: "#d7c6a4", grid: "#c4b18e", sky: "#f4ecdf", ceiling: "#efe2c8", blocks: "hedge", edge: false },
  loom: { floor: "#6f8f4c", grid: "#5f7c3e", sky: "#cfe3bf", ceiling: "#e7f2dc", blocks: "hedge", edge: false },
  obstacle: { floor: "#d2c0a0", grid: "#bba888", sky: "#f6efe4", ceiling: "#efe2c8", blocks: "stone", edge: false },
  landing: { floor: "#86a462", grid: "#749452", sky: "#d7e8c6", ceiling: "#e7f3da", blocks: "hedge", edge: false },
  silent: { floor: "#93b072", grid: "#7f9c60", sky: "#e7f0dc", ceiling: "#f3f6ea", blocks: "hedge", edge: false },
};

const FOREST_FILES = [
  "/models/forest/tree_oak.glb",
  "/models/forest/tree_pine.glb",
  "/models/forest/tree_default.glb",
  "/models/forest/bush.glb",
  "/models/forest/rock.glb",
];

type ForestSpot = { x: number; z: number; kind: number; rot: number; scale: number };

function scenerySpots(scene: Scenario, room: Room): ForestSpot[] {
  const spots: ForestSpot[] = [];
  const push = (x: number, z: number, kind: number, scale: number, rot: number) => {
    if (x <= room.min_x + 0.3 || x >= room.max_x - 0.3 || z <= room.min_y + 0.3 || z >= room.max_y - 0.3) return;
    spots.push({ x, z, kind, rot, scale });
  };
  if (scene === "food") {
    perimeterCells(room).forEach((cell, index) => {
      if (index % 2 !== 0) return;
      spots.push({
        x: cell.x + 0.5,
        z: cell.z + 0.5,
        kind: index % 3,
        rot: index * 0.7,
        scale: 1.35,
      });
    });
    return spots;
  }
  const cx = (room.min_x + room.max_x) / 2;
  const cz = (room.min_y + room.max_y) / 2;
  const reachX = Math.min(room.max_x - cx, cx - room.min_x) - 1.4;
  const reachZ = Math.min(room.max_y - cz, cz - room.min_y) - 1.4;
  const ring = Math.min(Math.max(Math.min(reachX, reachZ), 3.2), scene === "silent" ? 8 : 9.5);
  const count = scene === "silent" ? 12 : scene === "obstacle" ? 14 : 16;
  for (let i = 0; i < count; i += 1) {
    const ang = (i / count) * Math.PI * 2 + 0.4;
    const kind = i % 5;
    push(cx + Math.cos(ang) * ring, cz + Math.sin(ang) * ring * 0.92, kind, kind >= 3 ? 1.2 : 1.5 + (i % 3) * 0.18, ang);
  }
  if (scene === "yard") {
    push(-3.2, -5.4, 0, 1.55, 0.4);
    push(2.4, -6.2, 1, 1.7, 1.2);
    push(-5.2, 0.4, 2, 1.4, 2.1);
    push(6.2, -3.6, 3, 1.25, 0.6);
    push(-8.4, -9.2, 4, 1.35, 0.2);
    push(11.5, 8.4, 1, 1.8, 0.8);
  }
  return spots;
}

function paintNature(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const painted = list.map((mat) => {
      const source = mat as THREE.MeshStandardMaterial;
      const next = source.clone();
      next.metalness = 0;
      next.roughness = 0.88;
      const name = (source.name || "").toLowerCase();
      if (name.includes("leaf")) next.color.set(name.includes("dark") ? "#2c6b34" : "#3f9144");
      else if (name.includes("wood") || name.includes("bark")) next.color.set(name.includes("dark") ? "#6b4428" : "#8d5a32");
      else if (name.includes("dirt")) next.color.set("#8d7658");
      else if (name.includes("grass")) next.color.set("#4f9a45");
      return next;
    });
    mesh.material = Array.isArray(mesh.material) ? painted : painted[0];
  });
}

function Forest({ room, scene }: { room: Room; scene: Scenario }) {
  const gltfs = useLoader(GLTFLoader, FOREST_FILES);
  const spots = useMemo(
    () => scenerySpots(scene, room),
    [scene, room.max_x, room.max_y, room.min_x, room.min_y],
  );
  const clones = useMemo(
    () =>
      spots.map((spot) => {
        const model = gltfs[spot.kind].scene.clone(true);
        paintNature(model);
        model.traverse((child) => {
          child.raycast = () => null;
        });
        return { model, spot };
      }),
    [gltfs, spots],
  );
  return (
    <group>
      {clones.map(({ model, spot }, index) => (
        <primitive key={`${spot.x}:${spot.z}:${index}`} object={model} position={[spot.x, 0, spot.z]} rotation={[0, spot.rot, 0]} scale={spot.scale} />
      ))}
    </group>
  );
}

const CLOUD_CELL = 4;
const CLOUD_GRID = 24;
const CLOUD_TILE = CLOUD_CELL * CLOUD_GRID;
const CLOUD_SPEED = 1.1;

function cloudPattern(): Array<[number, number]> {
  let seed = 90210;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const raw = Array.from({ length: CLOUD_GRID * CLOUD_GRID }, () => rand());
  const at = (x: number, y: number) => raw[((y + CLOUD_GRID) % CLOUD_GRID) * CLOUD_GRID + ((x + CLOUD_GRID) % CLOUD_GRID)];
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < CLOUD_GRID; y += 1) {
    for (let x = 0; x < CLOUD_GRID; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) sum += at(x + dx, y + dy);
      if (sum / 9 + (at(x, y) - 0.5) * 0.25 > 0.52) cells.push([x, y]);
    }
  }
  return cells;
}

function Clouds() {
  const group = useRef<THREE.Group>(null);
  const { mesh, material } = useMemo(() => {
    const cells = cloudPattern();
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec4 local = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            local = instanceMatrix * local;
          #endif
          vNormal = normal;
          vec4 world = modelMatrix * local;
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          float shade = vNormal.y > 0.5 ? 1.0 : (vNormal.y < -0.5 ? 0.7 : (abs(vNormal.x) > 0.5 ? 0.82 : 0.9));
          float dist = distance(vWorld.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(70.0, 150.0, dist);
          gl_FragColor = vec4(vec3(shade), 0.86 * fade);
        }
      `,
    });
    const geometry = new THREE.BoxGeometry(CLOUD_CELL, 1.4, CLOUD_CELL);
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length * 9);
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let tx = -1; tx <= 1; tx += 1) {
      for (let tz = -1; tz <= 1; tz += 1) {
        for (const [x, y] of cells) {
          matrix.makeTranslation(tx * CLOUD_TILE + x * CLOUD_CELL, 0, tz * CLOUD_TILE + y * CLOUD_CELL);
          mesh.setMatrixAt(index, matrix);
          index += 1;
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.raycast = () => null;
    return { mesh, material };
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );
  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.position.x = ((clock.elapsedTime * CLOUD_SPEED) % CLOUD_TILE) - CLOUD_TILE * 0.5;
  });
  return (
    <group ref={group} position={[0, 12, -CLOUD_TILE * 0.5]}>
      <primitive object={mesh} />
    </group>
  );
}

function LowPolySky() {
  const { geometry, material } = useMemo(() => {
    const dome = new THREE.IcosahedronGeometry(180, 2);
    const sky = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      toneMapped: false,
      depthWrite: false,
      vertexShader: `
        varying vec3 vColor;
        void main() {
          float sky = smoothstep(-0.08, 0.62, normalize(position).y);
          vec3 horizon = vec3(0.73, 0.86, 0.97);
          vec3 overhead = vec3(0.12, 0.32, 0.62);
          vColor = mix(horizon, overhead, pow(sky, 0.85));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
    });
    return { geometry: dome, material: sky };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <group>
      <mesh geometry={geometry} material={material} raycast={() => null} />
      <mesh position={[-11, 5.5, -22]} raycast={() => null}>
        <icosahedronGeometry args={[2.1, 0]} />
        <meshBasicMaterial color="#ffe6a3" toneMapped={false} />
      </mesh>
      <Clouds />
    </group>
  );
}

function Island({ room, floor }: { room: Room; floor: string }) {
  const width = room.max_x - room.min_x;
  const depth = room.max_y - room.min_y;
  const cx = (room.min_x + room.max_x) / 2;
  const cz = (room.min_y + room.max_y) / 2;
  const land = (Math.hypot(width, depth) / 2) * 1.28;
  const rocks = [0.2, 1.5, 2.7, 4.0, 5.3];
  return (
    <group position={[cx, 0, cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]} receiveShadow raycast={() => null}>
        <circleGeometry args={[120, 16]} />
        <meshStandardMaterial color="#7eb0c4" />
      </mesh>
      <mesh position={[0, -0.46, 0]} receiveShadow raycast={() => null}>
        <cylinderGeometry args={[land * 1.22, land * 1.34, 0.42, 8]} />
        <meshStandardMaterial color="#c4a574" flatShading />
      </mesh>
      <mesh position={[0, -0.28, 0]} raycast={() => null}>
        <cylinderGeometry args={[land * 1.04, land * 1.16, 0.36, 7]} />
        <meshStandardMaterial color="#7d6b58" flatShading />
      </mesh>
      <mesh position={[0, -0.16, 0]} receiveShadow raycast={() => null}>
        <cylinderGeometry args={[land, land * 0.94, 0.3, 8]} />
        <meshStandardMaterial color={floor} flatShading />
      </mesh>
      {rocks.map((angle, index) => (
        <mesh key={angle} position={[Math.cos(angle) * land * 1.12, -0.1, Math.sin(angle) * land * 1.12]} raycast={() => null}>
          <icosahedronGeometry args={[1.1 + (index % 3) * 0.45, 0]} />
          <meshStandardMaterial color={index % 2 ? "#8a7968" : "#62584e"} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function GlassBox({ room }: { room: Room }) {
  const width = room.max_x - room.min_x;
  const depth = room.max_y - room.min_y;
  const cx = (room.min_x + room.max_x) / 2;
  const cz = (room.min_y + room.max_y) / 2;
  const glass = {
    color: "#e7f6f2",
    transparent: true,
    opacity: 0.34,
    roughness: 0.02,
    metalness: 0.04,
    side: THREE.DoubleSide,
    depthWrite: false,
  };
  const walls: [number, number, number, number, number][] = [
    [room.min_x, CEILING / 2, cz, 0.06, depth],
    [room.max_x, CEILING / 2, cz, 0.06, depth],
    [cx, CEILING / 2, room.min_y, width, 0.06],
    [cx, CEILING / 2, room.max_y, width, 0.06],
  ];
  return (
    <group>
      {walls.map(([x, y, z, w, d]) => (
        <mesh key={`${x}:${z}`} position={[x, y, z]} raycast={() => null}>
          <boxGeometry args={[w, CEILING, d]} />
          <meshStandardMaterial {...glass} />
        </mesh>
      ))}
      <mesh position={[cx, CEILING, cz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#e4f3ef" transparent opacity={0.14} roughness={0.02} metalness={0.04} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function RoomShell({ room, theme }: { room: Room; theme: SceneTheme }) {
  const width = room.max_x - room.min_x;
  const depth = room.max_y - room.min_y;
  const cx = (room.min_x + room.max_x) / 2;
  const cz = (room.min_y + room.max_y) / 2;
  const cells = useMemo(() => perimeterCells(room), [room.max_x, room.max_y, room.min_x, room.min_y]);
  const grid = useMemo(() => floorGrid(room), [room.max_x, room.max_y, room.min_x, room.min_y]);
  useEffect(() => () => grid.dispose(), [grid]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.01, cz]} receiveShadow userData={{ pick: "floor", index: 0 }}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={theme.floor} />
      </mesh>
      <lineSegments geometry={grid} raycast={() => null}>
        <lineBasicMaterial color={theme.grid} />
      </lineSegments>
      {theme.edge
        ? cells.map((cell) => <BlockColumn key={`${cell.x}:${cell.z}`} x={cell.x + 0.5} z={cell.z + 0.5} tone={theme.blocks} />)
        : null}
    </group>
  );
}

function Landing({ item, selected }: { item: Landmark; selected: boolean }) {
  return (
    <mesh position={[item.x, 0.02, item.y]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[item.radius * 0.42, item.radius, 40]} />
      <meshStandardMaterial color={selected ? "#f0b429" : "#7dcea0"} side={THREE.DoubleSide} />
    </mesh>
  );
}

const LIMITS = { foods: 6, threats: 4, landings: 4, obstacles: 64 } as const;

function clampPoint(room: Room, x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(room.max_x - 0.2, Math.max(room.min_x + 0.2, x)),
    y: Math.min(room.max_y - 0.2, Math.max(room.min_y + 0.2, y)),
  };
}

function cellBox(room: Room, x: number, y: number, height: number): Layout["obstacles"][number] | null {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < room.min_x || ix + BLOCK > room.max_x || iy < room.min_y || iy + BLOCK > room.max_y) return null;
  return { min_x: ix, max_x: ix + BLOCK, min_y: iy, max_y: iy + BLOCK, height };
}

function overlaps(box: Layout["obstacles"][number], cell: Layout["obstacles"][number]): boolean {
  return box.min_x < cell.max_x - 1e-6 && box.max_x > cell.min_x + 1e-6 && box.min_y < cell.max_y - 1e-6 && box.max_y > cell.min_y + 1e-6;
}

function BuildCamera({ room, obstacles, orbit }: { room: Room; obstacles: Layout["obstacles"]; orbit: MutableRefObject<Orbit> }) {
  const { camera } = useThree();
  const roomRef = useRef(room);
  const cols = useRef<Column[]>([]);
  roomRef.current = room;
  cols.current = solidColumns(room, obstacles);
  const look = useRef(new THREE.Vector3());
  const roomKey = `${room.min_x}:${room.max_x}:${room.min_y}:${room.max_y}`;

  const apply = () => {
    const box = roomRef.current;
    const cx = (box.min_x + box.max_x) / 2;
    const cz = (box.min_y + box.max_y) / 2;
    const margin = 0.35;
    const ax = cx + orbit.current.panX;
    const az = cz + orbit.current.panZ;
    const raw = orbitEye(new THREE.Vector3(ax, 0, az), orbit.current, true);
    raw.x = THREE.MathUtils.clamp(raw.x, box.min_x + margin, box.max_x - margin);
    raw.z = THREE.MathUtils.clamp(raw.z, box.min_y + margin, box.max_y - margin);
    const persp = camera as THREE.PerspectiveCamera;
    persp.up.set(0, 1, 0);
    persp.fov = 50;
    persp.near = 0.05;
    persp.far = 500;
    const center = new THREE.Vector3(ax, 0.55, az);
    const eye = cols.current.some((col) => eyeInside(col, raw.x, raw.y, raw.z)) ? pullClear(center, raw, cols.current) : raw;
    look.current.copy(visibleAim(eye, center, cols.current));
    persp.position.copy(eye);
    persp.lookAt(look.current);
    persp.updateProjectionMatrix();
  };

  useLayoutEffect(() => {
    if (orbit.current.roomKey === roomKey) return;
    const box = roomRef.current;
    const span = Math.max(box.max_x - box.min_x, box.max_y - box.min_y);
    const inset = Math.min(1.6, span * 0.18);
    const cx = (box.min_x + box.max_x) / 2;
    const cz = (box.min_y + box.max_y) / 2;
    const dx = box.min_x + inset - cx;
    const dy = 1.35 - 0.55;
    const dz = box.min_y + inset - cz;
    const radius = Math.max(1.4, Math.hypot(dx, dy, dz));
    orbit.current.radius = radius;
    orbit.current.phi = Math.acos(THREE.MathUtils.clamp(dy / radius, -1, 1));
    orbit.current.theta = Math.atan2(dx, dz);
    orbit.current.roomKey = roomKey;
    orbit.current.panX = 0;
    orbit.current.panZ = 0;
    apply();
  }, [roomKey, orbit]);

  const keys = useRef({ w: false, a: false, s: false, d: false });
  useEffect(() => {
    const set = (event: KeyboardEvent, down: boolean) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "w" || key === "a" || key === "s" || key === "d") keys.current[key] = down;
    };
    const down = (event: KeyboardEvent) => set(event, true);
    const up = (event: KeyboardEvent) => set(event, false);
    const blur = () => {
      keys.current = { w: false, a: false, s: false, d: false };
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useFrame((_, delta) => {
    const k = keys.current;
    const fwd = (k.w ? 1 : 0) - (k.s ? 1 : 0);
    const side = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    if (fwd || side) {
      const box = roomRef.current;
      const o = orbit.current;
      const speed = Math.max(2, o.radius * 1.1) * Math.min(delta, 0.05);
      const fx = -Math.sin(o.theta);
      const fz = -Math.cos(o.theta);
      const cx = (box.min_x + box.max_x) / 2;
      const cz = (box.min_y + box.max_y) / 2;
      o.panX = THREE.MathUtils.clamp(o.panX + (fx * fwd + -fz * side) * speed, box.min_x - cx, box.max_x - cx);
      o.panZ = THREE.MathUtils.clamp(o.panZ + (fz * fwd + fx * side) * speed, box.min_y - cz, box.max_y - cz);
    }
    apply();
  });
  return null;
}

function PointerEdit({
  tool,
  layout,
  onPreview,
  onCommit,
  onPick,
  onReject,
  setDraft,
  wallHeight,
}: {
  tool: EditorTool | null;
  layout: Layout;
  onPreview: (layout: Layout) => void;
  onCommit: (layout: Layout) => void;
  onPick: (pick: { kind: WorldPick; index: number } | null) => void;
  onReject: (message: string) => void;
  setDraft: (box: Layout["obstacles"][number] | null) => void;
  wallHeight: number;
}) {
  const { camera, gl, scene } = useThree();
  const layoutRef = useRef(layout);
  const toolRef = useRef(tool);
  layoutRef.current = layout;
  toolRef.current = tool;
  const handlers = useRef({ onPreview, onCommit, onPick, onReject, setDraft });
  handlers.current = { onPreview, onCommit, onPick, onReject, setDraft };
  const heightRef = useRef(wallHeight);
  heightRef.current = wallHeight;

  useEffect(() => {
    const dom = gl.domElement;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const raycaster = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    let drag: { kind: string; index: number; x: number; y: number; layout: Layout; place: EditorTool | null } | null = null;

    function pointOf(event: PointerEvent): { x: number; y: number } | null {
      const rect = dom.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1),
        camera,
      );
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return { x: hit.x, y: hit.z };
    }

    function picked(event: PointerEvent): { pick: string; index: number } | null {
      const rect = dom.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1),
        camera,
      );
      const found = raycaster.intersectObjects(scene.children, true).find((item) => item.object.userData.pick);
      if (!found) return null;
      return { pick: String(found.object.userData.pick), index: Number(found.object.userData.index ?? 0) };
    }

    function onDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const point = pointOf(event);
      if (!point) return;
      const choice = picked(event);
      const active = toolRef.current;
      if (choice && choice.pick !== "floor" && choice.pick !== "fly") {
        handlers.current.onPick({ kind: choice.pick as WorldPick, index: choice.index });
      }
      if (!active) return;
      if (active === "erase") {
        if (choice && choice.pick !== "floor" && choice.pick !== "fly") {
          handlers.current.onCommit(removeFrom(layoutRef.current, choice.pick, choice.index));
          return;
        }
        const cell = cellBox(layoutRef.current.room, point.x, point.y, heightRef.current);
        const index = cell ? layoutRef.current.obstacles.findIndex((box) => overlaps(box, cell)) : -1;
        if (index >= 0) handlers.current.onCommit(removeFrom(layoutRef.current, "wall", index));
        return;
      }
      if (active === "move" && choice && choice.pick !== "floor") {
        drag = { kind: choice.pick, index: choice.index, x: point.x, y: point.y, layout: layoutRef.current, place: null };
        return;
      }
      if (active === "wall") {
        const cell = cellBox(layoutRef.current.room, point.x, point.y, heightRef.current);
        if (!cell) return;
        const index = layoutRef.current.obstacles.findIndex((box) => overlaps(box, cell));
        if (index >= 0) {
          const obstacles = layoutRef.current.obstacles.slice();
          obstacles[index] = { ...obstacles[index], height: heightRef.current };
          handlers.current.onCommit({ ...layoutRef.current, obstacles });
          return;
        }
        if (layoutRef.current.obstacles.length >= LIMITS.obstacles) {
          handlers.current.onReject("The room already has 64 blocks.");
          return;
        }
        handlers.current.onCommit({ ...layoutRef.current, obstacles: [...layoutRef.current.obstacles, cell] });
        return;
      }
      if (active === "food" || active === "enemy" || active === "pad") {
        drag = { kind: "place", index: 0, x: point.x, y: point.y, layout: layoutRef.current, place: active };
      }
    }

    function onMove(event: PointerEvent) {
      const point = pointOf(event);
      if (toolRef.current === "wall" && point) {
        handlers.current.setDraft(cellBox(layoutRef.current.room, point.x, point.y, heightRef.current));
      } else if (!drag) {
        handlers.current.setDraft(null);
      }
      if (!drag || !point) return;
      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      handlers.current.onPreview(shiftLayout(drag.layout, drag.kind, drag.index, dx, dy, drag.layout.room));
    }

    function onUp(event: PointerEvent) {
      if (!drag) return;
      const current = drag;
      drag = null;
      const point = pointOf(event);
      if (!point) return;
      if (current.kind === "place") {
        const placed = placeObject(current.layout, current.place, point);
        if (placed === "full") {
          handlers.current.onReject("That object is already at the room limit.");
          return;
        }
        if (placed) handlers.current.onCommit(placed);
        return;
      }
      const dx = point.x - current.x;
      const dy = point.y - current.y;
      handlers.current.onCommit(shiftLayout(current.layout, current.kind, current.index, dx, dy, current.layout.room));
    }

    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [camera, gl, scene]);

  return null;
}

function clampBox(room: Room, box: Layout["obstacles"][number]) {
  return {
    ...box,
    min_x: Math.max(room.min_x, box.min_x),
    max_x: Math.min(room.max_x, box.max_x),
    min_y: Math.max(room.min_y, box.min_y),
    max_y: Math.min(room.max_y, box.max_y),
  };
}

function shiftLayout(layout: Layout, kind: string, index: number, dx: number, dy: number, room: Room): Layout {
  if (kind === "fly") {
    const point = clampPoint(room, layout.pose.x + dx, layout.pose.y + dy);
    return { ...layout, pose: { ...layout.pose, x: point.x, y: point.y } };
  }
  if (kind === "food") return { ...layout, foods: movePoint(layout.foods, index, dx, dy, room) };
  if (kind === "enemy") return { ...layout, threats: movePoint(layout.threats, index, dx, dy, room) };
  if (kind === "pad") return { ...layout, landings: movePoint(layout.landings, index, dx, dy, room) };
  if (kind === "wall") {
    const obstacles = layout.obstacles.slice();
    const box = obstacles[index];
    if (!box) return layout;
    obstacles[index] = clampBox(room, {
      ...box,
      min_x: box.min_x + dx,
      max_x: box.max_x + dx,
      min_y: box.min_y + dy,
      max_y: box.max_y + dy,
    });
    return { ...layout, obstacles };
  }
  return layout;
}

function movePoint(items: Landmark[], index: number, dx: number, dy: number, room: Room): Landmark[] {
  const next = items.slice();
  const item = next[index];
  if (!item) return items;
  const point = clampPoint(room, item.x + dx, item.y + dy);
  next[index] = { ...item, x: point.x, y: point.y };
  return next;
}

function placeObject(layout: Layout, tool: EditorTool | null, point: { x: number; y: number }): Layout | "full" | null {
  const placed = clampPoint(layout.room, point.x, point.y);
  if (tool === "food") {
    if (layout.foods.length >= LIMITS.foods) return "full";
    return { ...layout, foods: [...layout.foods, { kind: "food", x: placed.x, y: placed.y, z: 1, radius: 0.45 }] };
  }
  if (tool === "enemy") {
    if (layout.threats.length >= LIMITS.threats) return "full";
    return { ...layout, threats: [...layout.threats, { kind: "threat", x: placed.x, y: placed.y, z: 1, radius: 0.45 }] };
  }
  if (tool === "pad") {
    if (layout.landings.length >= LIMITS.landings) return "full";
    return { ...layout, landings: [...layout.landings, { kind: "landing", x: placed.x, y: placed.y, z: 0.12, radius: 0.7 }] };
  }
  return null;
}

function removeFrom(layout: Layout, pick: string, index: number): Layout {
  if (pick === "food") return { ...layout, foods: layout.foods.filter((_, item) => item !== index) };
  if (pick === "enemy") return { ...layout, threats: layout.threats.filter((_, item) => item !== index) };
  if (pick === "pad") return { ...layout, landings: layout.landings.filter((_, item) => item !== index) };
  if (pick === "wall") return { ...layout, obstacles: layout.obstacles.filter((_, item) => item !== index) };
  return layout;
}

export function WorldView({
  frame,
  layout,
  trail,
  playing,
  tool,
  picked,
  poseName,
  scene,
  onPreview,
  onCommit,
  onPick,
  onReject,
  wallHeight,
  cameraMode = "follow",
  cameraNonce = 0,
  pageScroll = false,
}: {
  cameraMode?: CameraMode;
  cameraNonce?: number;
  pageScroll?: boolean;
  frame: Frame;
  layout: Layout;
  trail: Frame[];
  playing: boolean;
  tool: EditorTool | null;
  picked: { kind: WorldPick; index: number } | null;
  poseName: string;
  scene: Scenario;
  onPreview: (layout: Layout) => void;
  onCommit: (layout: Layout) => void;
  onPick: (pick: { kind: WorldPick; index: number } | null) => void;
  onReject: (message: string) => void;
  wallHeight: number;
}) {
  const [draft, setDraft] = useState<Layout["obstacles"][number] | null>(null);
  const orbit = useRef<Orbit>({ theta: 0.8, phi: 1.15, radius: 3.2, roomKey: "", panX: 0, panZ: 0 });
  const building = !playing;
  useEffect(() => {
    if (cameraMode === "follow") {
      orbit.current.radius = 3.2;
      orbit.current.phi = 1.15;
    }
  }, [cameraMode, cameraNonce]);
  useEffect(() => {
    if (tool !== "wall") setDraft(null);
  }, [tool]);
  const theme = SCENE_THEME[scene];
  const foods = building ? layout.foods : (frame.foods ?? (frame.food ? [frame.food] : []));
  const threats = building ? layout.threats : (frame.predators ?? (frame.predator ? [frame.predator] : []));
  const flyPose: Pose = building
    ? { x: layout.pose.x, y: layout.pose.y, z: layout.pose.z, yaw: layout.pose.yaw, pitch: layout.pose.pitch, speed: 0 }
    : frame.pose;
  const motion = useRef<MotionBus>({
    fly: freshTrack(poseSample(flyPose)),
    bees: threats.map((mark) => freshTrack(markSample(mark))),
  });
  const wasDowned = useRef(false);
  useLayoutEffect(() => {
    const bus = motion.current;
    const snap = wasDowned.current && !frame.downed;
    wasDowned.current = Boolean(frame.downed);
    if (building) {
      bus.fly = freshTrack(poseSample(flyPose));
      bus.bees = threats.map((mark) => freshTrack(markSample(mark)));
      return;
    }
    armTrack(bus.fly, poseSample(frame.pose), snap);
    const next = frame.predators ?? (frame.predator ? [frame.predator] : []);
    if (next.length !== bus.bees.length) bus.bees = next.map((mark) => freshTrack(markSample(mark)));
    else next.forEach((mark, index) => armTrack(bus.bees[index], markSample(mark)));
  }, [building, frame.step, frame.downed, scene]);

  return (
    <Canvas shadows camera={{ position: [4.5, 4.2, 6.2], fov: 42, near: 0.08, far: 500 }}>
      <color attach="background" args={["#d5e8f6"]} />
      <hemisphereLight args={["#fff6e8", theme.floor, 0.9]} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.55}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <OrbitInput orbit={orbit} pageScroll={pageScroll} primaryOrbit={tool === null} />
      {building ? (
        <BuildCamera orbit={orbit} room={layout.room} obstacles={layout.obstacles} />
      ) : (
        <ChaseCamera orbit={orbit} motion={motion} obstacles={layout.obstacles} mode={cameraMode} />
      )}
      <PointerEdit tool={tool} layout={layout} onPreview={onPreview} onCommit={onCommit} onPick={onPick} onReject={onReject} setDraft={setDraft} wallHeight={wallHeight} />
      <LowPolySky />
      <Island room={layout.room} floor={theme.floor} />
      <GlassBox room={layout.room} />
      <RoomShell room={layout.room} theme={theme} />
      <Suspense fallback={null}>
        <Forest room={layout.room} scene={scene} />
      </Suspense>
      {!building ? <Trail frames={trail} /> : null}
      {foods.map((item, index) => (
        <Tag key={`food-${index}`} pick="food" index={index}>
          <Food item={item} selected={picked?.kind === "food" && picked.index === index} />
        </Tag>
      ))}
      {layout.landings.map((item, index) => (
        <Tag key={`pad-${index}`} pick="pad" index={index}>
          <Landing item={item} selected={picked?.kind === "pad" && picked.index === index} />
        </Tag>
      ))}
      {threats.map((item, index) => (
        <Tag key={`enemy-${index}`} pick="enemy" index={index}>
          <Threat item={item} index={index} selected={picked?.kind === "enemy" && picked.index === index} playing={!building} motion={motion} />
        </Tag>
      ))}
      {theme.blocks === "hedge" ? (
        <HedgeField obstacles={layout.obstacles} picked={picked?.kind === "wall" ? picked.index : null} />
      ) : (
        layout.obstacles.map((item, index) => (
          <Tag key={`wall-${index}`} pick="wall" index={index}>
            <BarrierMesh item={item} selected={picked?.kind === "wall" && picked.index === index} tone={theme.blocks} />
          </Tag>
        ))
      )}
      {draft ? <BarrierMesh item={draft} selected ghost tone={theme.blocks} /> : null}
      <Tag pick="fly">
        <RobotFly
          pose={flyPose}
          thrust={frame.motor_rates.thrust ?? 0}
          escape={frame.command.escape}
          action={building ? "rest" : shownAction(frame.motor_rates, flyPose, poseName)}
          playing={!building}
          motion={motion}
        />
      </Tag>
    </Canvas>
  );
}

function Turntable({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.7;
  });
  return <group ref={ref}>{children}</group>;
}

export function FlyMark({ size = 40 }: { size?: number }) {
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0 };
  const motion = useRef<MotionBus>({ fly: freshTrack(poseSample(pose)), bees: [] });
  return (
    <div className="fly-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Canvas dpr={[1, 2]} camera={{ position: [0.62, 0.42, 0.62], fov: 30, near: 0.05, far: 10 }} gl={{ alpha: true }}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[2, 3, 2]} intensity={1.8} />
        <group position={[0, -0.03, 0]}>
          <Turntable>
            <RobotFly pose={pose} thrust={0.4} escape={false} action="thrust" playing={false} motion={motion} />
          </Turntable>
        </group>
      </Canvas>
    </div>
  );
}
