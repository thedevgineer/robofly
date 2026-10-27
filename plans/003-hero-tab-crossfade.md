# 003 — Crossfade the hero tab line

- **Status**: TODO
- **Commit**: 46df174
- **Severity**: MEDIUM
- **Category**: Easing
- **Estimated scope**: 1 file, ~20 lines

## Problem

Hovering a hero tab swaps the sentence with a travel entrance. The paragraph is remounted on every tab (`key={tab.id}` in `viewer/src/Home.tsx:218`), and the keyframe runs from `translateY(4px)` for 360ms with the weak `ease` keyword. Moving across tabs restarts that entrance from zero. Tab hover is a repeated action, so the entrance is too much motion and too slow for UI (budget is under 300ms).

```css
/* viewer/src/styles.css:3263 — current */
.hero-desc {
  min-height: 4.6em;
  margin: 14px 0 0;
  color: #4a453d;
  font-size: 15px;
  line-height: 1.55;
  animation: desc-in 360ms ease;
}

@keyframes desc-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
```

```tsx
/* viewer/src/Home.tsx:208 — current, this is what retriggers the entrance */
onMouseEnter={() => setActive(index)}
```

```tsx
/* viewer/src/Home.tsx:218 — current */
<p className="hero-desc" key={tab.id} role="tabpanel" aria-live="off">
```

Reduced motion already disables the keyframe at `viewer/src/styles.css:3335`.

## Target

The new sentence fades in. It does not travel. 200ms, strong ease-out. Remounting still starts the fade via `@starting-style`, which is the entry path when there is no extra JS.

```css
/* :root — add if absent */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);

.hero-desc {
  min-height: 4.6em;
  margin: 14px 0 0;
  color: #4a453d;
  font-size: 15px;
  line-height: 1.55;
  transition: opacity 200ms var(--ease-out);
}

@starting-style {
  .hero-desc {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-desc {
    animation: none;
    transition: opacity 200ms ease;
  }
}
```

Delete `@keyframes desc-in`.

## Repo conventions to follow

`:root` in `viewer/src/styles.css` holds the custom properties. The reduced-motion rule for this element already exists at `viewer/src/styles.css:3335`. Extend that block. Do not add a second media query for `.hero-desc`.

## Steps

1. Add `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` to `:root` if it is absent.
2. Remove `animation: desc-in 360ms ease;` from `.hero-desc`. Add `transition: opacity 200ms var(--ease-out);`.
3. Delete `@keyframes desc-in`.
4. Add the `@starting-style` block above.
5. In the reduced-motion block at `viewer/src/styles.css:3329`, keep `.hero-desc { animation: none; }` and add `transition: opacity 200ms ease;`.

## Boundaries

- Do NOT remove `key={tab.id}` or change `onMouseEnter` / `onFocus`. The sentence still swaps. Only the entrance changes.
- Do NOT change `.tab-progress` or `ROTATE_MS`.
- Do NOT add a dependency.
- If a step doesn't match the code you find (drift since 46df174), STOP and report instead of improvising.

## Verification

- **Mechanical**: from `viewer/`, `npm run build` exits 0.
- **Feel check**: on `/`, hover across the hero tabs.
  - The sentence fades. It does not rise from below.
  - The fade is about 200ms. At 10% in the Animations panel, there is no `translateY`.
  - `prefers-reduced-motion: reduce` still lets the sentence fade. It does not travel.
- **Done when**: `desc-in` is gone from `viewer/src/styles.css`, and `.hero-desc` transitions only `opacity`.
