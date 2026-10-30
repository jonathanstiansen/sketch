---
type: ADR
id: "0008"
title: "Undo and redo, local to each viewer and replayed as ordinary commits"
status: active
date: 2026-10-30
---

## Context

People make mistakes on a board and expect Ctrl+Z to take them back. The human
lifted the SPEC §2 **undo** and **history** exclusions on 2026-10-30 (addendum
D12) for one thing: each viewer can undo and redo their own actions. A shared
or global history, version browsing and time travel stay excluded.

The forces:

- ADR 0001 makes each element a server-ordered last-write-wins register, and an
  erase a permanent tombstone: every client ignores every later create or commit
  for an erased id. Undo must not need a second merge rule, and it must not
  bring an erased id back, or replicas would disagree about it.
- `erase` is a hard delete (ADR 0003). There is no row left to restore.
- Several people edit one board at once. Someone else may move, restyle or
  erase an element after I changed it, and my undo must not leave the replicas
  disagreeing.
- Undo is per viewer. Nothing about it needs to reach the database or the other
  views beyond the commits it makes.
- Pointer listeners stay in the canvas hook (A13), kind ids are only compared
  in kind modules (A22), and no runtime dependency is added (A15).

## Decision

1. **The history is local and per view.** The canvas hook keeps an undo stack
   and a redo stack of this view's own completed actions: a create (drawing,
   typing or the Add rectangle button), a move, a resize or endpoint drag, a
   text edit, a style change, and an erase, where one eraser stroke that erases
   several elements is one entry. An action is recorded only when the server
   reports it succeeded: `create_element` replies with the created element,
   `erase` with the erased elements as they were, and the three commits with
   `ok`. Add rectangle, which does not come from the hook, pushes `created`
   with the element to the clicking view only. The stacks are not stored, so a
   reload starts them empty.
2. **Every undo and redo is an ordinary action.** The hook replays it through
   the same LiveView events and code interfaces as a gesture: `commit`
   (`commit_position`), `commit_shape`, `commit_style`, `erase`
   (`erase_element`) and `create_element`. Each is a normal commit with the
   atomic version increment of ADR 0001, published by Ash after it commits.
   `BoardState` and the merge rule do not change, and there is no new action.
3. **Inverses.** A create is undone by erasing the element. A move, resize,
   endpoint drag or text edit is undone by committing the values it replaced:
   each entry stores the committed values before and after. A style change is
   undone by committing the previous token. An erase is undone by creating the
   element again with the same kind, box, points, text, style and seed, under a
   **new id**, since the old id is a tombstone forever. The stacks map every
   original id to its current one, so later entries for the element keep
   working after its erase is undone and redone.
4. **Conflicts: last writer wins.** Before replaying an entry the hook checks
   whether its element was erased (the view learns every erase from the
   `erased` push). If it was, by someone else, the entry is dropped and the view
   says "Can't undo: erased by someone else" (or redo). Nothing is resurrected.
   If someone else changed the element after me, undo still commits my previous
   values as a new version, which wins as the latest write, exactly as if I had
   dragged it back by hand. An entry whose replay fails on the server is also
   dropped.
5. **Redo is cleared by any new local action.** Two style changes of the same
   element and property within 500 ms coalesce into one entry, so clicking
   through colours is one step. Nothing else coalesces.
6. **Keys and buttons.** Ctrl/⌘+Z undoes; Ctrl/⌘+Shift+Z and Ctrl+Y redo.
   They do nothing while a text editor or another input has focus, so the
   browser's own text undo works there, and nothing while a gesture or an
   undo is in progress. Undo and Redo buttons in the toolbar do the same and
   are disabled when their stack is empty. The chords live in one registry,
   `SketchWeb.HistoryActions`, rendered into the shortcuts help and copied to
   the client manifest.
7. **The stack logic is pure.** `assets/js/hooks/history_logic.ts` holds the
   stacks, the id map, the dropping of erased entries and the coalescing, with
   the clock passed in, and is tested with fast-check models. The hook only
   records entries, runs the replay a step asks for and reports the result.

## Alternatives considered

- **Soft deletes, so an undone erase restores the same row and id**: keeps ids
  stable. Rejected: every query, the CHECK constraints and the tombstone rule of
  ADR 0001 would change, and a restored id would be ignored by every client
  that saw the erase, so the merge rule would need a resurrection case.
- **A shared, server-side history (one stack per board)**: one undo for
  everyone. Rejected: excluded by the human (addendum D12), and it would need
  state outside Ash actions or a history table.
- **Undo as a new merge rule (for example a "revert to version n" event)**:
  rejected. Replicas would have to agree on what version n was, and the tombstone
  and highest-version rules would no longer be the whole merge.
- **Refusing an undo when someone else changed the element after me**:
  rejected for now. It needs the version I last saw per entry and a refusal
  message on every concurrent edit; last writer wins is the agreed semantics.
- **Keeping the history on the server, per LiveView process**: survives
  nothing a client-side stack would not lose (both die with the view) and
  adds round trips to every keypress. Rejected.

## Consequences

Undo costs nothing new on the server: every step is one ordinary commit, create
or erase, with the same validation, version increment and broadcast. Other views
cannot tell an undo from a hand-made change.

An undone erase gives the element a new id, so it is drawn on top of the
elements created since (creation order is z-order, addendum D10), and anything
outside this view's stacks that kept the old id, such as another view's
selection, loses it. An undo can overwrite a newer change by someone else; that
is the last-writer-wins rule, not a merge. Entries for elements erased by someone
else are dropped one at a time, each with a message. The stacks live as long as
the LiveView: a reload, a new tab or a crash of the view clears them, while the
board itself stays correct. A reconnect keeps them, since the hook survives it.

Revisit if people need to undo across reloads (the stacks would need storage),
if undo should refuse rather than overwrite concurrent changes, or if a
shared history is approved.
