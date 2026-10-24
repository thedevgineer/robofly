from math import atan2, hypot
from pathlib import Path

from sim.runner import read_trace, run_simulation
from sim.world import (
    CEILING_Z,
    FLOOR_Z,
    advance_predator,
    angle_delta,
    apply_motors,
    landmarks,
    make_world,
    Box,
    pose_blocked,
    resolve_solids,
    respawn,
    try_catch,
)


def _run(tmp_path: Path, scenario: str, steps: int) -> tuple[list[dict], dict]:
    run_simulation(tmp_path / scenario, steps=steps, scenario=scenario, seed=1701)
    return read_trace(tmp_path / scenario), landmarks(scenario)


def test_food_is_eaten_inside_the_room(tmp_path: Path):
    frames, _marks = _run(tmp_path, "food", 400)
    assert any(frame["eaten"] for frame in frames)
    assert all(frame["inside_room"] for frame in frames)


def test_predator_escape_increases_distance(tmp_path: Path):
    frames, _marks = _run(tmp_path, "loom", 180)
    start = next(frame for frame in frames if frame["motor_rates"]["escape"] > 0)
    later = frames[start["step"] + 1 : start["step"] + 12]

    def gap(frame: dict) -> float:
        predator = frame["predator"]
        pose = frame["pose"]
        return hypot(hypot(pose["x"] - predator["x"], pose["y"] - predator["y"]), pose["z"] - predator["z"])

    assert max(gap(frame) for frame in later) > gap(start) + 0.15
    assert frames[-1]["predator"]["z"] > frames[0]["predator"]["z"] + 0.2
    assert all(FLOOR_Z - 1e-9 <= frame["pose"]["z"] <= CEILING_Z + 1e-9 for frame in frames)
    fleeing = frames[start["step"] :]
    assert sum(frame["command"]["escape"] for frame in fleeing[:24]) / min(24, len(fleeing)) > 0.9
    rates = [frame["pose"]["yaw_rate"] for frame in fleeing]
    near_zero = sum(abs(rate) < 0.05 for rate in rates) / len(rates)
    assert near_zero > 0.3
    assert sum(rate > 0.1 for rate in rates) / len(rates) < 0.85
    pose = start["pose"]
    threat = start["predator"]
    bearing = angle_delta(atan2(threat["y"] - pose["y"], threat["x"] - pose["x"]), pose["yaw"])
    strong = next(frame for frame in fleeing if abs(frame["pose"]["yaw_rate"]) > 0.15)
    assert abs(bearing) > 0.2
    assert strong["pose"]["yaw_rate"] * bearing < 0


def test_predator_keeps_moving(tmp_path: Path):
    frames, _marks = _run(tmp_path, "loom", 220)
    streak = 0
    worst = 0
    for frame in frames:
        if frame["command"]["land"]:
            streak = 0
            continue
        horizontal = hypot(frame["pose"]["vx"], frame["pose"]["vy"])
        if horizontal < 0.02:
            streak += 1
            worst = max(worst, streak)
        else:
            streak = 0
    assert worst < 8


def test_escape_holds_altitude_and_stays_off_the_walls(tmp_path: Path):
    frames, marks = _run(tmp_path, "loom", 220)
    zs = [frame["pose"]["z"] for frame in frames if not frame.get("downed")]
    assert min(zs) > 0.45
    assert max(zs) < 2.2
    assert max(zs) - min(zs) > 0.55
    room = marks["room"]
    margin = 0.7
    for frame in frames:
        pose = frame["pose"]
        assert room["min_x"] + margin < pose["x"] < room["max_x"] - margin
        assert room["min_y"] + margin < pose["y"] < room["max_y"] - margin


def test_obstacle_food_is_reached_without_crossing_the_barrier(tmp_path: Path):
    frames, marks = _run(tmp_path, "obstacle", 500)
    assert any(frame["eaten"] for frame in frames)
    assert all(
        not pose_blocked(frame["pose"]["x"], frame["pose"]["y"], marks["obstacles"]) for frame in frames
    )


def test_landing_descends_onto_the_pad(tmp_path: Path):
    frames, marks = _run(tmp_path, "landing", 80)
    pad = marks["landing"]
    assert pad is not None
    assert any(
        frame["command"]["land"]
        and frame["pose"]["z"] < 0.55
        and hypot(frame["pose"]["x"] - pad["x"], frame["pose"]["y"] - pad["y"]) < 0.8
        for frame in frames
    )


def test_enemy_climbs_after_the_fly_and_both_keep_momentum():
    world = make_world("loom")
    threat = world.threats[0]
    threat.x = world.pose.x
    threat.y = world.pose.y
    threat.z = 0.4
    world.pose.z = 2.0
    advance_predator(world)
    first = hypot(threat.vx, threat.vy, threat.vz)
    for _ in range(24):
        advance_predator(world)
    assert threat.z > 0.7
    assert hypot(threat.vx, threat.vy, threat.vz) > first
    assert threat.vz > 0.0
    assert threat.z <= CEILING_Z

    cruise = {"thrust": 1.0, "yaw_left": 0.0, "yaw_right": 0.0, "pitch_up": 0.0, "land": 0.0, "escape": 0.0}
    coast = {**cruise, "thrust": 0.0}
    flyer = make_world("silent")
    apply_motors(flyer, cruise)
    resolve_solids(flyer)
    opened = flyer.pose.speed
    for _ in range(16):
        apply_motors(flyer, cruise)
        resolve_solids(flyer)
    assert flyer.pose.speed > opened * 2
    for _ in range(4):
        apply_motors(flyer, coast)
        resolve_solids(flyer)
    assert flyer.pose.speed > opened
    for _ in range(40):
        apply_motors(flyer, {"thrust": 0.0, "yaw_left": 0.0, "yaw_right": 0.0, "pitch_up": 1.0, "land": 0.0, "escape": 1.0})
        resolve_solids(flyer)
    assert FLOOR_Z <= flyer.pose.z <= CEILING_Z
    assert flyer.room.min_x <= flyer.pose.x <= flyer.room.max_x
    assert flyer.room.min_y <= flyer.pose.y <= flyer.room.max_y


def test_yard_stays_airborne_inside_the_court(tmp_path: Path):
    frames, marks = _run(tmp_path, "yard", 220)
    room = marks["room"]
    zs = [frame["pose"]["z"] for frame in frames if not frame.get("downed")]
    streak = 0
    worst_streak = 0
    for frame in frames:
        pose = frame["pose"]
        assert room["min_x"] < pose["x"] < room["max_x"]
        assert room["min_y"] < pose["y"] < room["max_y"]
        if frame.get("downed") or frame["command"]["land"]:
            streak = 0
            continue
        horizontal = hypot(pose["vx"], pose["vy"])
        if horizontal < 0.02:
            streak += 1
            worst_streak = max(worst_streak, streak)
        else:
            streak = 0
    assert min(zs) > 0.45
    assert max(zs) < 2.2
    assert max(zs) - min(zs) > 0.55
    assert worst_streak < 8


def test_a_catch_holds_until_respawn():
    world = make_world("loom")
    start = (world.spawn_x, world.spawn_y, world.spawn_z, world.spawn_yaw)
    world.pose.x = 4.0
    world.pose.y = 3.0
    world.pose.z = 1.6
    world.pose.vx = 0.04
    threat = world.threats[0]
    threat.x = world.pose.x
    threat.y = world.pose.y
    threat.z = world.pose.z
    try_catch(world)
    assert world.downed
    assert (world.pose.x, world.pose.y, world.pose.z) == (4.0, 3.0, 1.6)
    assert world.pose.vx == 0.0
    respawn(world)
    assert not world.downed
    assert (world.pose.x, world.pose.y, world.pose.z, world.pose.yaw) == start
    assert world.spawn_shield == 30
    world.pose.x = threat.x
    world.pose.y = threat.y
    world.pose.z = threat.z
    try_catch(world)
    assert not world.downed
    assert world.pose.x == threat.x


def test_respawn_uses_a_landing_pad_inside_the_room():
    world = make_world("yard")
    world.downed = True
    respawn(world)
    assert abs(world.pose.x - 10.0) < 1e-9
    assert abs(world.pose.y - (-8.0)) < 1e-9
    assert abs(world.pose.z - 1.15) < 1e-9
    assert not world.downed


def test_a_half_hedge_can_be_flown_over_and_a_full_one_cannot():
    world = make_world("silent")
    world.obstacles = [Box("barrier", -0.5, 0.5, 0.8, 1.8, height=CEILING_Z * 0.5)]
    world.pose.x = 0.0
    world.pose.y = 1.3
    world.pose.z = 0.6
    resolve_solids(world)
    assert world.pose.y <= 0.8 or world.pose.y >= 1.8 or abs(world.pose.x) >= 0.5
    world.pose.x = 0.0
    world.pose.y = 1.3
    world.pose.z = 2.0
    resolve_solids(world)
    assert abs(world.pose.x) < 0.05
    assert abs(world.pose.y - 1.3) < 0.05
    world.obstacles = [Box("barrier", -0.5, 0.5, 0.8, 1.8, height=CEILING_Z)]
    world.pose.x = 0.0
    world.pose.y = 1.3
    world.pose.z = 2.0
    resolve_solids(world)
    assert world.pose.y <= 0.8 or world.pose.y >= 1.8 or abs(world.pose.x) >= 0.5


def test_silent_room_stays_quiet(tmp_path: Path):
    frames, _marks = _run(tmp_path, "silent", 60)
    flight = ("thrust", "yaw_left", "yaw_right", "pitch_up", "land", "escape")
    assert all(frame["motor_rates"][name] == 0.0 for frame in frames for name in flight)
    assert any(frame["motor_rates"]["rest"] > 0 or frame["motor_rates"]["groom_fore"] > 0 for frame in frames)
    end = frames[-1]["pose"]
    assert hypot(end["x"], end["y"]) < 0.05
    assert end["z"] > 0.6


def test_scent_flows_around_a_wall():
    from sim.world import WorldObject, _scent_direction

    world = make_world("silent")
    world.foods = [WorldObject("food", 5.0, 0.0, 1.0, 0.45)]
    world.obstacles = [Box("barrier", 1.0, 2.0, -4.0, 4.0, height=CEILING_Z * 0.5)]
    world.pose.x = -1.0
    world.pose.y = 0.0
    heading, travel = _scent_direction(world, world.pose)
    assert travel > 6.5
    assert abs(heading) > 0.15


def test_fly_seeks_a_landing_pad_when_no_food_is_left(tmp_path: Path):
    from sim.runner import run_simulation as run
    from sim.world import layout_from_world

    layout = layout_from_world(make_world("silent"))
    layout["landings"] = [{"kind": "landing", "x": 6.0, "y": 0.0, "z": 0.12, "radius": 0.7}]
    layout["pose"] = {"x": -6.0, "y": 0.0, "z": 1.0, "yaw": 0.0, "pitch": 0.0}
    run(tmp_path / "pad", steps=500, scenario="custom", layout=layout)
    frames = read_trace(tmp_path / "pad")
    end = frames[-1]["pose"]
    assert hypot(end["x"] - 6.0, end["y"]) < 2.0
    assert end["z"] < 0.7
