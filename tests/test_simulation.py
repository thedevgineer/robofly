from pathlib import Path

import pytest

from sim.runner import read_trace, run_simulation
from sim.world import landmarks, layout_from_world, make_world, world_from_layout


def test_simulation_writes_trace(tmp_path: Path):
    summary = run_simulation(tmp_path / "run", steps=20, scenario="food")
    assert summary["topology"]["neurons"] == 256
    frames = read_trace(tmp_path / "run")
    assert len(frames) == 20
    assert frames[-1]["cycles"] > frames[0]["cycles"]


def test_landmarks_match_scenario():
    food = landmarks("food")
    loom = landmarks("loom")
    assert food["room"]["max_x"] > food["room"]["min_x"]
    assert food["food"]["kind"] == "food"
    assert len(food["obstacles"]) == 17
    assert loom["threat"]["kind"] == "threat"
    assert landmarks("obstacle")["obstacles"][0]["kind"] == "barrier"
    assert landmarks("silent")["food"] is None
    assert landmarks("silent")["obstacles"] == []


def test_layout_roundtrip_keeps_two_foods_until_one_is_eaten(tmp_path: Path):
    layout = layout_from_world(make_world("food"))
    layout["foods"].append({"kind": "food", "x": 8.5, "y": 1.5, "z": 1.0, "radius": 0.45})
    summary = run_simulation(tmp_path / "custom", steps=400, scenario="custom", layout=layout)
    assert len(summary["layout"]["foods"]) == 2
    frames = read_trace(tmp_path / "custom")
    assert frames[0]["driven"]
    assert len(frames[0]["foods"]) == 2
    assert any(len(frame["foods"]) == 1 for frame in frames)


def test_layout_rejects_objects_outside_the_room_and_over_the_cap():
    layout = layout_from_world(make_world("silent"))
    layout["foods"] = [{"kind": "food", "x": 30.0, "y": 0.0, "z": 1.0, "radius": 0.45}]
    with pytest.raises(ValueError, match="outside"):
        world_from_layout(layout)
    layout = layout_from_world(make_world("silent"))
    layout["obstacles"] = [
        {"min_x": -1, "max_x": -0.4, "min_y": -1, "max_y": -0.4} for _ in range(65)
    ]
    with pytest.raises(ValueError, match="limits"):
        world_from_layout(layout)


def test_close_enemy_drives_escape(tmp_path: Path):
    layout = layout_from_world(make_world("silent"))
    layout["threats"] = [{"kind": "threat", "x": -1.6, "y": 0.2, "z": 1.0, "radius": 0.45}]
    run_simulation(tmp_path / "enemy", steps=30, scenario="custom", layout=layout)
    frames = read_trace(tmp_path / "enemy")
    assert any(frame["motor_rates"]["escape"] >= 0.5 for frame in frames)
    assert all(frame["predator"] is not None for frame in frames)


def test_landing_scenario_has_commands(tmp_path: Path):
    run_simulation(tmp_path / "landing", steps=40, scenario="landing")
    frames = read_trace(tmp_path / "landing")
    assert all("land" in frame["command"] for frame in frames)

