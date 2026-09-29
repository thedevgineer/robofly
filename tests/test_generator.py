from pathlib import Path

from generator.hdl import generate_chip


def test_generator_is_deterministic(tmp_path: Path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    ma = generate_chip(a / "rtl", a / "mem", a / "tb")
    mb = generate_chip(b / "rtl", b / "mem", b / "tb")
    assert ma["neurons"] == mb["neurons"] == 256
    assert ma["synapses"] == mb["synapses"]
    assert (a / "mem" / "weight_q8_8.mem").read_text() == (b / "mem" / "weight_q8_8.mem").read_text()
    core = (a / "rtl" / "robofly_core.sv").read_text()
    assert "module decay_add" in core
    assert "module synapse_add" in core
    assert "u_decay" in core and "u_syn" in core

