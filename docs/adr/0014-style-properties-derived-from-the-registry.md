---
type: ADR
id: "0014"
title: "Style properties derived from the registry, strokes drawn with a pen"
status: active
date: 2026-11-05
---

## Context

ADR 0006 made `Sketch.Canvas.Style` the registry of style properties, and most
code derives from it. A review of the styling history (2026-11-05) found about
ten places that still listed every property by hand: one Ash enum module per
property and a type map in `Element`, a guard clause per property in
`BoardLive`, one `data-*` attribute per property in the element template, a
literal `DEFAULT_STYLE` on the client and a destructuring in the clipboard
encoder. Adding a property, such as the planned sloppiness, meant editing about
twenty files, and a forgotten list failed silently: the clipboard would have
dropped the new property, and then every paste would have been rejected.

The hand-drawn strokes took a bare `seed` at nine call sites in the renderers,
so any new stroke parameter would have changed every renderer on both sides.

## Decision

1. **Everything that handles every property derives the list.** The Element
   attributes are a loop over `Style.properties/0` with `:atom` and `one_of`
   constraints (same column type, no migration). `BoardLive` validates a token
   with `Sketch.Canvas.style_token/2`. The element template writes one
   `data-<property>` per registry property. The client reads
   `STYLE_DEFAULTS` from the generated manifest, and the clipboard spreads the
   style object.
2. **A24 keeps it that way.** A file in `lib` or `assets/js` outside
   `style_property_paths` may name at most two style properties. The allowed
   paths are the registry, the kind specs, the style helpers on each side, the
   properties panel (one icon per property) and generated files.
3. **Strokes take a pen.** `SketchWeb.HandDrawn.pen/1` and its client twin
   build a pen from the shape (today its seed), and every stroke function takes
   the pen. Renderers pass it through unchanged, so a new stroke parameter
   changes `pen/1` and the stroke code only.
4. **Boundary contracts are property tests.** Any registry style round-trips
   through `create_element` and `commit_style`, any value outside the registry
   is refused by `style_token/2` and by the action, and any registry style
   round-trips through the clipboard envelope. An envelope copied before a
   property existed pastes with that property's default; an invalid value is
   still rejected.

## Alternatives considered

- **Generate one Ash enum module per property from the registry**: keeps the
  enum types. Rejected: it needs module generation at compile time (a macro or
  `Module.create`), and `:atom` with `one_of` gives the same validation and
  column type.
- **A per-line scan for lists of properties** (like the docs rule): rejected,
  because type specs and templates spread a list over several lines; counting
  per file catches both.
- **Leave the seed positional and add arguments as needed**: rejected, because
  every stroke parameter would touch every renderer on both sides.

## Consequences

A new style property needs the registry entry, the kind specs that take it,
the panel icon and whatever code gives it meaning; nothing that merely lists
properties. The render parity fixtures are byte-identical after this change,
which shows the refactor kept every rendering. A24 can be satisfied by a file
that names exactly two properties for a real reason (such as the note's fill
and stroke); it only rejects lists. Revisit if a property needs per-property
server logic beyond token validation.
