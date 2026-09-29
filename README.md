# RoboFly Backend

Generated fly-brain-inspired processor backend for a simulated robofly.

This project is independent from Flyrunner. It provides:

- a deterministic robofly simulator
- a 256-neuron sparse spiking network
- SystemVerilog generation and memory-image export
- golden-trace verification
- a FastAPI backend and a trace viewer

## Quick Start

```bash
cd /Users/smoody/Documents/sol/robofly-backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/generate_chip.py
.venv/bin/python scripts/run_sim.py --steps 400 --scenario food --out runs/demo
.venv/bin/python scripts/verify_trace.py runs/demo
.venv/bin/pytest
.venv/bin/uvicorn api.main:app --reload --port 3205
```

Open API docs at `http://127.0.0.1:3205/docs`.

## Viewer

The viewer plays a simulation trace: a Three.js world on the left, and the 256-neuron chip clock on the right.

```bash
cd /Users/smoody/Documents/sol/robofly-backend
make api
make viewer
```

Open `http://127.0.0.1:3206`. The dev server proxies `/api` to the backend on port 3205.

## Optional HDL Tools

The backend works without HDL tools. To install local macOS HDL verification tools:

```bash
bash scripts/install_hdl_tools_macos.sh
make hdl-test
```

If tools are missing, chip verification returns `available: false` instead of failing the backend.

