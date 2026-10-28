# Known limitations

## Simultaneous drags of the same rectangle (measured in Gate 4)

SPEC section 5 permits in-progress drag visuals to disagree. This records what actually happens. The measurements come from `e2e/tests/concurrent-drag.spec.ts`: browsers A and B grab the same rectangle at (100, 100). A drags it right to x=450 and B drags it down to y=250, in 40 interleaved steps. Browser C only watches. The test samples all three positions after each step. Six consecutive runs, all passing.

**What disagrees while both mouse buttons are down**

- A and B never see each other's drag. A browser ignores remote previews for the rectangle it is dragging itself, so A always shows the rectangle on its own path and B on its own. They disagree in every one of the 40 samples in every run.
- C receives both previews and applies whichever arrives last (previews from different `drag_id`s are not ordered against each other). C flips between A's path and B's path, and also lags the sender by up to one 50 ms preview interval. Per run, C matched A exactly in 5 to 26 of 40 samples and B exactly in 2 to 30 (for example 12/28, 10/30, 26/6, 15/24, 16/16, 5/7). The other samples were on neither path at that instant, typically a slightly older position of one drag (for example C at x=441 while A was at x=450).

**How it converges**

- Both releases send `commit`. Each commit is an atomic `version + 1`, so the final `data-version` was 2 in all six runs (A09, ADR 0001).
- The row keeps the position of the commit PostgreSQL applied last. It was B's position (x=100, y=250) in four runs and A's (x=450, y=100) in two, so the winner is genuinely a race.
- Every client then receives the version 2 broadcast, which is newer than anything it holds, and moves to the persisted position. In every run, A, B and a reloaded C showed identical x, y and version 2.

**Why this is acceptable**

Previews are transient and carry no authority. Only a committed, versioned broadcast changes `data-x`, `data-y` and `data-version`, and clients accept it only if its version is higher than what they hold. Last-write-wins at the database is the single ordering authority (ADR 0001). Ordering previews across concurrent draggers would need a per-rectangle drag lock, which the spec does not ask for.

Evidence: `docs/evidence/gate-4/concurrent-drag.gif` (A, B and C side by side, slowed 3x).
