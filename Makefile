.PHONY: generate sim test api hdl-test viewer clean

PY ?= .venv/bin/python

generate:
	$(PY) scripts/generate_chip.py

sim:
	$(PY) scripts/run_sim.py --steps 400 --scenario food --out runs/demo

test:
	$(PY) -m pytest

api:
	.venv/bin/uvicorn api.main:app --reload --port 3205

viewer:
	cd viewer && npm run dev

hdl-test:
	$(PY) scripts/verify_hdl.py

clean:
	rm -rf runs/demo .pytest_cache

