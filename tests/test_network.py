import numpy as np

from sim.network import SpikingNetwork
from sim.topology import build_default_topology, graph_payload


def test_no_input_stays_quiet():
    topology = build_default_topology()
    network = SpikingNetwork(topology)
    snap = network.step(np.zeros(topology.n, dtype=np.float32))
    assert snap.spikes == []
    assert sum(snap.motor_rates.values()) == 0.0


def test_graph_matches_topology():
    topology = build_default_topology()
    graph = graph_payload()
    assert len(graph["neurons"]) == topology.n == 256
    assert len(graph["synapses"]["pre"]) == topology.edge_count
    assert graph["neurons"][242]["motor"] == "escape"
    assert graph["neurons"][254]["motor"] == "rest"


def test_looming_drives_escape_motor():
    topology = build_default_topology()
    network = SpikingNetwork(topology)
    drive = np.zeros(topology.n, dtype=np.float32)
    drive[88:96] = 2.0
    rates = []
    seen: set[int] = set()
    for _ in range(6):
        snap = network.step(drive)
        rates.append(snap.motor_rates["escape"])
        seen.update(snap.spikes)
    assert max(rates) > 0.0
    assert {96, 104, 105, 106} <= seen
