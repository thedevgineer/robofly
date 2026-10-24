from __future__ import annotations

from dataclasses import dataclass
from math import floor, pi, sin
from typing import Literal

import numpy as np

CellType = Literal["vision", "odor", "contact", "loom", "inter", "motor"]

CELL_TYPES: tuple[CellType, ...] = ("vision", "odor", "contact", "loom", "inter", "motor")
MOTOR_NAMES = (
    "thrust",
    "yaw_left",
    "yaw_right",
    "pitch_up",
    "land",
    "escape",
    "walk",
    "groom_fore",
    "groom_hind",
    "groom_wing",
    "feed",
    "rest",
)
MOTOR_GROUP = 2


def motor_span(name: str, n: int = 256) -> range:
    index = MOTOR_NAMES.index(name)
    start = n - len(MOTOR_NAMES) * MOTOR_GROUP + index * MOTOR_GROUP
    return range(start, start + MOTOR_GROUP)

# Sensor banks. Vision rays run from the fly's right (0) to its left (63).
ODOR_LEFT = range(64, 72)
ODOR_RIGHT = range(72, 80)
CONTACT = range(80, 88)
LOOM = range(88, 96)
VISION_RIGHT = range(0, 32)
VISION_LEFT = range(32, 64)

# Reduced giant-fiber chain in the interneuron range. One LPLC2 per loom channel.
LPLC2 = range(96, 104)
LC4 = 104
GIANT_FIBER = 105
PSI = 106
CHAIN_WEIGHT = 1.15
LOOM_BINS = 8


def loom_bin_center(channel: int) -> float:
    """Body-frame center of one loom bin. 0 is ahead and positive is left."""
    return -pi + (channel + 0.5) * (2 * pi / LOOM_BINS)


def loom_bin_index(bearing: float) -> int:
    """Bin containing a body-frame bearing in (-pi, pi]."""
    sector = (bearing + pi) / (2 * pi) * LOOM_BINS
    return int(floor(sector)) % LOOM_BINS


def loom_yaw_target(channel: int) -> tuple[str, float]:
    """Yaw pair that turns away from this bin, and that synapse's weight.

    Side and front bins use the full chain weight so one LPLC2 spike crosses
    threshold. The two rear bins use a fraction of |sin| of the bin center.
    That stays under the leak of a spike every refractory cycle, so a threat
    already behind does not spin the fly.
    """
    center = loom_bin_center(channel)
    group = "yaw_right" if sin(center) > 0 else "yaw_left"
    rear = abs(center) > 3 * pi / 4
    weight = CHAIN_WEIGHT * abs(sin(center)) * 0.4 if rear else CHAIN_WEIGHT
    return group, weight
CIRCUIT_IDS = {
    **{neuron: "lplc2" for neuron in LPLC2},
    LC4: "lc4",
    GIANT_FIBER: "gf",
    PSI: "psi",
}


@dataclass(frozen=True)
class Topology:
    n: int
    pre: np.ndarray
    post: np.ndarray
    weight: np.ndarray
    type_ids: np.ndarray
    coords: np.ndarray
    sensory: dict[str, np.ndarray]
    motors: dict[str, np.ndarray]

    @property
    def edge_count(self) -> int:
        return int(self.pre.size)

    @property
    def type_names(self) -> list[str]:
        return [CELL_TYPES[int(i)] for i in self.type_ids]


def build_default_topology(n: int = 256, seed: int = 1701) -> Topology:
    """Build a compact fly-inspired sparse graph for simulation and HDL generation."""
    if n < 96:
        raise ValueError("default topology needs at least 96 neurons")
    rng = np.random.default_rng(seed)
    type_ids = np.full(n, CELL_TYPES.index("inter"), dtype=np.int16)

    vision = np.arange(0, 64, dtype=np.int32)
    odor = np.arange(64, 80, dtype=np.int32)
    contact = np.arange(80, 88, dtype=np.int32)
    loom = np.arange(88, 96, dtype=np.int32)
    inter = np.arange(96, n - 24, dtype=np.int32)
    motor_all = np.arange(n - 24, n, dtype=np.int32)

    type_ids[vision] = CELL_TYPES.index("vision")
    type_ids[odor] = CELL_TYPES.index("odor")
    type_ids[contact] = CELL_TYPES.index("contact")
    type_ids[loom] = CELL_TYPES.index("loom")
    type_ids[inter] = CELL_TYPES.index("inter")
    type_ids[motor_all] = CELL_TYPES.index("motor")

    motor_groups = {
        name: motor_all[i * MOTOR_GROUP : (i + 1) * MOTOR_GROUP]
        for i, name in enumerate(MOTOR_NAMES)
    }
    sensory = {
        "vision": vision,
        "odor": odor,
        "contact": contact,
        "loom": loom,
    }

    pre: list[int] = []
    post: list[int] = []
    weight: list[float] = []

    def add(src: int, dst: int, w: float) -> None:
        if src != dst:
            pre.append(int(src))
            post.append(int(dst))
            weight.append(float(w))

    for channel, src in enumerate(LOOM):
        add(int(src), LPLC2.start + channel, CHAIN_WEIGHT)
        add(int(src), LC4, CHAIN_WEIGHT)
    for src in LPLC2:
        add(int(src), GIANT_FIBER, CHAIN_WEIGHT)
    add(LC4, GIANT_FIBER, CHAIN_WEIGHT)
    add(GIANT_FIBER, PSI, CHAIN_WEIGHT)
    for dst in motor_groups["escape"]:
        add(GIANT_FIBER, int(dst), CHAIN_WEIGHT)
    for dst in motor_groups["thrust"]:
        add(PSI, int(dst), CHAIN_WEIGHT)
    for channel, src in enumerate(LPLC2):
        group, yaw_weight = loom_yaw_target(channel)
        for dst in motor_groups[group]:
            add(int(src), int(dst), yaw_weight)

    for src in loom:
        for dst in motor_groups["escape"]:
            add(int(src), int(dst), 0.95)
        for dst in motor_groups["thrust"]:
            add(int(src), int(dst), 0.35)
    for src in odor:
        for dst in motor_groups["thrust"]:
            add(int(src), int(dst), 0.28)
    for src in contact:
        for dst in motor_groups["land"]:
            add(int(src), int(dst), 1.05)
    for src in ODOR_LEFT:
        for dst in motor_groups["yaw_left"]:
            add(int(src), int(dst), 1.05)
    for src in ODOR_RIGHT:
        for dst in motor_groups["yaw_right"]:
            add(int(src), int(dst), 1.05)
    for src in VISION_RIGHT:
        for dst in motor_groups["yaw_left"]:
            add(int(src), int(dst), 0.9)
    for src in VISION_LEFT:
        for dst in motor_groups["yaw_right"]:
            add(int(src), int(dst), 0.9)
    for src in odor:
        for dst in motor_groups["feed"]:
            add(int(src), int(dst), 0.10)
        for dst in motor_groups["walk"]:
            add(int(src), int(dst), 0.05)
    for src in contact:
        for dst in motor_groups["groom_fore"]:
            add(int(src), int(dst), 0.22)
    quiet = [int(src) for src in inter if int(src) not in CIRCUIT_IDS]
    for src in quiet[::8]:
        for dst in motor_groups["rest"]:
            add(int(src), int(dst), 0.22)
        for name in ("groom_fore", "groom_hind", "groom_wing"):
            add(int(src), int(motor_groups[name][0]), 0.14)
    for src in loom:
        for name in ("groom_fore", "groom_hind", "groom_wing", "rest", "feed", "walk"):
            for dst in motor_groups[name]:
                add(int(src), int(dst), -0.55)
    for src in odor:
        for name in ("groom_fore", "groom_hind", "groom_wing", "rest"):
            for dst in motor_groups[name]:
                add(int(src), int(dst), -0.35)

    coords = rng.normal(0.0, 0.45, size=(n, 3)).astype(np.float32)
    coords[vision, 0] -= 1.2
    coords[odor, 1] += 1.0
    coords[loom, 2] += 1.0
    coords[motor_all, 0] += 1.3

    return Topology(
        n=n,
        pre=np.asarray(pre, dtype=np.int32),
        post=np.asarray(post, dtype=np.int32),
        weight=np.asarray(weight, dtype=np.float32),
        type_ids=type_ids,
        coords=coords,
        sensory=sensory,
        motors=motor_groups,
    )


def graph_payload(seed: int = 1701) -> dict:
    """Neuron populations and synapses for the generated chip."""
    topology = build_default_topology(seed=seed)
    motor_of: dict[int, str] = {}
    for name, indexes in topology.motors.items():
        for index in indexes.tolist():
            motor_of[int(index)] = name
    neurons = [
        {
            "id": i,
            "type": CELL_TYPES[int(topology.type_ids[i])],
            "motor": motor_of.get(i),
            "circuit": CIRCUIT_IDS.get(i),
        }
        for i in range(topology.n)
    ]
    return {
        "seed": seed,
        "neurons": neurons,
        "synapses": {
            "pre": topology.pre.astype(int).tolist(),
            "post": topology.post.astype(int).tolist(),
            "weight": [round(float(value), 4) for value in topology.weight],
        },
    }

