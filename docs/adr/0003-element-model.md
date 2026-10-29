---
type: ADR
id: "0003"
title: "One Element resource with a kind, replacing the fixed-size Rectangle"
status: active
date: 2026-10-28
---

## Context

The human approved Excalidraw-style tools (2026-10-28): selection, rectangle,
diamond, ellipse, arrow, line, freehand draw, text, note and eraser, with
keyboard shortcuts and canvas panning. That lifts these SPEC §2 initial
exclusions: resizing (shapes are drawn at any size), deleting (eraser) and
selection. Undo, history, styling, presence and offline editing stay excluded.

Today the only persisted shape is `Rectangle` with a constant 120 × 80 size,
an `x`/`y` position and the `version` register from ADR 0001. Every new tool
needs the same collaboration guarantees: board scoping, atomic version
increments, versioned notifications and ephemeral drag previews.

## Decision

Generalise `Sketch.Canvas.Rectangle` into `Sketch.Canvas.Element`
(table `elements`), keeping one resource and one set of actions:

- `kind`: `:rectangle | :diamond | :ellipse | :arrow | :line | :freedraw | :text | :note`, immutable after create.
  The first PR allows only `:rectangle`; each tool's PR extends the `one_of` constraint.
- `x`, `y`, `width`, `height`: the bounding box, all integers. Width and height
  are at least 1 for box kinds and at least 0 for point kinds (a horizontal or
  vertical line has a flat box), and the box must stay inside the canvas (Ash constraints plus
  a PostgreSQL CHECK that combines them). The `x + width` and `y + height` checks
  are an Ash validation with an atomic form, so `commit_position` checks the new
  position against the stored size inside the same UPDATE. All bounds derive from
  `Sketch.Canvas.Geometry`.
- `points` (added with the line, arrow and draw tools): for `:line`, `:arrow` and
  `:freedraw`, a list of the embedded resource `Sketch.Canvas.Point` (`x`, `y`
  integers) relative to `x`/`y`, each inside `[0, width] x [0, height]`. The count
  per kind comes from `Geometry.point_count/1` (a line or an arrow has exactly 2; an arrow's head is at its second point; a freehand stroke has 2 to 500, thinned by the client and scaled with the box on resize). Empty for
  other kinds. It is stored as `jsonb[]`, the AshPostgres default for an array of
  embeds: a single `jsonb` column breaks atomic updates, which cast the value to
  `jsonb[]`. The `PointsFitShape` validation and two CHECK constraints
  (`points_match_kind`, `points_within_box`) enforce count, shape and bounds.
- `text` (added with the text tool, reused by the note tool): a `:string` that keeps
  whitespace. For `:note` it may be empty and is otherwise bounded like `:text`.
  For `:text` it must contain a character other than a space, tab,
  CR or LF, contain no NUL and be at most `Geometry.max_text_length/0` (2000)
  code points, the unit of PostgreSQL `char_length`. Every other kind stores `""`.
  The `TextFitsKind` validation (atomic against the stored kind) and two CHECK
  constraints (`text_length`, `text_matches_kind`) enforce it. Text renders as
  SVG `<text>` with one `<tspan>` per line at the font size and line height in
  `Geometry`. A `:note` is a box kind whose text the client wraps with the pure
  helper `wrapText`, at `Geometry.char_width` per character inside
  `Geometry.note_padding`, in a nested `<svg>` that clips it; the server
  renders no lines for notes.
- `version`: unchanged semantics (ADR 0001).

Actions: `create` (accepts kind, box, points, text, board), `commit_position`
(moves the box; points are relative so they move with it), `commit_shape`
(box, points and text from a finished edit; the text PR adds `text` to it), and `erase` (destroy, added with the eraser). The first PR ships `create`,
`commit_position`, `commit_shape` (box only) and `list_for_board`; the line
PR makes `commit_shape` take the box and points together, so a size change
always arrives with points that fit it. Every
update increments `version` atomically, and every action publishes on the board
topic. `erase` publishes a removal that clients apply regardless of version.

The migration from `rectangles` renames the table and adds columns with
defaults that reproduce today's rectangles (`kind = 'rectangle'`,
`width = 120`, `height = 80`), so existing boards keep their data. The defaults
are dropped after the backfill, and the primary key, foreign key and board index
are renamed, so the end state matches a freshly generated `elements` table.

## Alternatives considered

- **One resource per shape kind**: clearer types, but duplicates the actions,
  notifications, policies and client merge logic eight times. Rejected.
- **A JSON `props` column for everything kind-specific**: flexible, but pushes
  validation out of Ash and the database (A08). Rejected.
- **Keep the `rectangles` table name**: avoids a rename, but leaves every query
  and migration misnamed. Rejected.

## Consequences

All tools share one collaboration path, one property-test model and one
client merge rule. Kind-specific validation lives in Ash validations plus
CHECK constraints. Points and text make rows larger. Revisit when an element
needs relationships (bound arrows, grouping) or styling.
