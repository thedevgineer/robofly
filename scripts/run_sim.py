#!/usr/bin/env python3
from pathlib import Path
import argparse
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sim.runner import run_simulation


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=400)
    parser.add_argument("--scenario", choices=["food", "loom", "obstacle", "landing", "silent"], default="food")
    parser.add_argument("--seed", type=int, default=1701)
    parser.add_argument("--out", type=Path, default=ROOT / "runs" / "demo")
    args = parser.parse_args()
    out = args.out if args.out.is_absolute() else ROOT / args.out
    summary = run_simulation(out, steps=args.steps, scenario=args.scenario, seed=args.seed)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

