# Biology vs Scaffolding

This project is a hardware-oriented robofly control experiment.

## Fly-Inspired

- Sparse recurrent graph
- Sensory populations for vision, odor, contact, and looming
- Motor populations for thrust, yaw, pitch, landing, and escape
- Leaky spiking dynamics and event-style activity traces
- The escape path is a reduced giant-fiber chain: each loom channel is one body-frame azimuth bin and drives one LPLC2, the loom population also drives one LC4, both drive the giant fiber, the giant fiber drives the escape pair (stand-in for the jump motor neuron) and a PSI, and the PSI drives the thrust pair (stand-in for the wing-depressor motor neuron). Each LPLC2 also drives the yaw pair that turns away from its bin. The two rear bins are weaker, so a threat already behind does not spin the fly
- The chip stays at 256 neurons. Directional escape uses the existing loom bins and the yaw pairs; it does not add cells

## Engineering Scaffolding

- The 256-neuron topology is synthetic outside that escape chain.
- Feed, groom, walk, land, and rest stay on direct sensor-to-motor wires. Cruise yaw stays on direct vision and odor wires. A threat below the fly drives the pitch-up pair directly.
- The chip decides escape and the turn. While a threat is in the room the body keeps a cruise, and it sheds only the speed aimed into a wall. If that leaves the fly nearly stopped, a short clearance adds a small cruise along the open heading. Quiet rooms, food search, landing, and groom or rest still follow the motor rates. Altitude is a damped hold: a threat below raises the target, and the body keeps that height.
- Sensor encoding is hand-built from a simulated world.
- Motor decoding maps population spike rates to robofly controls.
- Generated HDL is a first verification target, not a biological claim.

## Not Claimed

- This is not a conscious fly.
- This is not a complete Drosophila brain. FlyWire (Dorkenwald et al., Nature 2024) is 139,255 neurons and 54.5 million chemical synapses. The live tick scans every synapse, and that graph is about 0.3–1.5 seconds per step on one core, plus about 650 MB of edges. The viewer steps every 50 ms, so the whole brain is not an input to this circuit.
- This is not ready for physical robot control without a conventional safety controller.
