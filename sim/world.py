from __future__ import annotations

from dataclasses import dataclass, field
from math import atan2, ceil, copysign, cos, exp, hypot, pi, sin

import numpy as np

from .topology import CONTACT, LOOM, ODOR_LEFT, ODOR_RIGHT, loom_bin_index, motor_span

BODY = 0.18
VISION_RANGE = 1.6
LOOM_RANGE = 8.0
PREDATOR_SPEED = 0.06
PREDATOR_DRAG = 0.75
CHASE_RANGE = 36.0
FLY_DRAG = 0.88
MAX_FLY_SPEED = 0.24
FLOOR_Z = 0.12
CEILING_Z = 2.35
HALF_Z = CEILING_Z * 0.5
MAX_WALLS = 64
SCENT_CELL = 0.5
SCENT_LENGTH = 40.0
_DIAG = 1.4142135623730951
MAX_FOODS = 6
MAX_THREATS = 4
MAX_PADS = 4


@dataclass
class Pose:
    x: float = 0.0
    y: float = 0.0
    z: float = 1.0
    yaw: float = 0.0
    pitch: float = 0.0
    speed: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    yaw_rate: float = 0.0


@dataclass
class WorldObject:
    kind: str
    x: float
    y: float
    z: float
    radius: float = 0.3
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0


@dataclass
class Room:
    min_x: float
    max_x: float
    min_y: float
    max_y: float


@dataclass
class Box:
    kind: str
    min_x: float
    max_x: float
    min_y: float
    max_y: float
    height: float = HALF_Z


@dataclass
class WorldState:
    pose: Pose = field(default_factory=Pose)
    room: Room = field(default_factory=lambda: Room(-12.0, 24.0, -12.0, 18.0))
    foods: list[WorldObject] = field(default_factory=list)
    landings: list[WorldObject] = field(default_factory=list)
    obstacles: list[Box] = field(default_factory=list)
    threats: list[WorldObject] = field(default_factory=list)
    eaten: bool = False
    started_with_food: bool = False
    predator_speed: float = 0.0
    escape_hold: int = 0
    saccade_cool: int = 0
    jump_ticks: int = 0
    escape_moved: bool = False
    yaw_latch: float = 0.0
    yaw_latch_age: int = 0
    climb_bias: float = 0.0
    landing_hold: int = 0
    tick: int = 0
    spawn_x: float = 0.0
    spawn_y: float = 0.0
    spawn_z: float = 1.0
    spawn_yaw: float = 0.0
    spawn_shield: int = 0
    downed: bool = False
    rng: int = 1701
    scent: object = None


def _far_pad() -> WorldObject:
    return WorldObject("landing", 40.0, 40.0, 0.15, 0.5)


def _maze_blocks() -> list[Box]:
    """A perfect maze on a 10 by 7 grid of 2 m cells. Walls are full-height hedges."""
    cells = (
        (1.75, 2.25, 3.75, 14),
        (3.75, 4.25, 3.75, 12.25),
        (5.75, 6.25, 1.75, 4.25),
        (5.75, 6.25, 5.75, 8.25),
        (5.75, 6.25, 9.75, 12.25),
        (7.75, 8.25, 0, 2.25),
        (7.75, 8.25, 3.75, 6.25),
        (7.75, 8.25, 7.75, 10.25),
        (9.75, 10.25, 1.75, 4.25),
        (9.75, 10.25, 5.75, 8.25),
        (9.75, 10.25, 9.75, 12.25),
        (11.75, 12.25, 0, 2.25),
        (11.75, 12.25, 5.75, 10.25),
        (13.75, 14.25, 1.75, 8.25),
        (15.75, 16.25, 1.75, 4.25),
        (15.75, 16.25, 5.75, 10.25),
        (17.75, 18.25, 0, 6.25),
        (17.75, 18.25, 11.75, 14),
        (0, 6.25, 1.75, 2.25),
        (13.75, 16.25, 1.75, 2.25),
        (5.75, 14.25, 3.75, 4.25),
        (5.75, 8.25, 5.75, 6.25),
        (9.75, 12.25, 5.75, 6.25),
        (15.75, 18.25, 5.75, 6.25),
        (3.75, 6.25, 7.75, 8.25),
        (7.75, 10.25, 7.75, 8.25),
        (17.75, 20, 7.75, 8.25),
        (5.75, 8.25, 9.75, 10.25),
        (11.75, 18.25, 9.75, 10.25),
        (5.75, 16.25, 11.75, 12.25),
    )
    return [Box("barrier", a, b, c, d, height=CEILING_Z) for a, b, c, d in cells]


def make_world(scenario: str = "food") -> WorldState:
    world = WorldState()
    world.landings = [_far_pad()]
    if scenario == "food":
        world.room = Room(0.0, 20.0, 0.0, 14.0)
        world.pose = Pose(x=1.0, y=1.0, z=1.0, yaw=0.0)
        world.foods = [WorldObject("food", 13.0, 5.0, 1.0, 0.45)]
        world.obstacles = _maze_blocks()
    elif scenario == "loom":
        world.room = Room(-12.0, 12.0, -12.0, 12.0)
        world.pose = Pose(x=0.35, y=0.0, z=1.5, yaw=0.6)
        world.threats = [WorldObject("threat", -0.65, 0.2, 0.42, 0.4)]
        world.predator_speed = PREDATOR_SPEED
    elif scenario == "obstacle":
        world.room = Room(-9.0, 24.0, -9.0, 12.0)
        world.obstacles = [Box("barrier", 1.55, 2.15, -2.2, 0.45, height=CEILING_Z)]
        world.foods = [WorldObject("food", 4.2, 1.8, 1.0, 0.45)]
    elif scenario == "landing":
        world.room = Room(-12.0, 15.0, -12.0, 12.0)
        world.landings = [WorldObject("landing", 0.15, 0.0, 0.12, 0.7)]
    elif scenario == "silent":
        world.room = Room(-24.0, 24.0, -24.0, 24.0)
    elif scenario == "yard":
        world.room = Room(-16.0, 16.0, -14.0, 14.0)
        world.pose = Pose(x=0.0, y=-2.0, z=1.2, yaw=0.5)
        world.foods = [
            WorldObject("food", 8.0, 6.0, 1.0, 0.45),
            WorldObject("food", -7.0, 5.0, 1.0, 0.45),
        ]
        world.threats = [WorldObject("threat", -1.2, -0.4, 0.45, 0.4)]
        world.predator_speed = PREDATOR_SPEED
        world.landings.append(WorldObject("landing", 10.0, -8.0, 0.12, 0.7))
        world.obstacles = [
            Box("barrier", 4.0, 5.0, -2.0, 4.0),
            Box("barrier", -6.0, -2.0, 3.0, 4.0),
            Box("barrier", 2.0, 7.0, 8.0, 9.0),
            Box("barrier", -10.0, -9.0, -6.0, -1.0),
            Box("barrier", -4.0, 1.0, -8.0, -7.0),
            Box("barrier", 9.0, 10.0, 1.0, 6.0),
        ]
    else:
        raise ValueError(f"unknown scenario {scenario}")
    world.started_with_food = bool(world.foods)
    world.spawn_x = world.pose.x
    world.spawn_y = world.pose.y
    world.spawn_z = world.pose.z
    world.spawn_yaw = world.pose.yaw
    return world


def _dump_object(item: WorldObject | None) -> dict | None:
    if item is None:
        return None
    return {"kind": item.kind, "x": item.x, "y": item.y, "z": item.z, "radius": item.radius}


def _dump_box(box: Box) -> dict:
    return {
        "kind": box.kind,
        "min_x": box.min_x,
        "max_x": box.max_x,
        "min_y": box.min_y,
        "max_y": box.max_y,
        "x": (box.min_x + box.max_x) / 2,
        "y": (box.min_y + box.max_y) / 2,
        "z": 0.7,
        "radius": max(box.max_x - box.min_x, box.max_y - box.min_y) / 2,
        "height": box.height,
    }


def _dump_room(room: Room) -> dict:
    return {"min_x": room.min_x, "max_x": room.max_x, "min_y": room.min_y, "max_y": room.max_y}


def _dump_pose(pose: Pose) -> dict:
    return {"x": pose.x, "y": pose.y, "z": pose.z, "yaw": pose.yaw, "pitch": pose.pitch}


def _pads_inside(world: WorldState) -> list[WorldObject]:
    return [pad for pad in world.landings if _inside_room(world.room, pad)]


def landmarks_from_world(world: WorldState) -> dict:
    pads = _pads_inside(world)
    return {
        "room": _dump_room(world.room),
        "food": _dump_object(world.foods[0] if world.foods else None),
        "landing": _dump_object(pads[0] if pads else None),
        "threat": _dump_object(world.threats[0] if world.threats else None),
        "obstacles": [_dump_box(box) for box in world.obstacles],
    }


def layout_from_world(world: WorldState) -> dict:
    return {
        "room": _dump_room(world.room),
        "foods": [_dump_object(item) for item in world.foods],
        "threats": [_dump_object(item) for item in world.threats],
        "landings": [_dump_object(item) for item in _pads_inside(world)],
        "obstacles": [_dump_box(box) for box in world.obstacles],
        "pose": _dump_pose(world.pose),
    }


def landmarks(scenario: str = "food") -> dict:
    """Static room layout for a scenario. Moving actors are stored on each trace frame."""
    return landmarks_from_world(make_world(scenario))


def _require_inside(room: Room, x: float, y: float, label: str) -> None:
    if not (room.min_x <= x <= room.max_x and room.min_y <= y <= room.max_y):
        raise ValueError(f"{label} is outside the room")


def world_from_layout(layout: dict) -> WorldState:
    room_raw = layout["room"]
    room = Room(float(room_raw["min_x"]), float(room_raw["max_x"]), float(room_raw["min_y"]), float(room_raw["max_y"]))
    if room.max_x <= room.min_x or room.max_y <= room.min_y:
        raise ValueError("room bounds are empty")
    foods = [_object_from_dump(item, "food") for item in layout.get("foods", [])]
    threats = [_object_from_dump(item, "threat") for item in layout.get("threats", [])]
    landings = [_object_from_dump(item, "landing") for item in layout.get("landings", [])]
    obstacles = [_box_from_dump(item) for item in layout.get("obstacles", [])]
    if len(foods) > MAX_FOODS or len(threats) > MAX_THREATS or len(landings) > MAX_PADS or len(obstacles) > MAX_WALLS:
        raise ValueError("layout exceeds the room limits")
    for item in (*foods, *threats, *landings):
        _require_inside(room, item.x, item.y, item.kind)
    for box in obstacles:
        _require_inside(room, box.min_x, box.min_y, "wall")
        _require_inside(room, box.max_x, box.max_y, "wall")
        if box.max_x <= box.min_x or box.max_y <= box.min_y:
            raise ValueError("wall bounds are empty")
    pose_raw = layout.get("pose") or {}
    pose = Pose(
        x=float(pose_raw.get("x", 0.0)),
        y=float(pose_raw.get("y", 0.0)),
        z=float(pose_raw.get("z", 1.0)),
        yaw=float(pose_raw.get("yaw", 0.0)),
        pitch=float(pose_raw.get("pitch", 0.0)),
    )
    _require_inside(room, pose.x, pose.y, "fly")
    return WorldState(
        pose=pose,
        room=room,
        foods=foods,
        landings=landings,
        obstacles=obstacles,
        threats=threats,
        started_with_food=bool(foods),
        predator_speed=PREDATOR_SPEED if threats else 0.0,
        spawn_x=pose.x,
        spawn_y=pose.y,
        spawn_z=pose.z,
        spawn_yaw=pose.yaw,
    )


def _object_from_dump(item: dict, kind: str) -> WorldObject:
    return WorldObject(kind, float(item["x"]), float(item["y"]), float(item.get("z", 1.0)), float(item.get("radius", 0.45)))


def _box_from_dump(item: dict) -> Box:
    return Box(
        "barrier",
        float(item["min_x"]),
        float(item["max_x"]),
        float(item["min_y"]),
        float(item["max_y"]),
        height=float(item.get("height", HALF_Z)),
    )


def _nearest_volume(items: list[WorldObject], pose: Pose) -> tuple[WorldObject | None, float]:
    best: WorldObject | None = None
    best_dist = 1e9
    for item in items:
        dist = _speed_of(item.x - pose.x, item.y - pose.y, item.z - pose.z)
        if dist < best_dist:
            best = item
            best_dist = dist
    return best, best_dist


def _nearest(items: list[WorldObject], pose: Pose) -> tuple[WorldObject | None, float]:
    best: WorldObject | None = None
    best_dist = 1e9
    for item in items:
        dist = hypot(item.x - pose.x, item.y - pose.y)
        if dist < best_dist:
            best = item
            best_dist = dist
    return best, best_dist


def frame_actors(world: WorldState) -> dict:
    foods = [_dump_object(item) for item in world.foods]
    threats = [_dump_object(item) for item in world.threats]
    nearest_food, _food_dist = _nearest(world.foods, world.pose)
    nearest_threat, _threat_dist = _nearest_volume(world.threats, world.pose)
    return {
        "eaten": world.eaten,
        "downed": world.downed,
        "inside_room": inside_room(world),
        "food": _dump_object(nearest_food),
        "foods": foods,
        "predator": _dump_object(nearest_threat),
        "predators": threats,
    }


def _inside_room(room: Room, item: WorldObject | None) -> bool:
    if item is None:
        return False
    return room.min_x <= item.x <= room.max_x and room.min_y <= item.y <= room.max_y


def inside_room(world: WorldState) -> bool:
    pose = world.pose
    room = world.room
    return (
        room.min_x <= pose.x <= room.max_x
        and room.min_y <= pose.y <= room.max_y
        and FLOOR_Z - 1e-9 <= pose.z <= CEILING_Z + 1e-9
    )


def pose_blocked(x: float, y: float, obstacles: list[dict], margin: float = BODY) -> bool:
    for box in obstacles:
        if box["min_x"] - margin < x < box["max_x"] + margin and box["min_y"] - margin < y < box["max_y"] + margin:
            return True
    return False


def angle_delta(target: float, current: float) -> float:
    delta = (target - current + pi) % (2 * pi) - pi
    return float(delta)


def _ray_room_distance(x: float, y: float, dx: float, dy: float, room: Room) -> float:
    hits: list[float] = []
    if abs(dx) > 1e-8:
        hits.append((room.min_x - x) / dx)
        hits.append((room.max_x - x) / dx)
    if abs(dy) > 1e-8:
        hits.append((room.min_y - y) / dy)
        hits.append((room.max_y - y) / dy)
    ahead = [hit for hit in hits if hit > 0.05]
    return min(ahead) if ahead else 99.0


def _ray_box_distance(x: float, y: float, dx: float, dy: float, box: Box) -> float | None:
    tmin = 0.0
    tmax = 1e9
    for origin, direction, lower, upper in (
        (x, dx, box.min_x, box.max_x),
        (y, dy, box.min_y, box.max_y),
    ):
        if abs(direction) < 1e-8:
            if origin < lower or origin > upper:
                return None
            continue
        inv = 1.0 / direction
        t1 = (lower - origin) * inv
        t2 = (upper - origin) * inv
        if t1 > t2:
            t1, t2 = t2, t1
        tmin = max(tmin, t1)
        tmax = min(tmax, t2)
        if tmin > tmax:
            return None
    if tmin > 0.05:
        return tmin
    return None


def _speed_of(vx: float, vy: float, vz: float) -> float:
    return hypot(hypot(vx, vy), vz)


def _limit_velocity(vx: float, vy: float, vz: float, limit: float) -> tuple[float, float, float, float]:
    speed = _speed_of(vx, vy, vz)
    if speed > limit and speed > 0.0:
        scale = limit / speed
        return vx * scale, vy * scale, vz * scale, limit
    return vx, vy, vz, speed


def _contain(
    x: float,
    y: float,
    z: float,
    vx: float,
    vy: float,
    vz: float,
    room: Room,
    margin: float,
    z_margin: float = 0.0,
) -> tuple[float, float, float, float, float, float]:
    low_x = room.min_x + margin
    high_x = room.max_x - margin
    low_y = room.min_y + margin
    high_y = room.max_y - margin
    low_z = FLOOR_Z + z_margin
    high_z = CEILING_Z - z_margin
    if high_z < low_z:
        low_z = high_z = (FLOOR_Z + CEILING_Z) / 2
    if x < low_x:
        x = low_x
        if vx < 0.0:
            vx = 0.0
    elif x > high_x:
        x = high_x
        if vx > 0.0:
            vx = 0.0
    if y < low_y:
        y = low_y
        if vy < 0.0:
            vy = 0.0
    elif y > high_y:
        y = high_y
        if vy > 0.0:
            vy = 0.0
    if z < low_z:
        z = low_z
        if vz < 0.0:
            vz = 0.0
    elif z > high_z:
        z = high_z
        if vz > 0.0:
            vz = 0.0
    return x, y, z, vx, vy, vz


def advance_predator(world: WorldState) -> None:
    if world.downed or world.predator_speed <= 0:
        return
    pose = world.pose
    for threat in world.threats:
        dx = pose.x - threat.x
        dy = pose.y - threat.y
        dz = pose.z - threat.z
        dist = _speed_of(dx, dy, dz)
        if dist <= 0.45:
            closing = 0.0
        elif dist <= CHASE_RANGE:
            closing = 1.0
        else:
            closing = 0.35
        if dist > 1e-8 and closing > 0.0:
            accel = world.predator_speed * (1.0 - PREDATOR_DRAG) * closing
            threat.vx = threat.vx * PREDATOR_DRAG + (dx / dist) * accel
            threat.vy = threat.vy * PREDATOR_DRAG + (dy / dist) * accel
            threat.vz = threat.vz * PREDATOR_DRAG + (dz / dist) * accel
        else:
            threat.vx *= PREDATOR_DRAG
            threat.vy *= PREDATOR_DRAG
            threat.vz *= PREDATOR_DRAG
        threat.vx, threat.vy, threat.vz, _speed = _limit_velocity(threat.vx, threat.vy, threat.vz, world.predator_speed)
        threat.x += threat.vx
        threat.y += threat.vy
        threat.z += threat.vz
        threat.x, threat.y, threat.z, threat.vx, threat.vy, threat.vz = _contain(
            threat.x, threat.y, threat.z, threat.vx, threat.vy, threat.vz, world.room, threat.radius, threat.radius
        )


def _scent_targets(world: WorldState) -> list[WorldObject]:
    return world.foods if world.foods else _pads_inside(world)


def _scent_field(world: WorldState) -> dict:
    targets = _scent_targets(world)
    room = world.room
    key = (
        room.min_x,
        room.max_x,
        room.min_y,
        room.max_y,
        tuple((t.x, t.y) for t in targets),
        tuple((b.min_x, b.max_x, b.min_y, b.max_y) for b in world.obstacles),
    )
    cached = world.scent
    if cached is not None and cached["key"] == key:
        return cached
    cols = max(1, int(ceil((room.max_x - room.min_x) / SCENT_CELL)))
    rows = max(1, int(ceil((room.max_y - room.min_y) / SCENT_CELL)))
    blocked = [False] * (cols * rows)
    for iy in range(rows):
        cy = room.min_y + (iy + 0.5) * SCENT_CELL
        for ix in range(cols):
            cx = room.min_x + (ix + 0.5) * SCENT_CELL
            for box in world.obstacles:
                if box.min_x - BODY < cx < box.max_x + BODY and box.min_y - BODY < cy < box.max_y + BODY:
                    blocked[iy * cols + ix] = True
                    break
    inf = 1e18
    dist = [inf] * (cols * rows)
    for target in targets:
        ix = min(cols - 1, max(0, int((target.x - room.min_x) / SCENT_CELL)))
        iy = min(rows - 1, max(0, int((target.y - room.min_y) / SCENT_CELL)))
        blocked[iy * cols + ix] = False
        dist[iy * cols + ix] = 0.0
    forward = ((-1, -1, _DIAG), (0, -1, 1.0), (1, -1, _DIAG), (-1, 0, 1.0))
    backward = ((1, 1, _DIAG), (0, 1, 1.0), (-1, 1, _DIAG), (1, 0, 1.0))

    def relax(ix: int, iy: int, steps: tuple) -> bool:
        here = iy * cols + ix
        if blocked[here]:
            return False
        changed = False
        for dx, dy, cost in steps:
            nx = ix + dx
            ny = iy + dy
            if nx < 0 or ny < 0 or nx >= cols or ny >= rows:
                continue
            there = ny * cols + nx
            if blocked[there]:
                continue
            if dx and dy and (blocked[iy * cols + nx] or blocked[ny * cols + ix]):
                continue
            candidate = dist[there] + cost
            if candidate < dist[here]:
                dist[here] = candidate
                changed = True
        return changed

    if targets:
        for _ in range(200):
            changed = False
            for iy in range(rows):
                for ix in range(cols):
                    changed |= relax(ix, iy, forward)
            for iy in range(rows - 1, -1, -1):
                for ix in range(cols - 1, -1, -1):
                    changed |= relax(ix, iy, backward)
            if not changed:
                break
    field = {"key": key, "cols": cols, "rows": rows, "blocked": blocked, "dist": dist}
    world.scent = field
    return field


def _scent_direction(world: WorldState, pose: Pose) -> tuple[float, float] | None:
    """Downhill heading and path length (meters) from the fly to the nearest target."""
    field = _scent_field(world)
    room = world.room
    cols = field["cols"]
    rows = field["rows"]
    dist = field["dist"]
    blocked = field["blocked"]
    ix = min(cols - 1, max(0, int((pose.x - room.min_x) / SCENT_CELL)))
    iy = min(rows - 1, max(0, int((pose.y - room.min_y) / SCENT_CELL)))
    here = dist[iy * cols + ix]
    if here >= 1e17 or blocked[iy * cols + ix]:
        return None
    gx = 0.0
    gy = 0.0
    for dx, dy, length in (
        (-1, -1, _DIAG), (0, -1, 1.0), (1, -1, _DIAG), (-1, 0, 1.0),
        (1, 0, 1.0), (-1, 1, _DIAG), (0, 1, 1.0), (1, 1, _DIAG),
    ):
        nx = ix + dx
        ny = iy + dy
        if nx < 0 or ny < 0 or nx >= cols or ny >= rows:
            continue
        there = dist[ny * cols + nx]
        if there >= 1e17 or blocked[ny * cols + nx]:
            continue
        if dx and dy and (blocked[iy * cols + nx] or blocked[ny * cols + ix]):
            continue
        gain = (here - there) / length
        gx += gain * dx
        gy += gain * dy
    if hypot(gx, gy) < 1e-9:
        return None
    return atan2(gy, gx), here * SCENT_CELL


def encode_sensors(world: WorldState, n: int) -> np.ndarray:
    drive = np.zeros(n, dtype=np.float32)
    pose = world.pose
    targets = _scent_targets(world)
    if targets:
        found = _scent_direction(world, pose)
        if found is None:
            near, near_dist = _nearest(targets, pose)
            heading = atan2(near.y - pose.y, near.x - pose.x)
            travel = near_dist
        else:
            heading, travel = found
        food_dist = max(0.001, travel)
        food_angle = angle_delta(heading, pose.yaw)
        odor = exp(-food_dist / SCENT_LENGTH)
        forward = odor * max(0.0, cos(food_angle))
        left = odor * max(0.0, sin(food_angle))
        right = odor * max(0.0, -sin(food_angle))
        drive[list(ODOR_LEFT)] = np.float32(forward + left)
        drive[list(ODOR_RIGHT)] = np.float32(forward + right)

    nearest_pad: tuple[float, WorldObject] | None = None
    for pad in world.landings:
        pad_dist = hypot(pad.x - pose.x, pad.y - pose.y)
        pad_angle = angle_delta(atan2(pad.y - pose.y, pad.x - pose.x), pose.yaw)
        if pad_dist < 2.4 and abs(pad_angle) < pi / 2 and (nearest_pad is None or pad_dist < nearest_pad[0]):
            nearest_pad = (pad_dist, pad)
    if nearest_pad is not None:
        drive[list(CONTACT)] = np.float32(max(0.35, 1.0 - nearest_pad[0] / 2.4))

    _threat, threat_dist = _nearest_volume(world.threats, pose)
    if _threat is not None and threat_dist < LOOM_RANGE:
        strength = (LOOM_RANGE - threat_dist) / LOOM_RANGE
        bearing = angle_delta(atan2(_threat.y - pose.y, _threat.x - pose.x), pose.yaw)
        drive[LOOM.start + loom_bin_index(bearing)] = np.float32(strength)
        horiz = max(1e-8, hypot(_threat.x - pose.x, _threat.y - pose.y))
        below = strength * max(0.0, -sin(atan2(_threat.z - pose.z, horiz)))
        if below > 0.0:
            boosted = np.float32(below * 1.4)
            for index in motor_span("pitch_up", n):
                drive[index] = np.float32(max(float(drive[index]), float(boosted)))

    rays = 64
    for i in range(rays):
        ray_angle = pose.yaw + (i / (rays - 1) - 0.5) * pi
        dx = cos(ray_angle)
        dy = sin(ray_angle)
        dist = _ray_room_distance(pose.x, pose.y, dx, dy, world.room)
        for box in world.obstacles:
            if not _occludes(box, pose.z):
                continue
            hit = _ray_box_distance(pose.x, pose.y, dx, dy, box)
            if hit is not None:
                dist = min(dist, hit)
        if dist < VISION_RANGE:
            drive[i] = np.float32((VISION_RANGE - dist) / VISION_RANGE)
    quiet = not targets and nearest_pad is None and (_threat is None or threat_dist >= LOOM_RANGE)
    if quiet:
        for index in motor_span("rest"):
            drive[index] = np.float32(1.05)
        if world.tick % 11 == 0:
            for index in motor_span("groom_fore"):
                drive[index] = np.float32(1.05)
    return drive


def _push_out(pose: Pose, box: Box, margin: float) -> None:
    min_x = box.min_x - margin
    max_x = box.max_x + margin
    min_y = box.min_y - margin
    max_y = box.max_y + margin
    if not (min_x < pose.x < max_x and min_y < pose.y < max_y):
        return
    left = pose.x - min_x
    right = max_x - pose.x
    bottom = pose.y - min_y
    top = max_y - pose.y
    nearest = min(left, right, bottom, top)
    if nearest == left:
        pose.x = min_x
        if pose.vx > 0.0:
            pose.vx = 0.0
    elif nearest == right:
        pose.x = max_x
        if pose.vx < 0.0:
            pose.vx = 0.0
    elif nearest == bottom:
        pose.y = min_y
        if pose.vy > 0.0:
            pose.vy = 0.0
    else:
        pose.y = max_y
        if pose.vy < 0.0:
            pose.vy = 0.0


def resolve_solids(world: WorldState) -> None:
    pose = world.pose
    for box in world.obstacles:
        if _occludes(box, pose.z):
            _push_out(pose, box, BODY)
    pose.x, pose.y, pose.z, pose.vx, pose.vy, pose.vz = _contain(
        pose.x, pose.y, pose.z, pose.vx, pose.vy, pose.vz, world.room, BODY
    )
    pose.speed = _speed_of(pose.vx, pose.vy, pose.vz)


def try_catch(world: WorldState) -> None:
    """A hunter that reaches the body holds the fly where it fell, until respawn."""
    if world.spawn_shield > 0:
        world.spawn_shield -= 1
        return
    if world.downed:
        return
    pose = world.pose
    for threat in world.threats:
        dist = _speed_of(pose.x - threat.x, pose.y - threat.y, pose.z - threat.z)
        if dist > threat.radius + 0.22:
            continue
        pose.vx = 0.0
        pose.vy = 0.0
        pose.vz = 0.0
        pose.yaw_rate = 0.0
        pose.speed = 0.0
        world.landing_hold = 0
        world.downed = True
        return


def respawn(world: WorldState) -> None:
    """Place the fly on a random landing pad inside the room, or back at the start."""
    pads = _pads_inside(world)
    pose = world.pose
    if pads:
        world.rng = (world.rng * 1664525 + 1013904223) & 0xFFFFFFFF
        pad = pads[world.rng % len(pads)]
        span = float(0xFFFFFF)
        pose.yaw = ((world.rng >> 8) / span) * 2.0 * pi - pi
        pose.x = pad.x
        pose.y = pad.y
        pose.z = 1.15
    else:
        pose.x = world.spawn_x
        pose.y = world.spawn_y
        pose.z = world.spawn_z
        pose.yaw = world.spawn_yaw
    pose.pitch = 0.0
    pose.vx = 0.0
    pose.vy = 0.0
    pose.vz = 0.0
    pose.yaw_rate = 0.0
    pose.speed = 0.0
    world.downed = False
    world.landing_hold = 0
    world.escape_hold = 0
    world.saccade_cool = 0
    world.escape_moved = False
    world.yaw_latch = 0.0
    world.yaw_latch_age = 0
    world.climb_bias = 0.0
    world.jump_ticks = 0
    world.spawn_shield = 30


def try_eat(world: WorldState) -> None:
    if world.downed or world.eaten or not world.foods:
        return
    kept: list[WorldObject] = []
    for food in world.foods:
        if hypot(food.x - world.pose.x, food.y - world.pose.y) <= food.radius + 0.08:
            continue
        kept.append(food)
    world.foods = kept
    if world.started_with_food and not world.foods:
        world.eaten = True


def _hover_lift(z: float, landing: bool) -> float:
    """Steady descent onto a pad."""
    if landing:
        return 0.0 if z <= FLOOR_Z + 0.05 else -0.045
    return 0.0


def _occludes(box: Box, z: float) -> bool:
    """A wall blocks the body only while the fly is still below its top."""
    return z < box.height + 0.2


def _half_hedge_ahead(world: WorldState) -> float:
    """Tallest half hedge close on the nose, when the body has not already cleared it."""
    pose = world.pose
    dx = cos(pose.yaw)
    dy = sin(pose.yaw)
    top = 0.0
    for box in world.obstacles:
        if box.height >= CEILING_Z - 0.3:
            continue
        hit = _ray_box_distance(pose.x, pose.y, dx, dy, box)
        if hit is not None and hit < 1.8 and pose.z < box.height + 0.35:
            top = max(top, box.height)
    return top


def _altitude_gap(world: WorldState) -> tuple[float, bool]:
    """Height error from how close the hunter is, plus a climb to clear a half hedge."""
    pose = world.pose
    threat, dist = _nearest_volume(world.threats, pose)
    target = 0.95
    hunter_below = False
    if threat is not None and dist < LOOM_RANGE:
        closeness = 1.0 - dist / LOOM_RANGE
        target = 0.72 + closeness * 1.25
        hunter_below = threat.z < pose.z
    ahead_top = _half_hedge_ahead(world)
    if ahead_top > 0.0:
        target = max(target, ahead_top + 0.5)
    target = min(2.05, max(0.7, target))
    return target - pose.z, hunter_below


def _pitch_toward(pose: Pose, climb_bias: float, land: float, gap: float, hunter_below: bool) -> None:
    """Nose toward the height the chase and the hedges ask for."""
    attitude = max(-0.45, min(0.55, gap * 1.6))
    if hunter_below:
        attitude += 0.06 * climb_bias
    attitude = max(-0.45, min(0.55, attitude))
    pose.pitch = 0.8 * pose.pitch + 0.2 * (attitude - 0.45 * land)


def _pitched_lift(vz: float, pitch: float, forward: float, gap: float) -> float:
    """Close a meter of height in about a second, and hold once the gap is gone."""
    hold = -0.22 * vz
    climb = sin(pitch) * max(forward, 0.0) + 0.045 * max(-1.2, min(1.2, gap))
    return max(-0.04, min(0.05, hold + climb))


def _heading_clearance(world: WorldState, angle: float) -> float:
    pose = world.pose
    dx = cos(angle)
    dy = sin(angle)
    dist = _ray_room_distance(pose.x, pose.y, dx, dy, world.room)
    for box in world.obstacles:
        if not _occludes(box, pose.z):
            continue
        hit = _ray_box_distance(pose.x, pose.y, dx, dy, box)
        if hit is not None:
            dist = min(dist, hit)
    return dist


def _wall_avoid(world: WorldState) -> tuple[float, float, float]:
    """Yaw away from a wall, the clearance ahead, and which way is open.

    Positive side is a left turn. Side is 0 when nothing is close.
    """
    ahead = _heading_clearance(world, world.pose.yaw)
    if ahead >= 2.6:
        return 0.0, ahead, 0.0
    left = _heading_clearance(world, world.pose.yaw + 0.7)
    right = _heading_clearance(world, world.pose.yaw - 0.7)
    if left > right + 0.05:
        side = 1.0
    elif right > left + 0.05:
        side = -1.0
    else:
        side = 1.0
    urgency = (2.6 - ahead) / 2.6
    return copysign(0.22 + 0.75 * urgency, side), ahead, side


def _bleed_face(pose: Pose, dist: float, nx: float, ny: float) -> None:
    """Drop speed that is still closing on a nearby face."""
    pad = 1.25
    if dist >= pad:
        return
    closing = -(pose.vx * nx + pose.vy * ny)
    if closing <= 0.0:
        return
    keep = max(0.0, dist / pad)
    pose.vx += closing * (1.0 - keep) * nx
    pose.vy += closing * (1.0 - keep) * ny


def _bleed_walls(world: WorldState) -> None:
    pose = world.pose
    room = world.room
    _bleed_face(pose, pose.x - room.min_x - BODY, 1.0, 0.0)
    _bleed_face(pose, room.max_x - BODY - pose.x, -1.0, 0.0)
    _bleed_face(pose, pose.y - room.min_y - BODY, 0.0, 1.0)
    _bleed_face(pose, room.max_y - BODY - pose.y, 0.0, -1.0)
    for box in world.obstacles:
        if not _occludes(box, pose.z):
            continue
        min_x = box.min_x - BODY
        max_x = box.max_x + BODY
        min_y = box.min_y - BODY
        max_y = box.max_y + BODY
        if min_y <= pose.y <= max_y:
            if pose.x <= min_x:
                _bleed_face(pose, min_x - pose.x, -1.0, 0.0)
            elif pose.x >= max_x:
                _bleed_face(pose, pose.x - max_x, 1.0, 0.0)
        if min_x <= pose.x <= max_x:
            if pose.y <= min_y:
                _bleed_face(pose, min_y - pose.y, 0.0, -1.0)
            elif pose.y >= max_y:
                _bleed_face(pose, pose.y - max_y, 0.0, 1.0)


def apply_motors(world: WorldState, motor_rates: dict[str, float]) -> dict[str, float | bool]:
    if world.downed:
        return {"thrust": 0.0, "yaw": 0.0, "pitch": 0.0, "land": False, "escape": False}
    pose = world.pose
    escape = motor_rates.get("escape", 0.0)
    thrust = motor_rates.get("thrust", 0.0)
    yaw_left = motor_rates.get("yaw_left", 0.0)
    yaw_right = motor_rates.get("yaw_right", 0.0)
    pitch_up = motor_rates.get("pitch_up", 0.0)
    land = motor_rates.get("land", 0.0)
    walk = motor_rates.get("walk", 0.0)
    groom = max(motor_rates.get("groom_fore", 0.0), motor_rates.get("groom_hind", 0.0), motor_rates.get("groom_wing", 0.0))
    feed = motor_rates.get("feed", 0.0)
    rest = motor_rates.get("rest", 0.0)
    gesture = max(groom, feed, rest)

    if escape >= 0.5:
        world.escape_hold = 6
    elif world.escape_hold > 0:
        world.escape_hold -= 1
    if land >= 0.5:
        world.landing_hold = 8
    elif world.landing_hold > 0:
        world.landing_hold -= 1
    fleeing = escape >= 0.5 or world.escape_hold > 0
    if fleeing:
        world.landing_hold = 0
    landing = (not fleeing) and (land >= 0.5 or world.landing_hold > 0)
    command = {
        "thrust": float(thrust),
        "yaw": float(yaw_left - yaw_right),
        "pitch": float(pitch_up - land),
        "land": bool(land > 0.2),
        "escape": fleeing,
    }
    steer = yaw_left - yaw_right
    if abs(steer) >= 0.5:
        world.yaw_latch = copysign(1.1, steer)
        world.yaw_latch_age = 0
    elif world.yaw_latch != 0.0:
        world.yaw_latch_age += 1
        if world.yaw_latch_age > 2:
            world.yaw_latch = 0.0
    if fleeing:
        if hypot(pose.vx, pose.vy) > 0.05:
            world.escape_moved = True
        if world.saccade_cool > 0:
            world.saccade_cool -= 1
            yaw_cmd = 0.06 * steer
        elif abs(steer) >= 0.5:
            yaw_cmd = copysign(1.1, steer)
            world.saccade_cool = 7
        elif world.yaw_latch != 0.0:
            yaw_cmd = world.yaw_latch
            world.yaw_latch = 0.0
            world.saccade_cool = 7
        elif world.escape_moved and hypot(pose.vx, pose.vy) < 0.02:
            threat, _threat_gap = _nearest_volume(world.threats, pose)
            if threat is None:
                away = 1.0
            else:
                bearing = angle_delta(atan2(threat.y - pose.y, threat.x - pose.x), pose.yaw)
                signed = -sin(bearing)
                away = signed if abs(signed) > 0.2 else 1.0
            yaw_cmd = copysign(1.1, away)
            world.saccade_cool = 7
        else:
            yaw_cmd = 0.06 * steer
    else:
        world.saccade_cool = 0
        world.escape_moved = False
        world.jump_ticks = 0
        yaw_cmd = 0.28 * steer
    avoid, ahead, open_side = _wall_avoid(world)
    if ahead < 0.55:
        yaw_cmd = avoid
    elif ahead < 1.2:
        yaw_cmd = 0.55 * yaw_cmd + avoid
    pose.yaw_rate = pose.yaw_rate * 0.75 + yaw_cmd * 0.25
    pose.yaw += pose.yaw_rate
    walking = (not fleeing) and walk >= 0.5 and walk > thrust
    settling = (not fleeing) and land < 0.5 and gesture >= 0.5 and gesture > thrust and gesture > walk
    pad_goal = (not world.foods) and (not world.threats) and bool(_pads_inside(world))
    body_idle = (not world.foods) and (not world.threats) and (not pad_goal) and (not fleeing) and land < 0.5 and thrust < 0.5 and walk < 0.5
    world.climb_bias = 0.85 * world.climb_bias + 0.15 * pitch_up
    gap, hunter_below = _altitude_gap(world)
    _pitch_toward(pose, world.climb_bias, land, gap, hunter_below)
    if fleeing:
        forward = 0.034
    elif body_idle:
        forward = 0.0
    elif walking:
        forward = 0.012
    elif settling:
        forward = 0.0
    elif landing and pad_goal:
        forward = 0.0
    else:
        forward = 0.0192 * thrust
    cruising = bool(world.threats) and not body_idle and not settling and not landing
    if cruising:
        forward = max(forward, 0.016)
    if ahead < 1.4 and forward > 0.0:
        if cruising:
            capped = max(0.016, (ahead - 0.35) * 0.04)
        else:
            capped = max(0.0, (ahead - 0.5) * 0.05)
        forward = min(forward, capped)
    if landing:
        lift = _hover_lift(pose.z, True)
    else:
        lift = _pitched_lift(pose.vz, pose.pitch, forward, gap)
    drag = FLY_DRAG * (0.62 if settling else 1.0)
    pose.vx = pose.vx * drag + cos(pose.yaw) * forward
    pose.vy = pose.vy * drag + sin(pose.yaw) * forward
    pose.vz = pose.vz * drag + lift
    pose.vx, pose.vy, pose.vz, pose.speed = _limit_velocity(pose.vx, pose.vy, pose.vz, MAX_FLY_SPEED)
    _bleed_walls(world)
    if (
        ahead < 1.2
        and open_side != 0.0
        and cruising
        and hypot(pose.vx, pose.vy) < 0.03
    ):
        heading = pose.yaw + open_side * 1.1
        pose.vx += cos(heading) * 0.016
        pose.vy += sin(heading) * 0.016
    pose.speed = _speed_of(pose.vx, pose.vy, pose.vz)
    pose.x += pose.vx
    pose.y += pose.vy
    pose.z += pose.vz
    world.tick += 1
    return command
