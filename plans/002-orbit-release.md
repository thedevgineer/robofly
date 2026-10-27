# 002 — Hand orbit release speed to a spring

- **Status**: TODO
- **Commit**: 46df174
- **Severity**: HIGH
- **Category**: Interruptibility
- **Estimated scope**: 2 files, ~120 lines

## Problem

Dragging the yard or the die tracks the pointer. Releasing it stops the view in that frame. Tilt also hits a hard clamp, so the pointer keeps moving while the view sticks.

Yard release, `viewer/src/WorldView.tsx:279`:

```ts
const onUp = () => {
  armed.current = false;
  drag.current = false;
};
```

During the drag, tilt is clamped with no give, `viewer/src/WorldView.tsx:277`:

```ts
orbit.current.phi = THREE.MathUtils.clamp(orbit.current.phi + event.movementY * 0.004, 0.25, 1.45);
```

Die release, `viewer/src/ChipScene.tsx:385`:

```ts
function onUp() {
  down = false;
  dragging.current = false;
}
```

The follow camera already integrates a spring from the live value and its velocity. That spring is critically damped (`zeta = 1`) and must stay that way. Orbit release is a flick, so it needs a little bounce and it must start at the finger's velocity.

```ts
/* viewer/src/WorldView.tsx:235 — current, do not change the follow-camera call */
function springToward(pos: THREE.Vector3, vel: THREE.Vector3, goal: THREE.Vector3, omega: number, dt: number) {
  const ax = omega * omega * (goal.x - pos.x) - 2 * omega * vel.x;
  const ay = omega * omega * (goal.y - pos.y) - 2 * omega * vel.y;
  const az = omega * omega * (goal.z - pos.z) - 2 * omega * vel.z;
  vel.set(vel.x + ax * dt, vel.y + ay * dt, vel.z + az * dt);
  pos.set(pos.x + vel.x * dt, pos.y + vel.y * dt, pos.z + vel.z * dt);
}
```

`ChaseCamera` calls `springToward(..., 6, dt)` at `viewer/src/WorldView.tsx:222`. Leave that call on omega `6`.

## Target

Use `motion`. Install `motion` in `viewer/`. Drive the release with `animate` from `motion`:

```ts
import { animate } from "motion";

animate(phi, phiTarget, {
  type: "spring",
  duration: 0.5,
  bounce: 0.2,
  velocity: phiVelocity,
  onUpdate: (latest) => {
    orbit.current.phi = latest;
  },
});
```

Do not add a hand-rolled scalar spring. The follow camera already has one and it stays. Map of the flick spring, for reference only: `bounce: 0.2` is damping ratio `0.8`. Pass `bounce: 0.2` and `duration: 0.5` to `animate`. Do not reimplement that mapping.

On the next pointer down, `stop()` the running `animate` and read theta and phi from the values already on screen.

Release projection, applied to radians per second:

```ts
function project(initialVelocity: number, decelerationRate = 0.998): number {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}
```

Past a tilt limit, resist instead of clamping. `dimension` is the span of the allowed tilt, `1.45 - 0.25` = `1.2`.

```ts
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
```

Yard tilt limits stay `0.25` and `1.45`. Die tilt limits stay `0.28` and `1.48` (`viewer/src/ChipScene.tsx:379`). While the pointer is down, write theta and phi from the pointer, including rubber-band past those limits. On pointer up, set each target to `current + project(releaseVelocity)` and pass that release velocity to `animate`. A new pointer down calls `stop()` on the running animation and tracks 1:1 from the value already on screen. Do not finish the spring first.

Theta gain stays `0.005` rad per pixel (`viewer/src/WorldView.tsx:276`). Phi gain stays `0.004` rad per pixel. Release velocity in rad/s is `(pixelDelta / dtSeconds) * gain`, with the same signs as the drag.

## Repo conventions to follow

The follow camera stays in `useFrame` (`viewer/src/WorldView.tsx:205`). Orbit release does not. `animate` from `motion` owns that tween and writes back through `onUpdate`. Do not add a CSS transition.

The drag already waits 4px before it counts (`viewer/src/WorldView.tsx:273`, `viewer/src/ChipScene.tsx:354`). Keep that threshold.

## Steps

1. In `viewer/`, install `motion`. Do not change `springToward` or the `ChaseCamera` call `springToward(..., 6, dt)`.
2. In `OrbitInput`, keep the last pointer sample (`clientX`, `clientY`, `performance.now()`). On pointer up, if a drag happened, compute theta and phi velocity from that sample and the previous one.
3. While dragging, if phi would pass `0.25` or `1.45`, add `rubberband(overshoot, 1.2)` instead of `THREE.MathUtils.clamp`.
4. On pointer up, `animate` theta to `theta + project(thetaVelocity)` and phi to the clamped rest, with `type: "spring"`, `duration: 0.5`, `bounce: 0.2`, and `velocity` set to the release velocity. Write the latest value onto `orbit.current` in `onUpdate`.
5. Repeat steps 2–4 for the die in `viewer/src/ChipScene.tsx` `OrbitView`. Phi limits are `0.28` and `1.48`. The compact die keeps its tighter phi clamp (`0.92` to `1.14` at `viewer/src/ChipScene.tsx:374`). Rubber-band against that tighter span when `compact` is true.
6. On the next pointer down, `stop()` the running animation and take theta and phi from the values already on screen.

## Boundaries

- Do NOT change `ChaseCamera` follow smoothing. It stays `springToward(..., 6, dt)` and critically damped.
- Do NOT change wheel zoom or the radius clamps (`1.4..24` in the yard, `FULL_RADIUS_MIN..FULL_RADIUS_MAX` on the die).
- Do NOT change shift-drag pan clamps in `viewer/src/ChipScene.tsx:368`.
- Do NOT change `snapTo` or `frameDie`. Face snaps stay instant in this plan.
- Do NOT add a second animation library. `motion` is the one dependency this plan adds.
- Do NOT replace `springToward` or the `ChaseCamera` call.
- If a step doesn't match the code you find (drift since 46df174), STOP and report instead of improvising.

## Verification

- **Mechanical**: from `viewer/`, `npm run build` exits 0.
- **Feel check**: in the playground, flick the yard with the right mouse button, then flick the die.
  - The view keeps moving after release, then settles. It does not stop dead.
  - Drag past the steepest tilt. The view resists and comes back. It does not stick while the pointer continues.
  - Grab the view while it is still coasting. It follows the pointer from the frame it is on. It does not jump to the old target.
  - Switch the camera to Follow while the fly moves. That camera still eases without a bounce. Orbit release may overshoot slightly. Follow must not.
  - After release, the view is still moving on the next frame. A grab during that move follows the pointer from the current angle.
- **Done when**: pointer up on a moving orbit leaves a non-zero theta or phi velocity, and the follow camera call is still `springToward(..., 6, dt)`.
