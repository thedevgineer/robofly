# 007 — Ease the button press

- **Status**: TODO
- **Commit**: 46df174
- **Severity**: LOW
- **Category**: Physicality
- **Estimated scope**: 1 file, ~2 lines

## Problem

Buttons scale to `0.97` on press, which is the right amount. The transition on the same elements does not include `transform`, so the scale appears and disappears in one frame. The release snaps.

```css
/* viewer/src/styles.css:56 — current */
select,
button {
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 10px;
  transition: background 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out;
}

button:active:not(:disabled) {
  transform: scale(0.97);
}
```

Press feedback should be `transform` over 160ms with a strong ease-out. `ease-out` as a keyword is weaker than the curve below.

## Target

```css
/* :root — add if absent */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);

select,
button {
  transition:
    background 160ms var(--ease-out),
    border-color 160ms var(--ease-out),
    color 160ms var(--ease-out),
    transform 160ms var(--ease-out);
}

button:active:not(:disabled) {
  transform: scale(0.97);
}
```

## Repo conventions to follow

This is the only shared button transition in `viewer/src/styles.css`. Other rules (`button.play-btn`, `.hud button`, `.die-tile`) override background and border. They do not set `transform`, so this transition still applies unless a later rule replaces the whole `transition` property. Grep `transition` on `button` after the edit. If a later rule sets `transition` without `transform`, add `transform 160ms var(--ease-out)` to that rule too. Do not invent a new scale.

## Steps

1. Add `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` to `:root` if it is absent.
2. Replace the `select, button` transition so it includes `transform 160ms var(--ease-out)` and uses `var(--ease-out)` for the three properties already listed.
3. Grep `viewer/src/styles.css` for `button` rules that set `transition`. Add the same transform timing to any of those that omit `transform`.

## Boundaries

- Do NOT change the scale from `0.97`.
- Do NOT add a press scale to links styled as `.btn`. This plan is the `button` element only.
- Do NOT add a dependency.
- If a step doesn't match the code you find (drift since 46df174), STOP and report instead of improvising.

## Verification

- **Mechanical**: from `viewer/`, `npm run build` exits 0.
- **Feel check**: press and release a dock button, a room button, and a die tile.
  - The button shrinks slightly on the way down and grows back on the way up. The release is not a snap.
  - At 10% playback, the scale move is about 160ms and starts fast.
  - A disabled button does not scale.
- **Done when**: the shared `button` transition includes `transform 160ms var(--ease-out)`.
