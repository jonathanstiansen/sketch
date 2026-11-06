---
type: ADR
id: "0015"
title: "One mutation layer for board writes"
status: active
date: 2026-11-05
---

## Context

Undo and redo (ADR 0008) replay ordinary commits. Every durable write the canvas hook makes has to
record a history entry with what it changed, or the change cannot be undone. Before this decision
the hook kept the durable pushes, the recording and the replay in about 120 lines of private
methods spread through `assets/js/hooks/canvas.ts`. Every call site happened to use a recording
wrapper, but nothing stopped a new feature from pushing `commit_shape` directly and silently
dropping undo. The replay path could only be exercised in a browser.

Features on the way (arrows bound to shapes, text inside shapes) add more writes, so the cost of a
missed recording grows.

## Decision

`BoardMutations` in `assets/js/hooks/mutations.ts` is the only module that pushes a durable board
event (`SketchWeb.BoardEvents.durable/0`). Its `create`, `createMany`, `erase` and `commit` push
the event and record the undo entry from the server's reply. It owns the `History` and runs undo
and redo, including the queue for steps asked for during a replay. The canvas hook calls it and
supplies a host with `canReplay`, `historyChanged` and `failed`.

A source scan (`durable_push_violations`, CI requirement 12) rejects `pushClientEvent` with a
durable event anywhere in `assets/js` outside `durable_push_paths`, including a call split across
lines.

`assets/test/mutations.test.ts` runs random creates, moves, reshapes, restyles and erases through
the layer against an in-memory fake of BoardLive's replies. It checks that each write does what it
asks, that undoing all of them restores the empty board, and that redoing them restores the same
board.

## Alternatives considered

- **Keep the private methods in the hook and rely on review**: no new file, but a missed recording
  is invisible until someone tries to undo. Rejected: the check costs one scan, and the layer is
  what makes the replay testable without a browser.
- **Compound (transaction) entries now**: one undo step for several writes. Deferred: the arrow
  binding design (next ADR) resolves endpoints at render time, so moving a shape writes only the
  shape and is already one step. A compound entry gets added when a feature needs one, behind
  this same layer.
- **Record on the server**: authoritative, but undo is per view and local (ADR 0008). Rejected.

## Consequences

- A new write is one call to `BoardMutations`, and undo comes with it. A durable push anywhere else
  fails `mix ci`.
- `canvas.ts` loses the push, record and replay code; the hook keeps only the guards that depend on
  gestures and text editing.
- The fake server mirrors BoardLive's reply shapes (`element`, `erased`, `ok`). If those change,
  the fake has to change with them. The LiveView tests of the replies stay the source of truth.
- Re-evaluate if writes need batching on the wire, or if undo ever moves to the server.
