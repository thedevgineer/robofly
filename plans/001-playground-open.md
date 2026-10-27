# 001 — Stop the playground from animating height

- **Status**: TODO
- **Commit**: 46df174
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file, ~15 lines

## Problem

Opening `/playground` animates layout. The tool bar grows by `max-height` and `padding` for 420ms. The stage changes `height` for 460ms. Both use the weak `ease` keyword, so the move starts late. Neither rule is inside a `prefers-reduced-motion` block. The only reduced-motion blocks in this file are at `viewer/src/styles.css:2726` and `viewer/src/styles.css:3329`, and they name `.reveal`, `.hero-eyebrow`, `.tab-progress`, and `.hero-desc` only.

```css
/* viewer/src/styles.css:1178 — current */
.flight-bar {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  padding-top: 0;
  padding-bottom: 0;
  pointer-events: none;
  transition: max-height 420ms ease, opacity 280ms ease, padding 420ms ease;
}

/* viewer/src/styles.css:1209 — current */
.flight-stage {
  position: relative;
  height: min(52vh, 520px);
  min-height: 340px;
  background: #d5e8f6;
  transition: height 460ms ease;
}
```

`height`, `max-height`, and `padding` are layout properties. This open happens on every visit to the playground.

## Target

The bar and the stage take their final height on the first frame. Only opacity fades. Entrance easing is the strong ease-out. Reduced motion keeps a short opacity fade and drops movement.

```css
/* viewer/src/styles.css :root — add if absent */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);

/* target */
.flight-bar {
  transition: opacity 200ms var(--ease-out);
}

.flight-stage {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .flight-bar {
    transition: opacity 200ms ease;
  }
}
```

Leave the `max-height`, `padding`, and `height` values themselves as they are. They still switch with `.flight.expanded`. They must not transition.

## Repo conventions to follow

Custom properties already live on `:root` in `viewer/src/styles.css` (`--panel`, `--ink`, `--amber`). Add `--ease-out` there. Do not create a second stylesheet.

The pressable control transition at `viewer/src/styles.css:62` is the existing UI duration: `160ms` and `200ms` are the short end of this file. 200ms matches the nav underline at `viewer/src/styles.css:2167`.

## Steps

1. In `viewer/src/styles.css` `:root`, add `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` if that property is not already there.
2. Replace the `.flight-bar` transition with `transition: opacity 200ms var(--ease-out);`. Do not transition `max-height` or `padding`.
3. Delete `transition: height 460ms ease;` from `.flight-stage`.
4. Inside the existing `@media (prefers-reduced-motion: reduce)` block at `viewer/src/styles.css:2726`, add `.flight-bar { transition: opacity 200ms ease; }`.

## Boundaries

- Do NOT change when `.flight.expanded` is applied. That is `viewer/src/main.tsx` and `viewer/src/Home.tsx`.
- Do NOT change the expanded or collapsed height values, including the later overrides at `viewer/src/styles.css:2780` and `viewer/src/styles.css:3288`.
- Do NOT touch `.flight-chip` / `chip-from-seam`. That class is unused.
- Do NOT add a dependency. This open is a predetermined state change, so it stays CSS.
- If a step doesn't match the code you find (drift since 46df174), STOP and report instead of improvising.

## Verification

- **Mechanical**: from `viewer/`, `npm run build` exits 0.
- **Feel check**: load `/`, then open the playground.
  - The stage height is final on the first frame. It does not grow.
  - The tool bar fades in. Its height does not animate.
  - In DevTools Animations, set playback to 10%. Confirm no height or max-height animation.
  - Rendering panel, `prefers-reduced-motion: reduce`. The bar still fades in over about 200ms. Nothing travels.
- **Done when**: `.flight-bar` transitions only `opacity`, and `.flight-stage` has no transition.
