---
type: ADR
id: "0018"
title: "Each view batches the cursors it receives"
status: active
date: 2026-11-06
---

## Context

Each board view relayed every cursor update straight to every other view with `broadcast_from`
(ADR 0007), and each receiving view pushed it to its browser as its own event, with its own render
and WebSocket frame. With N people moving at the client's rate of 20 updates a second, a board
produced 20 × N × (N − 1) of those pushes a second. The load test in `docs/CAPACITY.md` showed one
board was fine at 80 people, slow at 160 and collapsing at 240, where undelivered relays queued in
the views' mailboxes until the node held gigabytes. Nothing limits how many people open a board, so
one crowded board could exhaust memory for every board on the node.

## Decision

The sender still relays each move or leave with `broadcast_from`, now as one `cursors` broadcast
whose payload is a single entry: the cursor, or `{viewer_id, seq, left: true}` for a leave. A
receiving view keeps only the latest entry per viewer, by `seq`, in its socket's private state, and
pushes the pending entries to its browser as one `cursors` event at most once every 16 ms, about
one screen frame. The first entry after a quiet window goes out at once. The browser applies each
entry through `RemoteCursors`, which already ignores an entry that is not newer than what it has
seen for that viewer, and ignores every entry for a viewer who has left.

## Alternatives considered

- **One relay process per board** that collects every move and broadcasts one batch per tick: the
  only option that makes the messages between views grow linearly with the board's size. Rejected
  for now: A12 forbids a custom GenServer and Registry in `lib`, and the rule stays unless a human
  changes it.
- **A 50 ms window**, the client's own send interval: measured the same capacity as 16 ms, with
  about twice the added latency. Rejected.
- **Cap the number of people per board, or the number whose cursors are shared**: a hard guarantee,
  but it turns people away or hides them. Deferred: a product decision, needed only if boards
  reach the limit measured below.
- **Batch drag and draw previews too**: they use the same relay, but only people dragging send
  them, and they interleave with durable commits whose order matters. Deferred until a measurement
  shows previews limit a board.

## Consequences

Measured with `tools/load/load.ts` against a release, one board with everyone moving:

| People | Before: p99, CPU | After: p99, CPU |
| --- | --- | --- |
| 10 | 3 ms, 1% | 20 ms, 0% |
| 80 | 12 ms, 13% | 23 ms, 6% |
| 160 | 125 ms, 42% | 32 ms, 15% |
| 240 | 3.5 s, 52%, 3.5 GB queued | 60 ms, 28%, 0.8 GB |
| 320 | not run | 1 s, 45%, 2.7 GB queued |

One board now holds about twice as many active people at a third of the CPU. Each cursor update
can wait up to 16 ms for its batch; ADR 0007's 50 ms client throttle already dominates what people
see. Many small boards behave as before (3,000 people on 600 boards, 25% CPU).

The views of a board still exchange N × (N − 1) messages, so one board still collapses, at about
300 active people instead of about 160, and the collapse can still exhaust the node's memory.
Re-evaluate, with the per-board relay (which needs an A12 change) or a cap, if boards approach
that size.
