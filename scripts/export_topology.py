"""Write the seed-1701 topology into the wasm crate as a little-endian blob."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sim.topology import build_default_topology  # noqa: E402

MAGIC = b"RFLY"
VERSION = 1


def main() -> None:
    topology = build_default_topology(seed=1701)
    motor = [-1] * topology.n
    for index, indexes in enumerate(topology.motors.values()):
        for neuron in indexes.tolist():
            motor[int(neuron)] = index
    blob = bytearray()
    blob += MAGIC
    blob += struct.pack("<III", VERSION, topology.n, topology.edge_count)
    blob += topology.pre.astype("<i4").tobytes()
    blob += topology.post.astype("<i4").tobytes()
    blob += topology.weight.astype("<f4").tobytes()
    blob += struct.pack("<" + "h" * topology.n, *motor)
    out = ROOT / "wasm" / "topology.bin"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(blob)
    print(f"wrote {out} neurons={topology.n} synapses={topology.edge_count} bytes={len(blob)}")


if __name__ == "__main__":
    main()
