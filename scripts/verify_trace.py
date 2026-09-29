#!/usr/bin/env python3
from pathlib import Path
import argparse
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir", type=Path)
    args = parser.parse_args()
    run_dir = args.run_dir if args.run_dir.is_absolute() else ROOT / args.run_dir
    trace = run_dir / "trace.jsonl"
    if not trace.is_file():
        raise SystemExit(f"missing trace: {trace}")
    frames = [json.loads(line) for line in trace.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not frames:
        raise SystemExit("trace is empty")
    if any("pose" not in frame or "motor_rates" not in frame for frame in frames):
        raise SystemExit("trace missing required fields")
    if frames[-1]["cycles"] <= frames[0]["cycles"]:
        raise SystemExit("cycle count did not advance")
    print(f"ok trace frames={len(frames)} final_cycles={frames[-1]['cycles']}")


if __name__ == "__main__":
    main()

