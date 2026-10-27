import { animate, type AnimationPlaybackControls } from "motion";

export function project(initialVelocity: number, decelerationRate = 0.998) {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}

export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function resist(value: number, min: number, max: number) {
  if (value < min) return min - rubberband(min - value, max - min);
  if (value > max) return max + rubberband(value - max, max - min);
  return value;
}

export function releaseSpring(
  from: number,
  velocity: number,
  min: number | null,
  max: number | null,
  write: (value: number) => void,
) {
  const raw = from + project(velocity);
  const target = min == null || max == null ? raw : Math.min(max, Math.max(min, raw));
  return animate(from, target, {
    type: "spring",
    duration: 0.5,
    bounce: 0.2,
    velocity,
    onUpdate: write,
  });
}

export function stopAll(controls: AnimationPlaybackControls[]) {
  controls.forEach((control) => control.stop());
}
