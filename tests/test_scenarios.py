from math import hypot
from pathlib import Path

from sim.runner import read_trace, run_simulation
from sim.world import (
    CEILING_Z,
    FLOOR_Z,
    advance_predator,
    apply_motors,
    landmarks,
    make_world,
    pose_blocked,
    resolve_solids,
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
    assert sum(frame["command"]["escape"] for frame in fleeing) / len(fleeing) > 0.9


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


def test_silent_room_stays_quiet(tmp_path: Path):
    frames, _marks = _run(tmp_path, "silent", 60)
    flight = ("thrust", "yaw_left", "yaw_right", "pitch_up", "land", "escape")
    assert all(frame["motor_rates"][name] == 0.0 for frame in frames for name in flight)
    assert any(frame["motor_rates"]["rest"] > 0 or frame["motor_rates"]["groom_fore"] > 0 for frame in frames)
    end = frames[-1]["pose"]
    assert hypot(end["x"], end["y"]) < 0.05
    assert end["z"] < 0.2
