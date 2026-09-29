#!/usr/bin/env python3
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from generator.hdl import generate_chip


def main() -> None:
    if not shutil.which("iverilog"):
        print("HDL verification unavailable: install iverilog or run scripts/install_hdl_tools_macos.sh")
        return
    generate_chip(ROOT / "rtl" / "generated", ROOT / "rtl" / "mem", ROOT / "tb")
    out = ROOT / "tb" / "robofly_core_tb.out"
    cmd = [
        "iverilog",
        "-g2012",
        "-o",
        str(out),
        str(ROOT / "rtl" / "generated" / "robofly_core.sv"),
        str(ROOT / "tb" / "robofly_core_tb.sv"),
    ]
    subprocess.run(cmd, check=True, cwd=ROOT)
    result = subprocess.run(["vvp", str(out)], check=True, cwd=ROOT, text=True, capture_output=True)
    print(result.stdout, end="")
    if "ERROR:" in result.stdout or "ERROR:" in result.stderr:
        raise SystemExit(result.stderr or result.stdout)


if __name__ == "__main__":
    main()
