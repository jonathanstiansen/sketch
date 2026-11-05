---
type: ADR
id: "0012"
title: "Presence for the roster and cursor lifetime"
status: active
date: 2026-11-05
---

## Context

ADR 0007 made live cursors transient board messages that disappear after
2000 ms without a message. People read that as cursors vanishing whenever
someone holds still. The human asked for cursors that stay while they are over
the canvas and for a header listing everyone on the board, with a way to go to
someone (addendum D14).

Both need the same thing ADR 0007 did not have: knowing that a viewer is still
on the board without hearing from it. Without a timeout, a cursor from a closed
tab would stay forever unless something notices the view has gone. ADR 0007
rejected Phoenix.Presence because a roster was excluded and named a roster as
the trigger to revisit.

The forces:

- A12 bans our own GenServers, registries and `:pg`. Presence is part of
  Phoenix (no new dependency, A15) and its tracker is Phoenix's process, but it
  does start a supervision tree.
- Cursor moves arrive at up to 20 per second per viewer (ADR 0007). Presence
  metadata is replicated state and must not change at that rate.
- `BoardLive` handles only declared board-topic events (A10, CI requirement 12).
- A viewer who opens the board after someone stopped moving would otherwise see
  nothing until that person moves again, and could not jump to them.

## Decision

1. **`SketchWeb.Presence` tracks every board view** on the board topic, keyed
   by its viewer id, with its name, colour, join time and an `on_canvas` flag.
   `BoardLive` keeps the other viewers in a `:viewers` stream and updates it
   from `presence_diff`, which `SketchWeb.BoardEvents.presence_broadcasts/0`
   declares so the A10 source check still rejects anything undeclared.
2. **`on_canvas` changes only on a transition**: the first `cursor` after a
   leave sets it, `cursor_leave` clears it. Moves update no presence state.
3. **Cursors live until their viewer leaves.** The client's 2000 ms timeout and
   its sweep timer are removed. A cursor goes on `cursor_leave` (pointer left
   the canvas or tab hidden, as before) or on `viewer_left`, which `BoardLive`
   pushes when Presence reports a viewer gone. A viewer that left is never
   shown again, even if a late message arrives. On reconnect the hook clears
   every cursor, since its new view is a new viewer that others re-send to.
4. **Newcomers get resting cursors**: each view remembers its last relayed
   `cursor` and, when Presence reports a viewer it has not seen, broadcasts it
   again through `broadcast_preview`. The `seq` is unchanged, so views that
   already have it drop it and only the newcomer shows it.
5. **Going to a viewer is client-only**: the avatar dispatches
   `sketch:jump-to-viewer` to the canvas hook, which scrolls the viewport to
   centre that viewer's cursor at the current zoom and pulses it. The button is
   disabled while that viewer's `on_canvas` is false.

## Alternatives considered

- **Keepalive cursor messages** (resend the position every second, keep a
  timeout): no new process tree. Rejected: it adds constant traffic for still
  pointers, still needs a timeout, so a closed tab lingers, and a roster built
  on it reimplements Presence badly.
- **`terminate/2` broadcasting a leave**: rejected, because `terminate` is not
  called when the process is killed or the node goes away. Presence notices the
  process exit itself.
- **Presence metadata carrying the cursor position**: newcomers would get
  positions for free. Rejected: it replicates state at 20 updates per second,
  which is what ADR 0007 already ruled out.
- **Follow mode** (keep the viewport on someone): out of scope (addendum D14).
  A jump is one scroll.

## Consequences

The application starts Phoenix's Presence tracker and its task supervisor.
Every join, leave and on/off-canvas transition costs one Presence diff to each
view on the board, which is far fewer messages than the cursor moves. A
newcomer causes one extra cursor broadcast per view that has a cursor on the
canvas.

A cursor resting on the canvas now stays indefinitely, which is the requested
behaviour. A pointer that leaves the window without a `pointerleave` (rare in
browsers) stays until the viewer moves or leaves the board. Names still change
on every mount (ADR 0007).

Revisit for multi-node deployment (Presence replicates across nodes, but the
cursor re-send assumes one node's PubSub ordering), for accounts with stable
identities, or if follow mode is approved.
