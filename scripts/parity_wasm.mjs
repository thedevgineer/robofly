import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const wasmBytes = readFileSync(resolve(root, "viewer/public/robofly.wasm"));
const frames = JSON.parse(readFileSync(resolve(root, "wasm/fixtures/food40.json"), "utf8"));
const wasm = await WebAssembly.instantiate(wasmBytes, {});
const api = wasm.instance.exports;
const snapLen = 7144;
const motorCount = 12;

function readFrame() {
  const data = new DataView(api.memory.buffer, api.snapshot_ptr(), snapLen);
  const pose = {
    x: data.getFloat64(32, true),
    y: data.getFloat64(40, true),
    z: data.getFloat64(48, true),
    yaw: data.getFloat64(56, true),
    pitch: data.getFloat64(64, true),
    speed: data.getFloat64(72, true),
  };
  const names = ["thrust", "yaw_left", "yaw_right", "pitch_up", "land", "escape", "walk", "groom_fore", "groom_hind", "groom_wing", "feed", "rest"];
  const motor_rates = {};
  names.forEach((name, index) => {
    motor_rates[name] = data.getFloat32(112 + index * 4, true);
  });
  const spikeCount = data.getUint32(8, true);
  const cycles = data.getUint32(4, true);
  const spikes = [];
  for (let index = 0; index < spikeCount; index += 1) {
    spikes.push(data.getUint16(112 + motorCount * 4 + 8 + 256 * 4 * 5 + 512 + index * 2, true));
  }
  return { pose, spikes, motor_rates, cycles };
}

if (api.snapshot_len() !== snapLen) {
  throw new Error(`snapshot length ${api.snapshot_len()} != ${snapLen}`);
}
api.reset(0);
const mismatches = [];
for (let index = 0; index < frames.length; index += 1) {
  api.step();
  const got = readFrame();
  const want = frames[index];
  const poseKeys = ["x", "y", "z", "yaw", "pitch", "speed"];
  for (const key of poseKeys) {
    if (Math.abs(got.pose[key] - want.pose[key]) > 1e-5) {
      mismatches.push(`tick ${index} pose.${key} wasm=${got.pose[key]} python=${want.pose[key]}`);
    }
  }
  if (got.spikes.join(",") !== want.spikes.join(",")) {
    mismatches.push(`tick ${index} spikes wasm=${got.spikes.length} python=${want.spikes.length} wasm=[${got.spikes.slice(0, 12)}] python=[${want.spikes.slice(0, 12)}]`);
  }
  for (const name of Object.keys(want.motor_rates)) {
    if (Math.abs(got.motor_rates[name] - want.motor_rates[name]) > 1e-5) {
      mismatches.push(`tick ${index} motor ${name} wasm=${got.motor_rates[name]} python=${want.motor_rates[name]}`);
    }
  }
  if (got.cycles !== want.cycles) {
    mismatches.push(`tick ${index} cycles wasm=${got.cycles} python=${want.cycles}`);
  }
  if (mismatches.length > 12) break;
}

if (mismatches.length) {
  console.error(mismatches.join("\n"));
  process.exit(1);
}
console.log(`40 food ticks match (${frames[39].spikes.length} spikes on the last tick)`);
