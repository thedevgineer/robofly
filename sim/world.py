from __future__ import annotations

from dataclasses import dataclass, field
from math import atan2, cos, exp, hypot, pi, sin

import numpy as np

from .topology import CONTACT, LOOM, ODOR_LEFT, ODOR_RIGHT, motor_span

BODY = 0.18
VISION_RANGE = 2.3
LOOM_RANGE = 7.0
PREDATOR_SPEED = 0.06
PREDATOR_DRAG = 0.88
FLY_DRAG = 0.88
MAX_FLY_SPEED = 0.24
FLOOR_Z = 0.12
CEILING_Z = 2.35
MAX_WALLS = 8
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
    tick: int = 0


def _far_pad() -> WorldObject:
    return WorldObject("landing", 40.0, 40.0, 0.15, 0.5)


def make_world(scenario: str = "food") -> WorldState:
    world = WorldState()
    world.landings = [_far_pad()]
    if scenario == "food":
        world.room = Room(-12.0, 24.0, -12.0, 18.0)
        world.foods = [WorldObject("food", 2.4, 1.9, 1.0, 0.45)]
    elif scenario == "loom":
        world.room = Room(-3.45, 3.45, -3.45, 3.45)
        world.pose = Pose(x=0.35, y=0.0, z=1.5, yaw=0.6)
        world.threats = [WorldObject("threat", -0.65, 0.2, 0.42, 0.4)]
        world.predator_speed = PREDATOR_SPEED
    elif scenario == "obstacle":
        world.room = Room(-9.0, 24.0, -9.0, 12.0)
        world.obstacles = [Box("barrier", 1.55, 2.15, -2.2, 0.45)]
        world.foods = [WorldObject("food", 4.2, 1.8, 1.0, 0.45)]
    elif scenario == "landing":
        world.room = Room(-12.0, 15.0, -12.0, 12.0)
        world.landings = [WorldObject("landing", 0.15, 0.0, 0.12, 0.7)]
    elif scenario == "silent":
        world.room = Room(-24.0, 24.0, -24.0, 24.0)
    else:
        raise ValueError(f"unknown scenario {scenario}")
    world.started_with_food = bool(world.foods)
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
    )


def _object_from_dump(item: dict, kind: str) -> WorldObject:
    return WorldObject(kind, float(item["x"]), float(item["y"]), float(item.get("z", 1.0)), float(item.get("radius", 0.45)))


def _box_from_dump(item: dict) -> Box:
    return Box("barrier", float(item["min_x"]), float(item["max_x"]), float(item["min_y"]), float(item["max_y"]))


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
    if world.predator_speed <= 0:
        return
    pose = world.pose
    for threat in world.threats:
        dx = pose.x - threat.x
        dy = pose.y - threat.y
        dz = pose.z - threat.z
        dist = _speed_of(dx, dy, dz)
        closing = 0.0 if dist <= 0.28 else min(1.0, (dist - 0.28) / 0.35)
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


def encode_sensors(world: WorldState, n: int) -> np.ndarray:
    drive = np.zeros(n, dtype=np.float32)
    pose = world.pose
    food, food_dist = _nearest(world.foods, pose)
    if food is not None:
        food_dist = max(0.001, food_dist)
        food_angle = angle_delta(atan2(food.y - pose.y, food.x - pose.x), pose.yaw)
        odor = exp(-food_dist / 3.2)
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
        drive[list(LOOM)] = np.float32((LOOM_RANGE - threat_dist) / LOOM_RANGE)

    rays = 64
    for i in range(rays):
        ray_angle = pose.yaw + (i / (rays - 1) - 0.5) * pi
        dx = cos(ray_angle)
        dy = sin(ray_angle)
        dist = _ray_room_distance(pose.x, pose.y, dx, dy, world.room)
        for box in world.obstacles:
            hit = _ray_box_distance(pose.x, pose.y, dx, dy, box)
            if hit is not None:
                dist = min(dist, hit)
        if dist < VISION_RANGE:
            drive[i] = np.float32((VISION_RANGE - dist) / VISION_RANGE)
    quiet = food is None and nearest_pad is None and (_threat is None or threat_dist >= LOOM_RANGE)
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
        _push_out(pose, box, BODY)
    pose.x, pose.y, pose.z, pose.vx, pose.vy, pose.vz = _contain(
        pose.x, pose.y, pose.z, pose.vx, pose.vy, pose.vz, world.room, BODY
    )
    pose.speed = _speed_of(pose.vx, pose.vy, pose.vz)


def try_eat(world: WorldState) -> None:
    if world.eaten or not world.foods:
        return
    kept: list[WorldObject] = []
    for food in world.foods:
        if hypot(food.x - world.pose.x, food.y - world.pose.y) <= food.radius + 0.08:
            continue
        kept.append(food)
    world.foods = kept
    if world.started_with_food and not world.foods:
        world.eaten = True


def apply_motors(world: WorldState, motor_rates: dict[str, float]) -> dict[str, float | bool]:
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
    fleeing = escape >= 0.5 or world.escape_hold > 0
    command = {
        "thrust": float(thrust),
        "yaw": float(yaw_left - yaw_right),
        "pitch": float(pitch_up - land),
        "land": bool(land > 0.2),
        "escape": fleeing,
    }
    yaw_cmd = 0.16 if fleeing else 0.28 * (yaw_left - yaw_right)
    pose.yaw_rate = pose.yaw_rate * 0.75 + yaw_cmd * 0.25
    pose.yaw += pose.yaw_rate
    walking = (not fleeing) and walk >= 0.5 and walk > thrust
    settling = (not fleeing) and land < 0.5 and gesture >= 0.5 and gesture > thrust and gesture > walk
    _threat, threat_dist = _nearest_volume(world.threats, pose)
    room_quiet = (not world.foods) and (not fleeing) and (_threat is None or threat_dist >= LOOM_RANGE)
    body_idle = room_quiet and land < 0.5 and thrust < 0.5 and walk < 0.5
    if fleeing:
        pose.pitch = 0.82 * pose.pitch + 0.18 * 0.65
        forward = 0.03
        lift = 0.018
    elif body_idle:
        landed = pose.z <= FLOOR_Z + 0.05
        pose.pitch = 0.82 * pose.pitch + (0.0 if landed else 0.18 * -0.4)
        forward = 0.0
        lift = 0.0 if landed else -0.03
    elif walking:
        pose.pitch = 0.82 * pose.pitch + 0.18 * (pitch_up - land)
        forward = 0.012
        lift = -0.016 if pose.z > FLOOR_Z + 0.28 else 0.0
    elif settling:
        landed = pose.z <= FLOOR_Z + 0.05
        pose.pitch = 0.82 * pose.pitch + (0.0 if landed else 0.18 * -0.4)
        forward = 0.0
        lift = 0.0 if landed else -0.03
    else:
        pose.pitch = 0.82 * pose.pitch + 0.18 * (pitch_up - land)
        forward = 0.0192 * thrust
        lift = 0.012 * pose.pitch - (0.02 if land >= 0.5 else 0.0)
    drag = FLY_DRAG * (0.62 if settling or body_idle else 1.0)
    pose.vx = pose.vx * drag + cos(pose.yaw) * forward
    pose.vy = pose.vy * drag + sin(pose.yaw) * forward
    pose.vz = pose.vz * drag + lift
    pose.vx, pose.vy, pose.vz, pose.speed = _limit_velocity(pose.vx, pose.vy, pose.vz, MAX_FLY_SPEED)
    pose.x += pose.vx
    pose.y += pose.vy
    pose.z += pose.vz
    world.tick += 1
    return command
