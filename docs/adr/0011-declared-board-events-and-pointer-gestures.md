---
type: ADR
id: "0011"
title: "Board events and pointer gestures are declared data the code is generated from"
status: active
date: 2026-10-30
---

## Context

The multi-select agent reported that four promises were kept by convention. `group_preview` was
covered by the A10 test because its author added it, so a later relay event could skip the test.
"Selection is never broadcast" (addendum D8) was checked only by E2E assertions on one flow. The
help rows for Shift+click and the marquee were text in a registry, with nothing tying them to
`pointerAction`. Evidence scripts created browser contexts directly, because the scan read `e2e/`
only. Three gaps from the guardrails pass before it were of the same shape: rule IDs per check
category in ARCHITECTURE.md with no check, a process-policy scan limited to three directories, and a
closed list of mock libraries inside the checker.

## Decision

1. **One contract for board events.** `SketchWeb.BoardEvents` declares every event a client may
   push: relay-only events with what they are relayed as, their payload and a valid example, and
   durable events with the `Sketch.Canvas` action they reach. `BoardLive` generates its forwarding
   from it, so a relay that is not declared reaches no other view.
2. **A10 iterates the contract.** One LiveView test per transient event sends its example and
   asserts that it reaches the other view with zero Repo queries.
3. **A parse of `BoardLive` closes the rest.** It fails on a handled, relayed or forwarded event that
   is not declared, a durable event that never reaches its action, a broadcast outside
   `broadcast_preview`, and a handler whose required keys differ from the declared payload.
4. **Client pushes are typed from the contract.** `mix sketch.gen.manifest` emits
   `ClientEventPayloads`, and `pushClientEvent` is the only caller of `pushEvent`. Its type rejects
   an undeclared event and any undeclared field, including one that arrives through a variable or a
   spread, where TypeScript's excess property check does not apply.
5. **Selection state cannot be declared.** The contract raises a `CompileError` for a field or event
   named after selection state, and a parse rejects those names in `BoardLive`'s event code.
6. **Pointer gestures are a table.** Registries declare `pointer_gestures/0`; the aggregate rejects
   two gestures that can match one input, and `pointerAction` only looks up the generated
   `POINTER_GESTURES`. A gesture's optional `help` becomes a help row whose keys and wording are
   derived from its fields, and a chordless help row cannot be written by hand. The Ctrl/⌘ + wheel
   row was the third such row, so the wheel is a gesture too.
7. **Registry data over checker constants.** The mock-library denylist and an exact E2E dependency
   allowlist live in `architecture/rules.exs`, and each rule's `check:` field is compared with the
   rule IDs ARCHITECTURE.md lists per check category.
8. **Script policies scan what git tracks.** The process policy and the browser context check read
   `git ls-files` (plus files not yet added) and identify a script by extension or `#!`, so a new
   top-level directory is covered without a change. Evidence scripts import the one helper from
   `e2e/`, so `e2e_context_paths` stays a single file.

## Alternatives considered

- **A source scan for selection names in `pushEvent` lines.** Simple, but a payload built on another
  line passes. Rejected in favour of the typed contract, keeping a scan only for the server side.
- **A compile-time macro around `broadcast_preview`.** Catches an undeclared literal in the compiler,
  but not a handler that never relays, and its failure is harder to fixture. Rejected for a parse in
  the architecture tests, like the other source checks (ADR 0002).
- **Listing transient events only in the test.** The list would still be separate from the handlers.
  Rejected: forwarding is generated from the declaration, so the feature does not work without it.
- **A second helper for evidence scripts.** Rejected: Node strips the helper's types, as it does for
  the client tests, so the scripts can share the one file.

## Consequences

A new relay event gets the A10 test by being declared, and does not work otherwise. Changing a
gesture's modifier changes behaviour and help together. Examples live in `lib/`, next to the events
they exercise, and the `add-rectangle` phx-click event is declared too although no hook pushes it.
The typed contract closes field names, not their meaning: a list of ids can still hold selected ids
(ARCHITECTURE.md, Known limits). The script scans need a git checkout. Re-evaluate the parse if
`BoardLive` is split into several modules.
