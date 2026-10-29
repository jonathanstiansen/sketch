---
type: ADR
id: "0004"
title: "Element kinds come from one registry and render in local coordinates"
status: active
date: 2026-10-29
---

## Context

Adding the eight element kinds (ADR 0003) touched about eight places per kind:
the Ash `kind` constraint, `Geometry` tables, Ash validations, PostgreSQL CHECKs,
a HEEx clause, the hook's `setBox`, the attributes `keepDraggedPosition`
protects, and the tool list in both `toolbar.ex` and `tools.ts`. Nothing forced
those places to agree. A missing HEEx clause fell through to a rectangle, a
missing `setBox` branch silently skipped an attribute, and the two tool lists
were kept equal only by an E2E test.

The human's goal (2026-10-29) is that an agent cannot ship a change that breaks
a rule, even if enforcement is less simple, as long as the right change stays
simple. Duplication is acceptable when a check forces the copies to agree.

## Decision

Every kind is declared once, and every other place either derives from that
declaration or is checked against it at compile time or in `mix ci`.

1. **Domain registry.** `Sketch.Canvas.Kinds` lists one module per kind under
   `lib/sketch/canvas/kinds/`. Each returns a `%Sketch.Canvas.Kind{}` spec:
   `id`, `geometry` (`:box` or `{:points, min..max}`), `text` (`:none`,
   `:optional` or `:required`) and `default_size`. The `kind` attribute type,
   `Geometry`, the validations and the CHECK SQL derive from the specs, so
   `ash.codegen --check` fails if a spec change is not migrated (A17).
2. **Tool manifest.** `SketchWeb.Tools` declares each toolbar tool (id, label,
   keys, icon and the kind it creates, if any). The toolbar renders from it.
3. **Generated client contract.** `mix sketch.gen.manifest` writes
   `assets/js/generated/manifest.ts` from the kind specs, the tool manifest and
   `Geometry`: an `ElementKind` literal union, the specs and the tools.
   `mix sketch.gen.manifest --check` runs in `mix ci`, so a stale client copy
   fails CI. The file is generated, never edited.
4. **Local render model.** Every element renders as one wrapper,
   `<g data-element … transform="translate(x y)">`, whose children are drawn
   in local coordinates `[0, width] × [0, height]`. Moving changes only the
   wrapper's transform and `data-x`/`data-y`, for every kind. Resizing
   re-renders the children from the kind's renderer.
5. **One renderer per kind on each side, forced equal.** The server renders
   children with `SketchWeb.Elements.<Kind>` (a behaviour); the client with
   `assets/js/elements/<kind>.ts`, a pure function returning an SVG node tree,
   used for live resizes and draw previews. Coverage is enforced by the
   compiler: `SketchWeb.Elements` fails to compile unless its renderers cover
   `Sketch.Canvas.element_kinds()` exactly, and the client table is declared
   `satisfies Record<ElementKind, Renderer>`. A parity fixture generated from
   the server renderers (`mix sketch.gen.render_fixtures --check`) is compared
   with the client renderers in `node --test`, so the two cannot drift.
6. **Rule A22.** Kind-specific branching (`kind == :x`, `kind === "x"`,
   `%{kind: :x}` heads, `data-kind="x"` selectors) is only allowed inside the
   kind modules, the renderers and generated files. The architecture check
   scans `lib/` and `assets/js/` and has a negative fixture.

Kinds move onto the registry and the render model one per PR. Until a kind
moves, its spec lives in `Sketch.Canvas.Kinds.Legacy` and its old code paths
are listed in A22's `legacy_kind_files` allowlist. A test requires that
allowlist to shrink to empty once `Legacy` has no kinds, and the last PR
deletes both.

## Alternatives considered

- **Hand-kept lists with a contract test**: simplest, but an agent can update
  the test together with the lists. Rejected for the client copies; kept only
  where the compiler already checks the shape.
- **Client-only rendering (`phx-update="ignore"` on the canvas, state by
  `push_event`)**: removes the server renderer, but loses LiveViewTest
  assertions on the canvas and moves the merge rule into TypeScript. Rejected.
- **`Ash.Type.Union` of embedded resources per kind**: idiomatic for
  per-variant data, but the variants share one box and differ only in points
  and text, and it would need a data migration. Deferred; revisit when kinds
  gain styling or relationships.
- **Nested `<svg viewBox>` so resizing scales children for free**: no
  per-kind resize code, but strokes, arrowheads and text distort during a
  resize. Rejected.

## Consequences

A new kind is one spec module, one server renderer, one client renderer, one
tool entry and one line in each registry; the compiler and `mix ci` name every
missing piece. Two renderers still exist, but drift fails CI instead of
showing up in a browser. The generated manifest and parity fixture are
committed files, so reviews show them changing. A22 is a source scan and can
be evaded by building identifiers dynamically; the negative fixture covers the
direct forms only. Revisit if a kind needs per-variant attributes (consider
the union type) or if client-only rendering becomes necessary for performance.
