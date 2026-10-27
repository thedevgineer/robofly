# 005 — Move the menu icon with transform

- **Status**: TODO
- **Commit**: 46df174
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 file, ~15 lines

## Problem

The menu button animates `top`. That is a layout property. The bars only need to meet in the middle and rotate.

```css
/* viewer/src/styles.css:2217 — current */
.nav-toggle i {
  position: absolute;
  left: 11px;
  right: 11px;
  height: 2px;
  background: #16140f;
  transition: transform 180ms ease, top 180ms ease;
}

.nav-toggle i:first-child {
  top: 15px;
}

.nav-toggle i:last-child {
  top: 22px;
}

.nav-toggle[aria-expanded="true"] i:first-child {
  top: 19px;
  transform: rotate(45deg);
}

.nav-toggle[aria-expanded="true"] i:last-child {
  top: 19px;
  transform: rotate(-45deg);
}
```

The first bar travels 4px down (`15` to `19`). The second travels 3px up (`22` to `19`). `ease` also holds back the start of a small UI motion.

## Target

`top` stays put. The expanded state is a transform. 180ms, strong ease-out. Under reduced motion the icon still changes, with no travel animation.

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);

.nav-toggle i {
  transition: transform 180ms var(--ease-out);
}

.nav-toggle i:first-child {
  top: 15px;
}

.nav-toggle i:last-child {
  top: 22px;
}

.nav-toggle[aria-expanded="true"] i:first-child {
  transform: translateY(4px) rotate(45deg);
}

.nav-toggle[aria-expanded="true"] i:last-child {
  transform: translateY(-3px) rotate(-45deg);
}

@media (prefers-reduced-motion: reduce) {
  .nav-toggle i {
    transition: none;
  }
}
```

## Repo conventions to follow

The icon is two `<i>` elements in `viewer/src/Home.tsx` and `viewer/src/SiteNav.tsx`. Do not change that markup. The existing reduced-motion block is at `viewer/src/styles.css:2726`. Add the nav rule there.

## Steps

1. Add `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` to `:root` if it is absent.
2. Change `.nav-toggle i` to `transition: transform 180ms var(--ease-out);`.
3. Remove `top: 19px` from both expanded rules. Set the transforms to `translateY(4px) rotate(45deg)` and `translateY(-3px) rotate(-45deg)`.
4. In the reduced-motion block at `viewer/src/styles.css:2726`, add `.nav-toggle i { transition: none; }`.

## Boundaries

- Do NOT change the closed positions `top: 15px` and `top: 22px`.
- Do NOT change the button size, the hit area, or the `aria-expanded` logic.
- If a step doesn't match the code you find (drift since 46df174), STOP and report instead of improvising.

## Verification

- **Mechanical**: from `viewer/`, `npm run build` exits 0.
- **Feel check**: narrow the window until the menu button shows, then open and close it.
  - The two bars meet and cross. They do not jump.
  - At 10% playback, the animated property is `transform` only.
  - `prefers-reduced-motion: reduce`: the icon switches to the open form with no slide.
- **Done when**: `.nav-toggle i` does not transition `top`.
