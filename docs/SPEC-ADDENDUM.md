# Spec addendum v0.3 — gap resolutions

These close gaps found in review of v0.2, chosen to be the simplest idiomatic
Ash/Phoenix option. Where they conflict with SPEC.md, this file wins. Changing
any of them follows the §9 change policy.

## D0 — Consistency model (see ADR 0001)

No Ash-native CRDT exists. Durable consistency uses Ash atomic updates:
`commit_position` sets `x`/`y` and applies
`change atomic_update(:version, expr(version + 1))`. Each rectangle position is
a server-ordered last-write-wins register; `version` is its tag. Clients keep
the highest version seen and ignore lower ones.

## D1 — Coordinate bounds (A08)

Canvas is 4000 × 4000; rectangles are a constant 120 × 80.
`x` in `0..3880`, `y` in `0..3920`. Ash attribute constraints plus a PostgreSQL
CHECK constraint (via `check_constraints` in the AshPostgres `postgres` block).

## D2 — Previews carry the base version

Preview payload: `{rectangle_id, drag_id, seq, base_version, x, y}`. Receivers
drop a preview whose `base_version` is below their known version, or whose
`seq` is not newer for that `drag_id`. Late previews cannot undo a commit.

## D3 — Interrupted drags

`pointercancel` or a lost connection mid-drag reverts locally and never calls
`commit_position`. If still connected, the hook pushes `drag_cancel`. Receivers
also revert a preview after 2000 ms of silence, covering a dragger that
vanished. Tests drive that timer with Playwright's clock API (A20).

## D4 — Dependency baseline (A15)

An ExUnit test compares the production runtime deps from `mix.exs` and
`assets/package.json` `dependencies` against an allowlist in
`architecture/rules.exs`. Changing the allowlist is a protected change (A16).

## D5 — Suppression ban (A21, new)

No `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`,
`credo:disable`, `@dialyzer` attributes or Dialyzer ignore files. Enforced by
the architecture check, with a negative fixture.

## D6 — Review identity (A16, A19)

The repo cannot enforce its own branch protection. A human must enable a ruleset
on `main` (PR required, CI required, CODEOWNERS review) and have agents push
under an identity distinct from the reviewer. Until then A16/A19 are reported
as **unverified** in every PR.

## D7 — Small defaults

- Board IDs use Ash's default `uuid_primary_key` (random UUIDv4).
- Playwright tests create a fresh board per test instead of using the SQL
  sandbox; board isolation is the test isolation.
- Known risk, not addressed this milestone: no server-side rate limit or
  rectangle cap on public boards.

## D8 — Drawing tools approved (2026-10-28, see ADR 0003)

The human approved Excalidraw-style tools on 2026-10-28, added one PR at a time:
Selection, Rectangle, Diamond, Ellipse, Arrow, Line, Draw, Text, Note and
Eraser, with keyboard shortcuts.

This lifts three SPEC §2 initial exclusions:

- **Resizing**: elements are drawn at any size and resized from a corner.
- **Deleting**: the Eraser removes elements (its own PR).
- **Selection**: clicking an element selects it. Selection is local UI state
  and is never broadcast.

Still excluded: undo, history, styling, presence indicators, offline editing,
CRDTs (and the other §2 exclusions: user accounts, external brokers,
multi-node deployment).

Consequences for the earlier decisions:

- D1: rectangles are no longer a constant 120 × 80. An `Element` stores its
  box; `x >= 0`, `y >= 0`, `width >= 1`, `height >= 1`, `x + width <= 4000`
  and `y + height <= 4000`, from `Sketch.Canvas.Geometry`, enforced by Ash and
  PostgreSQL CHECK constraints. 120 × 80 stays the size of a clicked or added
  rectangle.
  Point kinds (line, and later arrow and freehand) allow `width >= 0` and
  `height >= 0`, since a straight line can be zero-width; their points are
  relative to `x`/`y` and must lie inside the box, also enforced by Ash and
  PostgreSQL (ADR 0003).
- D2: previews carry the whole box:
  `{element_id, drag_id, seq, base_version, x, y, width, height}`, used for
  moves and resizes. Drawing a new element sends `draw_preview`
  `{drag_id, seq, kind, x, y, width, height}` and ends with `draw_end`
  `{drag_id}`, sent on cancel or after the element is created. Draw previews
  follow the same rules: throttled to 20 per second, never persisted, dropped
  after 2000 ms of silence.
- D0: `commit_shape` is a second update action with the same atomic version
  increment as `commit_position`; the client merge rule is unchanged.
