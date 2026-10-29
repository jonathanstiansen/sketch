---
type: ADR
id: "0001"
title: "Consistency via Ash atomic updates (server-ordered LWW register), not a CRDT library"
status: active
date: 2026-10-28
---

## Context

Rectangles are moved concurrently by several browsers. The preferred order was:
a CRDT native to Ash, then an Ash-native mechanism, and only then loosening the
consistency constraint. There is no CRDT extension in the Ash ecosystem. The
only shared state is a position per rectangle, and all writes pass through one
PostgreSQL database.

## Decision

`commit_position` is an Ash update action that sets `x`/`y` and increments
`version` with `atomic_update(:version, expr(version + 1))`, so PostgreSQL
orders commits and the increment cannot be lost. Ash.Notifier.PubSub publishes
the resulting record after the transaction commits. Clients keep the highest
version per rectangle and ignore anything older. Drag previews are ephemeral and
carry `base_version`, so they never override a newer commit.

## Alternatives considered

- **Generic CRDT library (e.g. delta_crdt) beside Ash**: not Ash-native, adds
  replication machinery for a single-node app, and bypasses Ash actions (A03).
  Rejected.
- **Client-side CRDT (Yjs/Automerge)**: excluded by spec, adds a runtime
  dependency (A15) and a second source of truth. Rejected.
- **Optimistic locking that rejects stale writes**: Ash-native, but changes the
  agreed last-write-wins semantics and adds failure UX. Rejected for now.

## Consequences

Each position behaves as a last-write-wins register, which is itself a
state-based CRDT whose merge is "highest version wins", with the server as the
single ordering authority. Concurrent drags can visually disagree until the
next commit, as the spec permits. Revisit if offline editing, multi-node
deployment or richer shared structures (text, groups) are added.

Deleting (added with the Eraser, ADR 0003) extends the register with a
tombstone. `erase` is an Ash destroy; its notification, published after the
transaction commits, carries only `{id, board_id}`. A client records the
erased id, removes the element and ignores every later or earlier-arriving
create or commit for it, so the merge stays order-independent, idempotent and
convergent: the state is the highest version per element that was never
erased. A commit for an erased element cannot succeed, because the row is gone
and the update finds nothing. The cost is that a client's set of erased ids
grows for the life of its LiveView; a reload rebuilds the state from the
database and starts the set empty. Undo would need soft deletes instead of a
hard delete and is still excluded.
