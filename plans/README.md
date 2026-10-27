# Animation plans

Commit stamp: `46df174`. Source of the curves: `cubic-bezier(0.23, 1, 0.32, 1)` for ease-out, spring `{ duration: 0.5, bounce: 0.2 }` for a flick.

| Plan | Title | Severity | Status |
| --- | --- | --- | --- |
| 001 | Stop the playground from animating height | HIGH | TODO |
| 002 | Hand orbit release speed to a spring | HIGH | TODO |
| 003 | Crossfade the hero tab line | MEDIUM | TODO |
| 004 | Ease section reveals out | MEDIUM | TODO |
| 005 | Move the menu icon with transform | MEDIUM | TODO |
| 006 | Hold the clock LED still when motion is reduced | MEDIUM | TODO |
| 007 | Ease the button press | LOW | TODO |

## Order

Run 007 first. It adds `--ease-out` on `:root`. 001, 003, 004, and 005 use that variable and also add it if it is missing, so they can run alone.

Then 004, 005, 006, 003. They are separate CSS edits. 006 only adds a reduced-motion rule.

Then 001. It removes layout transitions on the playground open.

002 last. It installs `motion` and changes the yard and die pointer loops. The follow camera stays on `springToward`. Dialogs in the product plan use base-ui. These seven plans do not.

## Dependencies

- 002 does not depend on the CSS plans.
- 001, 003, 004, 005, and 007 all write `:root` and `viewer/src/styles.css`. Run them one at a time so the `--ease-out` line is added once.
- 006 writes the same reduced-motion block as 001 and 005. Run 006 before or after those, and keep every rule already in that block.
