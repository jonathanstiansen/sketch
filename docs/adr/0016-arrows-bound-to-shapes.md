---
type: ADR
id: "0016"
title: "Arrows and lines bound to shapes, resolved when drawn"
status: active
date: 2026-11-05
---

## Context

Lines and arrows connect shapes in most sketches. Before this decision an arrow stored only its own
box and two points, so moving a shape left its arrows behind. The connection has to survive moves
by any viewer, concurrent edits (ADR 0001, last write wins per element), undo (ADR 0008, replayed
as ordinary commits, with re-created elements under new ids), erases (hard deletes with a
tombstone) and reloads.

Two families of design exist:

- **Write-through**: moving a shape also rewrites every arrow bound to it, so stored geometry is
  always current. Each shape move becomes several writes, undo needs compound entries, and two
  viewers moving the two ends of one arrow race on the arrow's version.
- **Resolve when drawn**: an arrow end stores which element it is bound to and where on it, and the
  end point is computed from the target's current box whenever the arrow is drawn. A shape move
  writes only the shape.

## Decision

Resolve when drawn.

- **Storage**: each end of a kind whose draw gesture is `:two_point` (line, arrow) may store a
  binding: `start_target_id` with `start_anchor_x` and `start_anchor_y`, and the same for `end_`.
  An anchor is a position on the target's box in per mille (0 to 1000 on each axis), so it
  survives resizes.
- **Resolution**: `Sketch.Canvas.Binding.resolve/2` replaces a bound end point by
  `target.x + div(target.width * anchor_x, 1000)` (and the same for y). It then rebuilds the
  arrow's box and points around its two end points. An unbound end keeps its stored point.
  `assets/js/hooks/binding_logic.ts` is the client twin, and `mix sketch.gen.render_fixtures` writes
  `binding_parity.json` so a test fails if the two ever disagree.
- **Where it runs**: BoardLive resolves every arrow it sends: stream inserts, create replies and
  erase replies. When an element changes, it re-sends the arrows bound to it. The canvas hook
  resolves bound arrows while their targets move live, from local drags, resizes and remote
  previews, by finding them through `data-start-target` and `data-end-target`.
- **Binding**: releasing an arrow end, or dragging an endpoint handle, over a shape whose kind has
  box geometry binds that end at the release point. Releasing it over nothing unbinds it. Moving
  an arrow without its targets unbinds the ends whose targets stay put, so the arrow goes where it
  was dragged.
- **Integrity**: a composite foreign key `(board_id, start_target_id)` → `elements (board_id, id)`
  keeps a target on the same board. CHECK constraints keep anchors in 0..1000, keep a binding
  only on line and arrow kinds, require an anchor exactly when a target is set, and forbid binding
  to itself.
- **Erasing a target** freezes each bound end at its resolved point and clears the binding, in the
  same transaction as the erase. The arrow never jumps. The foreign key's `ON DELETE SET NULL` for
  the target column only is the safety net.
- **Undo**: undoing a shape's move moves its arrows with it, because only the shape was written.
  Undoing an erase re-creates the shape under a new id, and the arrows that were frozen stay where
  they are, unbound. Re-binding them needs a compound undo entry; ADR 0015 keeps room for one.

## Alternatives considered

- **Write-through**: simpler rendering, but every move becomes N writes and N undo changes, and
  concurrent moves of an arrow's two targets conflict on the arrow. Rejected.
- **Bindings as a JSON column**: one column per end, but no foreign key, and the CHECKs become JSON
  path queries. Rejected for the six plain columns.
- **Anchors in pixels from the target's origin**: exact while the target keeps its size, wrong after
  a resize. Rejected for per mille.
- **Bind to the nearest edge point instead of the release point**: nicer looking. Deferred: it
  changes only `anchorFor`, which can be revisited without a migration.
- **Restricting target kinds in the database**: needs a trigger or a generated-column foreign key.
  Every element has a box, so binding to any kind resolves correctly. The client offers only box
  kinds. Rejected as an integrity rule.

## Consequences

- A shape move stays one write and one undo step, whatever is bound to it.
- Stored arrow geometry can be stale while bound. Readers that need where an arrow is drawn use
  the resolved event from BoardLive, or the DOM, never the row.
- Clipboard copies drop bindings: a pasted arrow sits where it was drawn, unbound. Copying a shape
  together with its arrows and re-binding the copies is future work.
- The twin resolver adds one parity fixture. Re-evaluate if a third twin appears, together with
  the renderers (complexity analysis, recommendation 6).
