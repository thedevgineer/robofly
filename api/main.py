from __future__ import annotations

import json
import shutil
from pathlib import Path
from time import strftime

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from generator.hdl import generate_chip
from sim.runner import read_trace, run_simulation
from sim.topology import graph_payload
from sim.world import landmarks_from_world, layout_from_world, make_world, world_from_layout

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "runs"

app = FastAPI(title="RoboFly Backend", version="0.1.0")


class LayoutPoint(BaseModel):
    x: float
    y: float
    z: float = 1.0
    radius: float = 0.45


class LayoutBox(BaseModel):
    min_x: float
    max_x: float
    min_y: float
    max_y: float


class LayoutPose(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 1.0
    yaw: float = 0.0
    pitch: float = 0.0


class LayoutRoom(BaseModel):
    min_x: float
    max_x: float
    min_y: float
    max_y: float


class LayoutIn(BaseModel):
    room: LayoutRoom
    foods: list[LayoutPoint] = Field(default_factory=list)
    threats: list[LayoutPoint] = Field(default_factory=list)
    landings: list[LayoutPoint] = Field(default_factory=list)
    obstacles: list[LayoutBox] = Field(default_factory=list)
    pose: LayoutPose | None = None


class SimRunRequest(BaseModel):
    steps: int = Field(default=400, ge=1, le=20000)
    scenario: str = Field(default="food", pattern="^(food|loom|obstacle|landing|silent|custom)$")
    seed: int = 1701
    name: str | None = None
    layout: LayoutIn | None = None


class ChipGenerateRequest(BaseModel):
    seed: int = 1701


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "robofly-backend"}


@app.post("/api/sim/run")
def api_run_sim(request: SimRunRequest) -> dict:
    run_name = request.name or f"{strftime('%Y%m%d-%H%M%S')}-{request.scenario}"
    safe_name = "".join(ch for ch in run_name if ch.isalnum() or ch in ("-", "_"))[:80]
    layout = request.layout.model_dump() if request.layout is not None else None
    try:
        summary = run_simulation(
            RUNS / safe_name,
            steps=request.steps,
            scenario=request.scenario,
            seed=request.seed,
            layout=layout,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return summary


@app.get("/api/sim/runs")
def api_list_runs() -> dict:
    RUNS.mkdir(exist_ok=True)
    runs = []
    for path in sorted(RUNS.iterdir(), reverse=True):
        summary = path / "summary.json"
        if summary.is_file():
            runs.append(json.loads(summary.read_text(encoding="utf-8")) | {"id": path.name})
    return {"runs": runs}


@app.get("/api/sim/runs/{run_id}/trace")
def api_trace(run_id: str, limit: int | None = None) -> dict:
    run_dir = RUNS / run_id
    if not (run_dir / "trace.jsonl").is_file():
        raise HTTPException(status_code=404, detail="run trace not found")
    summary_path = run_dir / "summary.json"
    summary: dict = {}
    if summary_path.is_file():
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    scenario = summary.get("scenario", "food")
    layout = summary.get("layout")
    if layout is None:
        layout = layout_from_world(make_world(scenario))
    try:
        marks = landmarks_from_world(world_from_layout(layout))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": run_id,
        "scenario": scenario,
        "topology": summary.get("topology"),
        "landmarks": marks,
        "layout": layout,
        "frames": read_trace(run_dir, limit=limit),
    }


@app.post("/api/chip/generate")
def api_generate_chip(request: ChipGenerateRequest) -> dict:
    return generate_chip(ROOT / "rtl" / "generated", ROOT / "rtl" / "mem", ROOT / "tb", seed=request.seed)


@app.post("/api/chip/verify")
def api_verify_chip() -> dict:
    iverilog = shutil.which("iverilog")
    if not iverilog:
        return {"available": False, "tool": "iverilog", "message": "HDL tools are not installed"}
    return {"available": True, "tool": iverilog, "message": "Run scripts/verify_hdl.py for full verification"}


@app.get("/api/chip/graph")
def api_chip_graph(seed: int = 1701) -> dict:
    return graph_payload(seed)


@app.get("/api/chip/status")
def api_chip_status() -> dict:
    manifest = ROOT / "rtl" / "generated" / "manifest.json"
    tools = {name: shutil.which(name) for name in ("iverilog", "verilator", "yosys", "gtkwave")}
    return {
        "generated": manifest.is_file(),
        "manifest": json.loads(manifest.read_text(encoding="utf-8")) if manifest.is_file() else None,
        "tools": tools,
    }

