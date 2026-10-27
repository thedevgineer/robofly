# 006 — Hold the clock LED still when motion is reduced

- **Status**: TODO
- **Commit**: 46df174
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, ~6 lines

## Problem

The clock mark replays a scale animation on every simulation step. `ChipView` sets `key={frame.step}` (around `viewer/src/ChipView.tsx:344` and `:504`), and the stylesheet runs a 100ms two-step scale. The sim step is 50ms, so this fires continuously while the playground plays. Neither reduced-motion block names it.

```css
/* viewer/src/styles.css:470 — current */
.clock-led {
  width: 10px;
  height: 18px;
  border-radius: 1px;
  background: #f0b429;
  box-shadow: 0 0 0 1px rgba(240, 180, 41, 0.35);
  transform-origin: center bottom;
  animation: clock-edge 100ms steps(2, end);
}

@keyframes clock-edge {
  from {
    transform: scaleY(0.2);
    opacity: 0.35;
  }
  to {
    transform: scaleY(1);
    opacity: 1;
  }
}
```

The pulse is the tick indicator when motion is allowed. Reduced motion should keep the amber mark and drop the scale.

## Target

```css
@media (prefers-reduced-motion: reduce) {
  .clock-led {
    animation: none;
    transform: none;
    opacity: 1;
  }
}
```

Leave `.clock-led` and `@keyframes clock-edge` unchanged for the default case.

## Repo conventions to follow

Add the rule to the existing block at `viewer/src/styles.css:2726`, next to `.hero-eyebrow i { animation: none; }`. That is the block that already stops a looping indicator. Do not add a new media query.

## Steps

1. Inside `@media (prefers-reduced-motion: reduce)` at `viewer/src/styles.css:2726`, add the `.clock-led` rule from Target.

## Boundaries

- Do NOT remove `key={frame.step}` or `@keyframes clock-edge`.
- Do NOT change the LED size or color.
- If a step doesn't match the code you find (drift since 46df174), STOP and report instead of improvising.

## Verification

- **Mechanical**: from `viewer/`, `npm run build` exits 0.
- **Feel check**: open the playground and let it play.
  - With motion allowed, the amber mark still pulses on ticks.
  - Rendering panel, `prefers-reduced-motion: reduce`: the mark stays lit and full height. It does not scale.
- **Done when**: the reduced-motion block sets `.clock-led` animation to `none`.
