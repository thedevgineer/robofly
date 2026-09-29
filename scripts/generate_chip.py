#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from generator.hdl import generate_chip


if __name__ == "__main__":
    manifest = generate_chip(ROOT / "rtl" / "generated", ROOT / "rtl" / "mem", ROOT / "tb")
    print(f"generated {manifest['neurons']} neurons / {manifest['synapses']} synapses")

