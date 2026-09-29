from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .topology import Topology


@dataclass
class NetworkSnapshot:
    voltage: list[float]
    spikes: list[int]
    motor_rates: dict[str, float]
    population_rates: dict[str, float]
    cycles: int


class SpikingNetwork:
    """Small deterministic fixed-step LIF-like network."""

    def __init__(self, topology: Topology, dt_ms: float = 1.0) -> None:
        self.topology = topology
        self.dt_ms = float(dt_ms)
        self.v = np.zeros(topology.n, dtype=np.float32)
        self.refractory = np.zeros(topology.n, dtype=np.int16)
        self.last_spikes = np.zeros(topology.n, dtype=np.int8)
        self.cycles = 0
        self.decay = np.float32(0.92)
        self.threshold = np.float32(1.0)
        self.reset = np.float32(0.0)
        self.refractory_ticks = np.int16(2)

    def reset_state(self) -> None:
        self.v.fill(0)
        self.refractory.fill(0)
        self.last_spikes.fill(0)
        self.cycles = 0

    def step(self, drive: np.ndarray) -> NetworkSnapshot:
        if drive.shape != (self.topology.n,):
            raise ValueError(f"drive must have shape {(self.topology.n,)}")
        t = self.topology
        acc = np.array(drive, dtype=np.float32, copy=True)
        if t.pre.size:
            np.add.at(acc, t.post, self.last_spikes[t.pre].astype(np.float32) * t.weight)
        active = self.refractory <= 0
        self.v[active] = self.v[active] * self.decay + acc[active]
        self.v[~active] = self.reset
        spikes = (self.v >= self.threshold) & active
        self.last_spikes = spikes.astype(np.int8)
        self.v[spikes] = self.reset
        self.refractory = np.maximum(self.refractory - 1, 0)
        self.refractory[spikes] = self.refractory_ticks
        self.cycles += int(t.n + t.edge_count + np.count_nonzero(drive))
        return self.snapshot()

    def snapshot(self) -> NetworkSnapshot:
        motor_rates = {
            name: float(np.mean(self.last_spikes[indexes])) if len(indexes) else 0.0
            for name, indexes in self.topology.motors.items()
        }
        population_rates = {}
        for name, indexes in self.topology.sensory.items():
            population_rates[name] = float(np.mean(self.last_spikes[indexes])) if len(indexes) else 0.0
        population_rates["inter"] = float(np.mean(self.last_spikes[self.topology.type_ids == 4]))
        population_rates["motor"] = float(np.mean(self.last_spikes[self.topology.type_ids == 5]))
        return NetworkSnapshot(
            voltage=np.round(self.v, 4).astype(float).tolist(),
            spikes=np.flatnonzero(self.last_spikes).astype(int).tolist(),
            motor_rates=motor_rates,
            population_rates=population_rates,
            cycles=self.cycles,
        )

