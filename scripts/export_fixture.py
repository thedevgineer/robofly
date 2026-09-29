"""Write 40 food-scenario ticks for the wasm parity check."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sim.network import SpikingNetwork  # noqa: E402
from sim.topology import build_default_topology  # noqa: E402
from sim.world import advance_predator, apply_motors, encode_sensors, make_world, resolve_solids, try_eat  # noqa: E402


def main() -> None:
    topology = build_default_topology(seed=1701)
    network = SpikingNetwork(topology)
    world = make_world("food")
    frames = []
    for _ in range(40):
        advance_predator(world)
        drive = encode_sensors(world, topology.n)
        brain = network.step(drive)
        apply_motors(world, brain.motor_rates)
        resolve_solids(world)
        try_eat(world)
        frames.append(
            {
                "pose": asdict(world.pose),
                "spikes": brain.spikes,
                "motor_rates": brain.motor_rates,
                "cycles": brain.cycles,
            }
        )
    out = ROOT / "wasm" / "fixtures" / "food40.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(frames), encoding="utf-8")
    print(f"wrote {out} frames={len(frames)} spikes0={len(frames[0]['spikes'])}")


if __name__ == "__main__":
    main()
