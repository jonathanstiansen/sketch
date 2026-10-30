---
type: ADR
id: "0009"
title: "One keyboard shortcut registry, unique chords per focus context"
status: active
date: 2026-10-30
---

## Context

Shortcuts arrived one feature at a time: the tools (`SketchWeb.Tools`), export
(`SketchWeb.ExportActions`), undo and redo (`SketchWeb.HistoryActions`) and zoom
(`SketchWeb.ZoomActions`), plus Delete, Space, Esc and `?` written as literals in
the canvas hook. Each registry had its own chord format, its own
`aria-keyshortcuts` function and its own client matcher, and nothing compared
one registry's chords with another's. Shift+1 (zoom to fit, by physical key) and
`1` (the Selection tool, by typed character, any Shift) were both bound, and on
layouts where Shift+1 types `1` the second was unreachable. Every new feature
added another registry and another matcher.

## Decision

1. **One aggregate.** `SketchWeb.Shortcuts` collects the shortcuts of every
   registry in `@registries` at compile time. Each registry exposes
   `shortcuts/0` in one entry and chord format (documented in
   `SketchWeb.Shortcuts.Aggregate`); the shortcuts that belong to no feature
   live in `SketchWeb.FixedShortcuts`.
2. **Unique per focus context, checked by the compiler.**
   `SketchWeb.Shortcuts.Aggregate` raises a `CompileError` when two actions
   share a chord in the same context (`canvas` or `editor`), when an action id
   repeats, or when an entry is malformed. Keys compare without case, `KeyE`
   equals `e`, `Digit1` equals `1`, Ctrl/⌘ overlaps Ctrl, and Shift "any"
   overlaps either.
3. **One table and one matcher on the client.** `mix sketch.gen.manifest`
   emits the aggregate as `SHORTCUTS`; `assets/js/hooks/shortcuts.ts` matches a
   key press against it. Hooks ask for the action and never compare key names.
   The per-registry chord fields are no longer in the manifest.
4. **Everything else renders from it.** The shortcuts help, `aria-keyshortcuts`
   and button titles come from the aggregate.
5. **The tool digits match the number-row key without Shift** (`Digit1` to
   `Digit0`), so Shift+1 belongs to zoom to fit on every layout. Tool letters
   still match the typed letter with or without Shift.
6. **A source scan backs it up** (A23): a literal key comparison, LiveView key
   binding or literal `aria-keyshortcuts` outside the allowed files fails
   `mix test`.

## Alternatives considered

- **A test that compares the four registries.** Catches the duplicate but runs
  after the fact, keeps four formats and four matchers, and every new registry
  must remember to join the test. Rejected.
- **Keep per-registry matchers, check only on the server.** The client could
  still match a key the server never declared. Rejected: the client table is
  generated from the same list the check runs on.
- **Strings such as `"Ctrl+Shift+E"`.** Easy to read, but the existing chords
  need key versus physical code, Ctrl-only versus Ctrl/⌘ and "Shift either
  way", which a string would have to encode anyway. Rejected.

## Consequences

- A new shortcut is one entry in a registry and `mix sketch.gen.manifest`; a
  collision fails compilation with both actions and registries named.
- Tool digits no longer react to the numeric keypad or to a digit typed with
  Shift (as on AZERTY); the number-row key works unshifted on every layout.
- The conflict check sees chords as declared. Two chords that collide only on
  some layouts (a physical `Digit1` with Shift and a `!` key chord) are not
  caught. Re-evaluate if layout-specific bugs appear.
