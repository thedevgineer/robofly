"""Write the loom-scene motor trace used by the preprint chart."""

import json
import tempfile
from pathlib import Path

from sim.runner import run_simulation

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "figures"
STEPS = 80


def _rows(scenario: str) -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        run_simulation(Path(tmp), steps=STEPS, scenario=scenario, seed=1701)
        rows = ["step escape thrust yaw_left yaw_right pitch z"]
        for line in (Path(tmp) / "trace.jsonl").read_text(encoding="utf-8").splitlines():
            frame = json.loads(line)
            rates = frame["motor_rates"]
            pose = frame["pose"]
            rows.append(
                f"{frame['step']} {rates.get('escape', 0):.4f} {rates.get('thrust', 0):.4f} "
                f"{rates.get('yaw_left', 0):.4f} {rates.get('yaw_right', 0):.4f} "
                f"{pose['pitch']:.4f} {pose['z']:.4f}"
            )
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    loom = _rows("loom")
    (OUT / "escape.dat").write_text("\n".join(loom) + "\n", encoding="utf-8")
    yard = _rows("yard")
    (OUT / "pitch.dat").write_text("\n".join(yard) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
