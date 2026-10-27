# 004 — Ease section reveals out

- **Status**: TODO
- **Commit**: 46df174
- **Severity**: MEDIUM
- **Category**: Easing
- **Estimated scope**: 1 file, ~4 lines

## Problem

Home sections enter with the weak `ease` keyword. An entrance should start fast. `ease` holds back the first frames, which is the moment the section arrives.

```css
/* viewer/src/styles.css:2715 — current */
.reveal {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 600ms ease, transform 600ms ease;
}
```

600ms is acceptable. This is a marketing entrance, and the duration budget above 300ms is allowed there. Reduced motion already shows the section with no travel (`viewer/src/styles.css:2726`).

## Target

Same distance, same duration, strong ease-out.

```css
/* :root — add if absent */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);

.reveal {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 600ms var(--ease-out), transform 600ms var(--ease-out);
}
```

Leave the reduced-motion block as it is:

```css
@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

## Repo conventions to follow

`:root` in `viewer/src/styles.css` is where `--ink` and `--amber` live. Add `--ease-out` beside them. `.reveal.in` at `viewer/src/styles.css:2721` is the state that finishes the transition. Do not change that rule.

## Steps

1. Add `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` to `:root` if it is absent.
2. Change the `.reveal` transition from `600ms ease` to `600ms var(--ease-out)` on both `opacity` and `transform`.

## Boundaries

- Do NOT change the 18px offset or the 600ms duration.
- Do NOT change the reduced-motion rule for `.reveal`.
- Do NOT change `Reveal` in `viewer/src/Home.tsx`.
- If a step doesn't match the code you find (drift since 46df174), STOP and report instead of improvising.

## Verification

- **Mechanical**: from `viewer/`, `npm run build` exits 0.
- **Feel check**: load `/` and scroll to a section below the fold.
  - The section moves immediately. The first frames are the fastest.
  - At 10% playback, it still starts fast and settles. It does not creep at the start.
  - `prefers-reduced-motion: reduce`: the section is already in place. It does not rise.
- **Done when**: `.reveal` uses `var(--ease-out)` and still travels 18px over 600ms.
