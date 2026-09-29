import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import * as THREE from "three";
import { MOTOR_NAMES, type Barrier, type EditorTool, type Frame, type Landmark, type Layout, type Pose, type Room, type WorldPick } from "./types";

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
  if (pose.z > 0.22 && !BUSY_ACTIONS.has(lead)) return "land";
  return lead;
}

function simToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

function ChaseCamera({ focus }: { focus: [number, number, number] }) {
  const { camera } = useThree();
  const focusRef = useRef(focus);
  const look = useRef(new THREE.Vector3());
  focusRef.current = focus;

  useFrame(() => {
    const [x, y, z] = focusRef.current;
    const desiredX = x - 2.0;
    const desiredY = y + 1.6;
    const desiredZ = z + 2.6;
    camera.position.x += (desiredX - camera.position.x) * 0.06;
    camera.position.y += (desiredY - camera.position.y) * 0.06;
    camera.position.z += (desiredZ - camera.position.z) * 0.06;
    look.current.set(x, y * 0.4, z);
    camera.lookAt(look.current);
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

function Leg({ index, joints }: { index: number; joints: MutableRefObject<LegJoints[]> }) {
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
        <meshStandardMaterial color="#8d5a32" />
      </mesh>
      <group
        ref={(node) => {
          joints.current[index].femur = node;
        }}
        position={[0.05 * side, 0, 0]}
      >
        <mesh position={[0.04 * side, 0, 0]}>
          <boxGeometry args={[0.08, 0.014, 0.014]} />
          <meshStandardMaterial color="#8d5a32" />
        </mesh>
        <group
          ref={(node) => {
            joints.current[index].tibia = node;
          }}
          position={[0.08 * side, 0, 0]}
        >
          <mesh position={[0.035 * side, 0, 0]}>
            <boxGeometry args={[0.07, 0.01, 0.01]} />
            <meshStandardMaterial color="#6b4428" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Fly({ pose, thrust, escape, action }: { pose: Pose; thrust: number; escape: boolean; action: string }) {
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const abdomen = useRef<THREE.Group>(null);
  const joints = useRef<LegJoints[]>(Array.from({ length: 6 }, () => ({ coxa: null, femur: null, tibia: null })));
  const thrustRef = useRef(thrust);
  const escapeRef = useRef(escape);
  const actionRef = useRef(action);
  thrustRef.current = thrust;
  escapeRef.current = escape;
  actionRef.current = action;

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const current = actionRef.current;
    const flying = current === "thrust" || current === "escape" || current === "yaw_left" || current === "yaw_right" || current === "pitch_up" || escapeRef.current;
    const landing = current === "land";
    const rate = current === "escape" || escapeRef.current ? 22 : flying ? 8 + thrustRef.current * 12 : landing ? 5 : 1.5;
    const flap = Math.sin(time * rate) * (flying ? 0.45 + thrustRef.current * 0.35 : landing ? 0.18 : 0.03);
    if (wingL.current) wingL.current.rotation.x = flying || landing ? 0.35 + flap : current === "groom_wing" ? 0.7 : 1.15;
    if (wingR.current) {
      wingR.current.rotation.x = flying || landing ? -0.35 - flap : current === "groom_wing" ? -0.35 + Math.sin(time * 9) * 0.55 : -1.15;
    }
    if (head.current) head.current.rotation.z = current === "feed" ? 0.85 + Math.sin(time * 6) * 0.08 : 0;
    if (abdomen.current) abdomen.current.rotation.z = current === "walk" ? Math.sin(time * 14) * 0.08 : current === "rest" ? 0.18 : 0.05;
    joints.current.forEach((leg, index) => {
      const station = LEG_STATIONS[index];
      const side = station.z > 0 ? 1 : -1;
      const swing = Math.sin(time * 14 + station.phase);
      if (current === "walk") {
        setLeg(leg, side, 0.25 + swing * 0.55, 0.65 + Math.max(0, swing) * 0.45, 0.45);
      } else if (current === "groom_fore" && index < 2) {
        setLeg(leg, side, 1.15 + Math.sin(time * 11) * 0.22, 0.15, 0.55);
      } else if (current === "groom_hind" && index >= 4) {
        setLeg(leg, side, -0.95 + Math.sin(time * 9) * 0.25, 0.2, 0.35);
      } else if (current === "groom_wing" && index >= 4) {
        setLeg(leg, side, -0.7, 0.15 + Math.sin(time * 9) * 0.2, 0.2);
      } else if (current === "feed" && index < 2) {
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

  return (
    <group position={[pose.x, pose.z + 0.054, pose.y]} rotation={[0, -pose.yaw, 0]} scale={0.6}>
      <group rotation={[0, 0, pose.pitch]}>
        <mesh castShadow position={[0.04, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.07, 0.16, 4, 10]} />
          <meshStandardMaterial color={escape ? "#ff6b4a" : "#c4894a"} roughness={0.46} metalness={0.08} />
        </mesh>
        <group ref={abdomen} position={[-0.12, 0, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} position={[-0.07, 0, 0]}>
            <capsuleGeometry args={[0.055, 0.1, 4, 8]} />
            <meshStandardMaterial color="#a8743d" roughness={0.5} />
          </mesh>
        </group>
        <group ref={head} position={[0.18, 0.02, 0]}>
          <mesh>
            <sphereGeometry args={[0.06, 16, 12]} />
            <meshStandardMaterial color="#8d5a32" roughness={0.5} />
          </mesh>
          <mesh position={[0.035, 0.02, 0.028]}>
            <sphereGeometry args={[0.014, 8, 8]} />
            <meshStandardMaterial color="#f2e2a8" emissive="#f2e2a8" emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[0.035, 0.02, -0.028]}>
            <sphereGeometry args={[0.014, 8, 8]} />
            <meshStandardMaterial color="#f2e2a8" emissive="#f2e2a8" emissiveIntensity={0.35} />
          </mesh>
        </group>
        <group ref={wingL} position={[0.02, 0.06, 0.07]}>
          <mesh position={[0.02, 0, 0.12]} castShadow>
            <boxGeometry args={[0.28, 0.012, 0.22]} />
            <meshStandardMaterial color="#d5e6f6" transparent opacity={0.78} />
          </mesh>
        </group>
        <group ref={wingR} position={[0.02, 0.06, -0.07]}>
          <mesh position={[0.02, 0, -0.12]} castShadow>
            <boxGeometry args={[0.28, 0.012, 0.22]} />
            <meshStandardMaterial color="#d5e6f6" transparent opacity={0.78} />
          </mesh>
        </group>
        {LEG_STATIONS.map((station, index) => (
          <Leg key={`${station.x}:${station.z}`} index={index} joints={joints} />
        ))}
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

function Food({ item, selected }: { item: Landmark; selected: boolean }) {
  return (
    <mesh position={simToThree(item.x, item.y, item.z)}>
      <sphereGeometry args={[Math.max(0.18, item.radius * 0.55), 24, 16]} />
      <meshStandardMaterial color="#d6f25a" emissive={selected ? "#f0b429" : "#6d9214"} emissiveIntensity={selected ? 0.9 : 0.45} />
    </mesh>
  );
}

function Threat({ item, selected }: { item: Landmark; selected: boolean }) {
  return (
    <mesh position={simToThree(item.x, item.y, item.z)}>
      <sphereGeometry args={[Math.max(0.22, item.radius * 0.65), 24, 16]} />
      <meshStandardMaterial color="#ff4d3a" emissive={selected ? "#f0b429" : "#ff2a1a"} emissiveIntensity={0.6} />
    </mesh>
  );
}

function BarrierMesh({ item, selected }: { item: Pick<Barrier, "min_x" | "max_x" | "min_y" | "max_y">; selected: boolean }) {
  const width = item.max_x - item.min_x;
  const depth = item.max_y - item.min_y;
  return (
    <mesh position={[(item.min_x + item.max_x) / 2, CEILING / 2, (item.min_y + item.max_y) / 2]} castShadow>
      <boxGeometry args={[Math.max(width, 0.08), CEILING, Math.max(depth, 0.08)]} />
      <meshStandardMaterial color={selected ? "#f0b429" : "#66788a"} roughness={0.8} />
    </mesh>
  );
}

const CEILING = 2.35;

function RoomShell({ room }: { room: Room }) {
  const width = room.max_x - room.min_x;
  const depth = room.max_y - room.min_y;
  const thickness = 0.08;
  const cx = (room.min_x + room.max_x) / 2;
  const cz = (room.min_y + room.max_y) / 2;
  const walls: { position: [number, number, number]; size: [number, number, number] }[] = [
    { position: [cx, CEILING / 2, room.min_y], size: [width, CEILING, thickness] },
    { position: [cx, CEILING / 2, room.max_y], size: [width, CEILING, thickness] },
    { position: [room.min_x, CEILING / 2, cz], size: [thickness, CEILING, depth] },
    { position: [room.max_x, CEILING / 2, cz], size: [thickness, CEILING, depth] },
  ];
  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(width, CEILING, depth);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, [depth, width]);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.01, cz]} receiveShadow userData={{ pick: "floor", index: 0 }}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#d5dee8" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, CEILING, cz]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#9bb7d4" transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {walls.map((wall) => (
        <mesh key={wall.position.join(":")} position={wall.position}>
          <boxGeometry args={wall.size} />
          <meshStandardMaterial color="#31445c" transparent opacity={0.22} roughness={0.4} depthWrite={false} />
        </mesh>
      ))}
      <lineSegments geometry={edges} position={[cx, CEILING / 2, cz]}>
        <lineBasicMaterial color="#8fb4d8" transparent opacity={0.7} />
      </lineSegments>
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

const LIMITS = { foods: 6, threats: 4, landings: 4, obstacles: 8 } as const;

function clampPoint(room: Room, x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(room.max_x - 0.2, Math.max(room.min_x + 0.2, x)),
    y: Math.min(room.max_y - 0.2, Math.max(room.min_y + 0.2, y)),
  };
}

function boxFromCorners(x1: number, y1: number, x2: number, y2: number) {
  return { min_x: Math.min(x1, x2), max_x: Math.max(x1, x2), min_y: Math.min(y1, y2), max_y: Math.max(y1, y2) };
}

function Overhead({ room }: { room: Room }) {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const cx = (room.min_x + room.max_x) / 2;
    const cz = (room.min_y + room.max_y) / 2;
    const span = Math.max(room.max_x - room.min_x, room.max_y - room.min_y) + 2;
    const persp = camera as THREE.PerspectiveCamera;
    persp.fov = 34;
    persp.up.set(0, 0, -1);
    const distance = span / (2 * Math.tan((persp.fov * Math.PI) / 360));
    persp.position.set(cx, distance, cz + 0.02);
    persp.lookAt(cx, 0, cz);
    persp.updateProjectionMatrix();
  }, [camera, room, size]);
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
}: {
  tool: EditorTool | null;
  layout: Layout;
  onPreview: (layout: Layout) => void;
  onCommit: (layout: Layout) => void;
  onPick: (pick: { kind: WorldPick; index: number } | null) => void;
  onReject: (message: string) => void;
  setDraft: (box: Layout["obstacles"][number] | null) => void;
}) {
  const { camera, gl, scene } = useThree();
  const layoutRef = useRef(layout);
  const toolRef = useRef(tool);
  layoutRef.current = layout;
  toolRef.current = tool;
  const handlers = useRef({ onPreview, onCommit, onPick, onReject, setDraft });
  handlers.current = { onPreview, onCommit, onPick, onReject, setDraft };

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
      if (active === "erase" && choice && choice.pick !== "floor" && choice.pick !== "fly") {
        handlers.current.onCommit(removeFrom(layoutRef.current, choice.pick, choice.index));
        return;
      }
      if (active === "move" && choice && choice.pick !== "floor") {
        drag = { kind: choice.pick, index: choice.index, x: point.x, y: point.y, layout: layoutRef.current, place: null };
        return;
      }
      if (active === "wall") {
        drag = { kind: "wall-new", index: 0, x: point.x, y: point.y, layout: layoutRef.current, place: null };
        return;
      }
      if (active === "food" || active === "enemy" || active === "pad") {
        drag = { kind: "place", index: 0, x: point.x, y: point.y, layout: layoutRef.current, place: active };
      }
    }

    function onMove(event: PointerEvent) {
      if (!drag) return;
      const point = pointOf(event);
      if (!point) return;
      const room = drag.layout.room;
      if (drag.kind === "wall-new") {
        handlers.current.setDraft(boxFromCorners(drag.x, drag.y, point.x, point.y));
        return;
      }
      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      handlers.current.onPreview(shiftLayout(drag.layout, drag.kind, drag.index, dx, dy, room));
    }

    function onUp(event: PointerEvent) {
      if (!drag) return;
      const current = drag;
      drag = null;
      const point = pointOf(event);
      handlers.current.setDraft(null);
      if (!point) return;
      if (current.kind === "wall-new") {
        const box = boxFromCorners(current.x, current.y, point.x, point.y);
        if (box.max_x - box.min_x < 0.3 || box.max_y - box.min_y < 0.3) return;
        if (current.layout.obstacles.length >= LIMITS.obstacles) {
          handlers.current.onReject("The room already has 8 walls.");
          return;
        }
        const inside = clampBox(current.layout.room, box);
        handlers.current.onCommit({ ...current.layout, obstacles: [...current.layout.obstacles, inside] });
        return;
      }
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
  tool,
  picked,
  poseName,
  onPreview,
  onCommit,
  onPick,
  onReject,
}: {
  frame: Frame;
  layout: Layout;
  trail: Frame[];
  tool: EditorTool | null;
  picked: { kind: WorldPick; index: number } | null;
  poseName: string;
  onPreview: (layout: Layout) => void;
  onCommit: (layout: Layout) => void;
  onPick: (pick: { kind: WorldPick; index: number } | null) => void;
  onReject: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Layout["obstacles"][number] | null>(null);
  const editing = tool !== null;
  const focus = simToThree(frame.pose.x, frame.pose.y, frame.pose.z);
  const foods = editing ? layout.foods : (frame.foods ?? (frame.food ? [frame.food] : []));
  const threats = editing ? layout.threats : (frame.predators ?? (frame.predator ? [frame.predator] : []));
  const flyPose: Pose = editing
    ? { x: layout.pose.x, y: layout.pose.y, z: layout.pose.z, yaw: layout.pose.yaw, pitch: layout.pose.pitch, speed: 0 }
    : frame.pose;

  return (
    <Canvas shadows camera={{ position: [4.5, 4.2, 6.2], fov: 42 }}>
      <color attach="background" args={["#d7e4f2"]} />
      <hemisphereLight args={["#f4f7fb", "#c5d0dc", 0.85]} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.55}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#c9d3df" />
      </mesh>
      <gridHelper args={[120, 60, "#8ea0b5", "#d5dee8"]} />
      {editing ? <Overhead room={layout.room} /> : <ChaseCamera focus={focus} />}
      <PointerEdit tool={tool} layout={layout} onPreview={onPreview} onCommit={onCommit} onPick={onPick} onReject={onReject} setDraft={setDraft} />
      <RoomShell room={layout.room} />
      {!editing ? <Trail frames={trail} /> : null}
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
          <Threat item={item} selected={picked?.kind === "enemy" && picked.index === index} />
        </Tag>
      ))}
      {layout.obstacles.map((item, index) => (
        <Tag key={`wall-${index}`} pick="wall" index={index}>
          <BarrierMesh item={item} selected={picked?.kind === "wall" && picked.index === index} />
        </Tag>
      ))}
      {draft ? <BarrierMesh item={draft} selected /> : null}
      <Tag pick="fly">
        <Fly
          pose={flyPose}
          thrust={frame.motor_rates.thrust ?? 0}
          escape={frame.command.escape}
          action={editing ? "rest" : shownAction(frame.motor_rates, flyPose, poseName)}
        />
      </Tag>
    </Canvas>
  );
}
