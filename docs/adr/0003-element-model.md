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
  are at least 1, and the box must stay inside the canvas (Ash constraints plus
  a PostgreSQL CHECK that combines them). The `x + width` and `y + height` checks
  are an Ash validation with an atomic form, so `commit_position` checks the new
  position against the stored size inside the same UPDATE. All bounds derive from
  `Sketch.Canvas.Geometry`.
- `points` (added with the line, arrow and draw tools): for `:line`, `:arrow` and
  `:freedraw`, a list of `[dx, dy]` integer pairs relative to `x`/`y`, bounded in
  length. Empty for other kinds.
- `text` (added with the text and note tools): for `:text` and `:note`, bounded
  length. Empty for other kinds.
- `version`: unchanged semantics (ADR 0001).

Actions: `create` (accepts kind, box, points, text, board), `commit_position`
(moves the box; points are relative so they move with it), `commit_shape`
(box, points and text from a finished edit), and `erase` (destroy, added with the eraser). The first PR ships `create`,
`commit_position`, `commit_shape` (box only) and `list_for_board`. Every
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
