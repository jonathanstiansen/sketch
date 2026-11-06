---
type: ADR
id: "0017"
title: "Text inside shapes as a label with a draggable offset"
status: active
date: 2026-11-05
---

## Context

People want to write inside rectangles, diamonds and ellipses, and to move that text around inside
the shape. The text has to move, resize, undo, copy and erase with its shape, and it must never end
up outside it. Notes already hold wrapped text from their top-left corner. Free text elements exist
too, but a separate text element linked to a shape would need the binding machinery of ADR 0016
for every move, plus rules for erasing one without the other.

## Decision

The text belongs to the shape.

- `Sketch.Canvas.Kind` gains `text: :label`: optional text, drawn as a centred label. Rectangles,
  diamonds and ellipses use it. It counts as a text kind for storage, the CHECK constraints, double
  click and Enter, but drawing such a shape does not open the editor.
- The label point is stored as `label_x` and `label_y` in per mille of the shape's box, defaulting to
  the centre (500, 500). A per-mille offset stays inside the box through moves and resizes. Every
  offset a client sends is clamped into 0..1000 (`Sketch.Canvas.Label.clamp/1`), and a CHECK keeps it
  there and on labelled kinds only.
- `SketchWeb.ElementRenderer.label/1` and `assets/js/elements/label.ts` draw the lines wrapped like
  a note and centred on the label point, moved just far enough that the whole text block stays
  inside the box whenever it fits (`Sketch.Canvas.Label.placed/5`); a block larger than the box is
  centred and clipped. The render parity fixture covers them
  with a focused set of label cases, and keeps the earlier empty-text cases unchanged.
- Enter (`SketchWeb.ShapeTextActions`) or a double click opens the existing text editor over the
  shape, centred. A selected labelled shape shows a label handle over its text; dragging the handle
  moves the label, and dragging anywhere else still moves the shape. The handle reuses the
  selection overlay's handle gesture, so the pointer gesture registry is unchanged.

## Alternatives considered

- **A text element bound to the shape**: reuses text elements, but every shape move or erase would
  have to touch a second element. Rejected for one element holding its own text.
- **An offset in pixels**: exact, but a resize could push the label outside the box. Rejected.
- **Dragging the text itself as a new pointer target**: needs a fourth gesture target in the
  aggregate. Rejected for a handle shown only on the selected shape, so dragging the text of an
  unselected shape still moves the shape.

## Consequences

- A label moves, resizes, undoes, copies and erases with its shape for free.
- The label drag is not previewed live to other viewers; they see it when it commits. Adding
  `label` to the preview payload would change that.
- A long label on a small shape is clipped to the box, like a note.
