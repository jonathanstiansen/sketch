---
type: ADR
id: "0005"
title: "Hand-drawn rendering from a per-element seed, generated identically on both sides"
status: active
date: 2026-10-30
---

## Context

The canvas draws exact geometric shapes. The look people most often say they
like about Excalidraw-style whiteboards is the hand-drawn one: edges that bow
slightly, are traced twice and overshoot at the corners. The human approved one
global hand-drawn look on 2026-10-30 (addendum D9); per-element styling stays
excluded.

Three forces shape the design:

- Every element is drawn by two renderers, the server's (HEEx, page load and
  every committed change) and the client's (live resizes and draw previews),
  forced equal by a parity fixture (ADR 0004). A random wobble has to come out
  the same on both sides, in every browser, and on every reload.
- A drawing has to keep its character. If the wobble changed on every render,
  a shape would shimmer while it is resized and look different in each browser.
  The randomness has to belong to the element, not to the render.
- The draw preview the author sees is the same shape the board commits. If the
  server picked the randomness at create time, the committed element would
  jump to a different wobble the moment the pointer is released.

Floating point is the usual way such generators differ between languages:
`Math.sin` in V8 and `:math.sin` in the BEAM's libm may differ in the last
bit, and `String(0.1 + 0.2)` and Elixir's float printing use different
shortest-representation rules.

## Decision

1. **A per-element `seed`.** `Element` gains `seed`, an integer in
   `0..2_147_483_647` (`Geometry.max_seed/0`), enforced by an Ash constraint
   and a PostgreSQL CHECK (`seed_in_range`), like the other A08 bounds. Only
   `create` accepts it; `commit_position` and `commit_shape` do not, so it
   never changes after creation. A create without one gets a random seed from
   the Ash default, and the column has a random database default
   (`migration_defaults`) so existing rows, and inserts from a server that
   predates this change, get one too. The migration only adds a column with a
   default and a CHECK (expand only). The seed is part of the element event,
   the wrapper's `data-seed` and the renderer's local shape.
2. **The client picks the seed.** Drawing a new element draws a random seed
   when the gesture starts. The local preview, every `draw_preview` and the
   final `create_element` carry it, so the author's preview, other browsers'
   previews and the committed element wobble identically. `BoardLive` accepts
   an optional `seed` on `create_element` and `draw_preview` and drops the
   event if it is not an integer in range, like the other params. A missing
   seed falls back to the random default, so an older client still works.
3. **One generator, written twice, in integer arithmetic.** `SketchWeb.HandDrawn`
   and `assets/js/elements/hand_drawn.ts` implement the same steps. The random
   source is mulberry32 (`SketchWeb.HandDrawn.Random`, `random.ts`): 32-bit
   state and output, written with `Bitwise` and a `0xFFFFFFFF` mask in Elixir
   and `Math.imul` and `>>> 0` in TypeScript. Every coordinate is an integer
   number of hundredths of a pixel. A signed offset of at most `a` is
   `rem(u, 2a + 1) - a`; scaling uses truncating integer division (`div/2`,
   `Math.trunc(a / b)`, exact because every operand stays far below 2^52). No
   float is ever produced, so there is no float rounding or printing to agree
   on. A hundredths value prints as an integer when it is whole and otherwise
   as a sign, the whole part, a dot and exactly two digits (`-0.05`, `1.50`).
4. **What is sketched.** Each straight edge is two cubic Bézier strokes whose
   ends are jittered and whose two control points bow along the edge's normal.
   Rectangle and note outlines are four such edges, the diamond the four edges
   through its side midpoints, and lines and arrows one edge. An ellipse is two
   closed four-segment Bézier curves (the usual 0.5523 control-point ratio)
   whose anchors are jittered, ending slightly off the start. The jitter grows
   with the edge's larger axis span and is capped: at most 2 px at the ends
   and 3 px of bow (half as much again on the second control point), so no
   point of the path lies more than 6.5 px per axis outside the exact shape's
   box (`HandDrawn.max_jitter/0`), and a zero-size shape yields a valid
   degenerate path. Freehand strokes and text are
   unchanged.
5. **Hit geometry does not change.** The fill stays the exact `rect`,
   `polygon` or `ellipse` (and the note's rounded body), now with a
   transparent stroke of the same width, so the area that takes the pointer is
   what it was. The sketch is one `path[data-sketch]` on top with
   `pointer-events: none`. Lines and arrows keep their transparent 14 px hit
   `line`; the visible stroke becomes `path[data-line-stroke]`, which still
   carries the arrowhead marker. Selection, handles and the eraser use the
   element's box and points, which the sketch does not touch.
6. **Parity.** The render fixture renders every shape with several fixed
   seeds (0, 1, 7, 1 234 567 890, 2 147 483 646 and 2 147 483 647); a new
   `assets/test/fixtures/random_parity.json` holds the first 64 outputs of the
   generator for those and other seeds. Both are written by
   `mix sketch.gen.render_fixtures`, checked by `--check` in `mix ci`, and
   compared in `node --test`. A StreamData property checks that the output is
   deterministic and stays within the box plus `max_jitter`.

## Alternatives considered

- **rough.js or a port of it**: a mature generator, but a production npm
  dependency (A15 allows none) and client-only, so the server would have to
  render plain shapes and the page would change look on hydration. Copying
  its source is not an option either. Rejected.
- **An SVG `feTurbulence` / `feDisplacementMap` filter**: one CSS rule and no
  geometry, but it distorts the fill and text too, renders differently across
  browsers, does not trace edges twice, and makes strokes look wavy rather
  than drawn. Rejected.
- **Seed derived from the element id**: no new column, but the id is chosen by
  the server on insert, so the author's preview could not match the committed
  shape, and a string hash would be a third thing to keep in parity. Rejected.
- **Server-chosen seed only**: simpler params, but the committed element would
  jump from the preview's wobble to another one on release. Rejected; the
  server still chooses one when the client sends none.
- **Floats with matching operation order**: shorter code, but needs a shared
  rule for converting to hundredths, care with negative rounding, and no
  trigonometry (whose last bit differs between libms). Integer hundredths
  remove the problem rather than managing it. Rejected.
- **Per-element style (roughness, stroke width, colour)**: what Excalidraw
  offers, but styling is excluded (addendum D8, D9). Rejected for now.

## Consequences

Every element keeps one wobble for life: in every browser, after a reload,
while it is dragged and while it is resized, where the wobble scales with the
shape but its pattern stays the same. Hit-testing, selection and erasing are
unchanged.

The generator is a third piece of renderer code that must agree on both sides;
the PRNG fixture localises a drift to the random source, and the render fixture
catches drift in the geometry or the number printing. Render fixtures grow by
the number of seeds for kinds without text; text kinds rotate through the seeds
instead to keep the file small. Parity is still only checked on fixture shapes
(see ARCHITECTURE.md, Known limits).

The seed column locks in mulberry32 and this algorithm as the meaning of a
stored seed: changing either changes how every existing drawing looks. A
different algorithm would need a version alongside the seed. Revisit if
per-element styling is approved (roughness would join the seed), or if a kind
needs a sketch the edge and ellipse primitives cannot express.
