# Biology vs Scaffolding

This project is a hardware-oriented robofly control experiment.

## Fly-Inspired

- Sparse recurrent graph
- Sensory populations for vision, odor, contact, and looming
- Motor populations for thrust, yaw, pitch, landing, and escape
- Leaky spiking dynamics and event-style activity traces
- The escape path is a reduced giant-fiber chain: each loom channel drives one LPLC2, the loom population also drives one LC4, both drive the giant fiber, the giant fiber drives the escape pair (stand-in for the jump motor neuron) and a PSI, and the PSI drives the thrust pair (stand-in for the wing-depressor motor neuron)

## Engineering Scaffolding

- The 256-neuron topology is synthetic outside that escape chain.
- Feed, groom, walk, land, yaw, and rest stay on direct sensor-to-motor wires.
- Sensor encoding is hand-built from a simulated world.
- Motor decoding maps population spike rates to robofly controls.
- Generated HDL is a first verification target, not a biological claim.

## Not Claimed

- This is not a conscious fly.
- This is not a complete Drosophila brain. FlyWire (Dorkenwald et al., Nature 2024) is 139,255 neurons and 54.5 million chemical synapses. The live tick scans every synapse, and that graph is about 0.3–1.5 seconds per step on one core, plus about 650 MB of edges. The viewer steps every 50 ms, so the whole brain is not an input to this circuit.
- This is not ready for physical robot control without a conventional safety controller.
