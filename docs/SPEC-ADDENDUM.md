# Spec addendum v0.3 — gap resolutions

These close gaps found in review of v0.2, chosen to be the simplest idiomatic
Ash/Phoenix option. Where they conflict with SPEC.md, this file wins. Changing
any of them follows the §9 change policy.

## D0 — Consistency model (see ADR 0001)

No Ash-native CRDT exists. Durable consistency uses Ash atomic updates:
`commit_position` sets `x`/`y` and applies
`change atomic_update(:version, expr(version + 1))`. Each rectangle position is
a server-ordered last-write-wins register; `version` is its tag. Clients keep
the highest version seen and ignore lower ones. An erase is a tombstone that
wins over every version of that element (D8).

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
- **Deleting**: the Eraser and Delete key remove elements (see D0 below).
- **Selection**: clicking an element selects it. Selection is local UI state
  and is never broadcast.

Still excluded: undo, history, presence indicators (live cursors were approved
later, D11), offline editing, CRDTs (and the other §2 exclusions: user accounts,
external brokers, multi-node deployment). Styling was excluded here until D10
approved colours and stroke styles.

Consequences for the earlier decisions:

- D1: rectangles are no longer a constant 120 × 80. An `Element` stores its
  box; `x >= 0`, `y >= 0`, `width >= 1`, `height >= 1`, `x + width <= 4000`
  and `y + height <= 4000`, from `Sketch.Canvas.Geometry`, enforced by Ash and
  PostgreSQL CHECK constraints. 120 × 80 stays the size of a clicked or added
  rectangle.
  Point kinds (line, arrow and freehand) allow `width >= 0` and
  `height >= 0`, since a straight line can be zero-width; a freehand stroke has 2 to 500 points; their points are
  relative to `x`/`y` and must lie inside the box, also enforced by Ash and
  PostgreSQL (ADR 0003).
  Text elements hold non-blank text of at most 2000 code points (counted like
  PostgreSQL `char_length`, without NUL); every other kind holds `""`, also
  enforced by Ash and PostgreSQL. Text renders at a fixed 20 px font size and
  25 px line height from `Geometry`; its box is the line count times the line
  height by the measured longest line. Text elements move but have no resize
  handles. Note elements are boxes of at least 1 by 1 that hold text of at most
  2000 code points, possibly empty or only whitespace. A click with the Note tool
  makes a 200 by 160 note; the text wraps to the note's width minus a 12 px
  padding on each side at the 12 px `Geometry.char_width` per character, breaking
  words longer than a line, and the box clips any overflow. Notes resize with
  corner handles and re-wrap.
- D2: previews carry the whole box:
  `{element_id, drag_id, seq, base_version, x, y, width, height}`, used for
  moves and resizes. Drawing a new element sends `draw_preview`
  `{drag_id, seq, kind, x, y, width, height}` and ends with `draw_end`
  `{drag_id}`, sent on cancel or after the element is created. Draw previews
  follow the same rules: throttled to 20 per second, never persisted, dropped
  after 2000 ms of silence. Typing text adds `text` to these payloads:
  `draw_preview` with kind `text` or `note` for a new element and `preview` for an edit. An
  open editor resends its latest preview every second, so a typing pause does
  not trigger the 2000 ms timeout.
- D0: `commit_shape` is a second update action with the same atomic version
  increment as `commit_position`; the client merge rule is unchanged.
- D0, deletes as tombstones (added with the Eraser): `erase` is an Ash destroy
  (a hard delete) reached through `erase_element(id, board_id)`, so an element
  on another board is not found and nothing is published. Its notification is
  `erase` with `{id, board_id}`. Clients treat it as a tombstone: the element
  is removed and every create or commit for that id, delivered before or after
  the erase, is ignored, so all delivery orders converge and an erased element
  never comes back. A commit for an erased element fails in PostgreSQL (the row
  is gone), publishes nothing, and the LiveView drops it without a flash when
  it already knows the id is erased. Drag previews of an erased element are
  dropped (D2).
- Deleting: with the Eraser (E or 0), a click erases the element under the
  pointer and a drag erases every element whose bounding box the pointer path
  touches. The touched elements fade during the drag and are erased on
  release; Esc or a cancelled pointer keeps them. With Selection, Delete or
  Backspace erases the selected element unless an editor has focus. There is
  no undo (still excluded).

## D9 — Hand-drawn rendering (2026-10-30, see ADR 0005)

The human approved a hand-drawn look on 2026-10-30. It is one global look:
roughness and fill styles (hachure and the like) are not per element. User-chosen
colours, stroke widths and stroke styles were approved later the same day (D10);
fonts stay excluded.

- Rectangles, diamonds, ellipses, notes, lines and arrows draw their outline
  as two slightly offset, slightly bowed strokes over the unchanged fill.
  Freehand strokes and text are drawn as before.
- The wobble comes from a per-element `seed`, an integer in
  `0..2_147_483_647`, stored with the element (Ash constraint and PostgreSQL
  CHECK, like D1) and never changed after create. The drawing client chooses
  it, so its preview, other browsers' previews and the committed element look
  identical; a create without one gets a random seed. Resizing keeps the seed,
  so an element keeps its character at any size.
- D2's `draw_preview` payload gains an optional `seed`; `create_element`
  accepts an optional `seed`. An out-of-range seed drops the event.
- Hit-testing, selection, handles and erasing use the exact geometry, as
  before; the hand-drawn strokes never take the pointer.

## D10 — Styling approved (2026-10-30, see ADR 0006)

The human approved per-element styling on 2026-10-30, answering a question
that cited §9. Styles are tokens from one registry, `Sketch.Canvas.Style`,
never colour values, and every colour has a light and a dark theme value.

This lifts the SPEC §2 (and D8) **styling** exclusion for:

- **Stroke colour**: `ink` (default), `red`, `green`, `blue`, `orange`. It is
  the colour of the kind's ink: outlines, lines and text glyphs.
- **Fill colour**: `auto` (default, the kind's own fill: the theme's primary
  colour for shapes, paper yellow for notes), `none`, `red`, `green`, `blue`,
  `yellow`.
- **Stroke width**: `thin` (default), `bold`, `extra_bold`.
- **Stroke style**: `solid` (default), `dashed`, `dotted`.

Each kind declares the properties that apply to it: all four for rectangles,
diamonds and ellipses; stroke colour, width and style for lines, arrows and
freehand strokes; fill and stroke colour for notes; stroke colour for text. An
inapplicable property holds its default, enforced by Ash and PostgreSQL CHECK
constraints like D1.

Still excluded: fonts and font sizes, opacity, layers and z-order (elements
stay in creation order), gradients and patterns, per-point or per-segment
styles, and roughness and fill styles (D9), as well as undo, history and the
other D8 exclusions (live cursors excepted, D11).

Consequences for the earlier decisions:

- D0: `commit_style` is a third update action with the same atomic version
  increment as `commit_position` and `commit_shape`, published as the same
  element event. Style shares the element's one last-write-wins register: each
  action writes only its own columns, so a concurrent style commit and shape
  commit both land and the highest version carries both. The client merge rule
  is unchanged. `create_element` accepts an optional style; a missing property
  gets its default.
- D1: `Element` gains `stroke_color`, `fill_color`, `stroke_width` and
  `stroke_style`, not null, each limited to its registry tokens and, for kinds
  it does not apply to, to its default, by Ash and by PostgreSQL CHECK
  constraints. The migration only adds the four columns with their defaults
  and the CHECKs (expand only), so existing rows and an old server keep
  today's look.
- D2: `draw_preview` gains the optional style of the element being drawn, so
  other browsers preview it in its colours. Style changes themselves are not
  previewed; they are committed at once. A style param that is not a token of
  its property drops the event, like an invalid seed (D9).
- Selection stays local (D8): the properties panel shows the selected
  element's style or, with no selection, the style the next element will be
  drawn with. That next-element style is local UI state and is never
  broadcast.

## D11 — Live cursors approved (2026-10-30, see ADR 0007)

The human explicitly approved live cursors on 2026-10-30. This lifts the SPEC §2
(and D8) **presence indicators** exclusion for one thing: each viewer sees the
other viewers' pointers on the canvas, with a name label, live.

- **Identity**: every open board view gets a random `viewer_id` when its
  LiveView mounts. Its display name (an adjective and an animal from two fixed
  lists) and its colour (one of the stroke colour tokens of `Sketch.Canvas.Style`,
  so both themes work) are derived from that id alone. Nothing is stored and the
  name cannot be edited. A view shows its own name next to the share link.
- **Transport**: like D2 previews. The hook pushes `cursor` `{x, y, seq}` in
  canvas coordinates, throttled to 20 per second and only when the position
  changed. The server accepts integers inside the canvas (`0..4000` on each
  axis) and a non-negative `seq`, and broadcasts
  `{viewer_id, name, color, x, y, seq}` on the board topic to every other view.
  Leaving the canvas or hiding the tab pushes `cursor_leave` `{seq}`, relayed as
  `{viewer_id, seq}`; `seq` is one counter per view shared by both events.
  Cursors are never persisted: they cause no database query (A10).
- **Receivers** drop a message whose `seq` is not newer than the newest message
  or leave seen for that `viewer_id`, and remove a cursor after 2000 ms without
  a message, covering a viewer that vanished (the same timeout as D3). A viewer
  that stops moving therefore disappears after 2000 ms and returns on its next
  move. Tests drive that timer with Playwright's clock API (A20).
- **Boards**: cursors travel only on the board topic, so they never cross
  boards (A07).
- **Rendering**: a `#remote-cursors` layer above the elements inside the canvas
  SVG, so a cursor sits at its canvas coordinates whatever the scroll position.
  It does not take pointer events and is not part of an export.

Still excluded: user accounts, a "who's online" roster, follow mode and chat,
as well as editable names, cursor history and the other D8 exclusions.

Consequences for the earlier decisions:

- D2 and D3: cursors are a second kind of transient message with the same
  throttle, never-persisted and stale-after-2000-ms rules; they carry no
  `base_version` because they refer to no element.
