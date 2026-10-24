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


def test_left_loom_turns_away():
    topology = build_default_topology()
    network = SpikingNetwork(topology)
    drive = np.zeros(topology.n, dtype=np.float32)
    drive[93] = 2.0
    yaw_right = 0.0
    yaw_left = 0.0
    for _ in range(8):
        snap = network.step(drive)
        yaw_right = max(yaw_right, snap.motor_rates["yaw_right"])
        yaw_left = max(yaw_left, snap.motor_rates["yaw_left"])
    assert yaw_right > yaw_left
    assert yaw_right >= 0.5


def test_rear_loom_does_not_yaw():
    topology = build_default_topology()
    network = SpikingNetwork(topology)
    drive = np.zeros(topology.n, dtype=np.float32)
    drive[88] = 2.0
    yaw = 0.0
    for _ in range(16):
        snap = network.step(drive)
        yaw = max(yaw, snap.motor_rates["yaw_left"], snap.motor_rates["yaw_right"])
    assert yaw == 0.0


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
