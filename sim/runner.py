from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from time import time

from .network import SpikingNetwork
from .topology import MOTOR_NAMES, build_default_topology
from .world import (
    advance_predator,
    apply_motors,
    encode_sensors,
    frame_actors,
    layout_from_world,
    make_world,
    resolve_solids,
    try_catch,
    try_eat,
    world_from_layout,
)


def run_simulation(
    out_dir: Path,
    steps: int = 400,
    scenario: str = "food",
    seed: int = 1701,
    layout: dict | None = None,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    topology = build_default_topology(seed=seed)
    network = SpikingNetwork(topology)
    world = world_from_layout(layout) if layout is not None else make_world(scenario)
    trace_path = out_dir / "trace.jsonl"

    summary = {
        "scenario": scenario,
        "steps": int(steps),
        "seed": int(seed),
        "layout": layout_from_world(world),
        "topology": {"neurons": topology.n, "synapses": topology.edge_count},
        "created_at": int(time()),
    }
    with trace_path.open("w", encoding="utf-8") as fh:
        for step in range(int(steps)):
            if world.downed:
                frame = {
                    "step": step,
                    "pose": asdict(world.pose),
                    "command": {"thrust": 0.0, "yaw": 0.0, "pitch": 0.0, "land": False, "escape": False},
                    "spikes": [],
                    "motor_rates": {name: 0.0 for name in MOTOR_NAMES},
                    "population_rates": {},
                    "cycles": 0,
                    "drive_nonzero": 0,
                    "driven": [],
                    "voltage_sample": [0.0] * 32,
                    **frame_actors(world),
                }
                fh.write(json.dumps(frame, separators=(",", ":")) + "\n")
                continue
            advance_predator(world)
            drive = encode_sensors(world, topology.n)
            brain = network.step(drive)
            driven = [int(index) for index in range(topology.n) if drive[index] != 0]
            command = apply_motors(world, brain.motor_rates)
            resolve_solids(world)
            try_eat(world)
            try_catch(world)
            frame = {
                "step": step,
                "pose": asdict(world.pose),
                "command": command,
                "spikes": brain.spikes,
                "motor_rates": brain.motor_rates,
                "population_rates": brain.population_rates,
                "cycles": brain.cycles,
                "drive_nonzero": int((drive != 0).sum()),
                "driven": driven,
                "voltage_sample": brain.voltage[:32],
                **frame_actors(world),
            }
            fh.write(json.dumps(frame, separators=(",", ":")) + "\n")
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return {**summary, "run_dir": str(out_dir), "trace": str(trace_path)}


def read_trace(run_dir: Path, limit: int | None = None) -> list[dict]:
    trace = run_dir / "trace.jsonl"
    frames = []
    with trace.open("r", encoding="utf-8") as fh:
        for index, line in enumerate(fh):
            if limit is not None and index >= limit:
                break
            frames.append(json.loads(line))
    return frames

