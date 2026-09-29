# Architecture

RoboFly Backend has one source of truth for the first processor: the synthetic 256-neuron topology in `sim/topology.py`.

The backend uses that topology in three paths:

1. `sim/runner.py` runs a deterministic software simulation and writes JSONL traces.
2. `generator/hdl.py` emits SystemVerilog and memory images from the same topology.
3. `api/main.py` exposes simulation, trace, chip generation, and chip status endpoints.

## Data Flow

```
world state -> sensor encoder -> sparse spiking network -> motor decoder -> world state
                                   |
                                   +-> trace.jsonl
                                   +-> generated HDL / memory images
```

## v1 Limits

- The default topology is fly-inspired, not a biological connectome import.
- The HDL core is a generated prototype for verification, not an optimized FPGA design.
- The simulator is deterministic and intentionally small so golden traces are stable.

