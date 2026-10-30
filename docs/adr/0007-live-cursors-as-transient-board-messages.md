---
type: ADR
id: "0007"
title: "Live cursors as transient board messages"
status: active
date: 2026-10-30
---

## Context

People working on a board cannot tell where the others are looking. The human
lifted the SPEC §2 presence-indicator exclusion on 2026-10-30 (addendum D11) for
live cursors only: each viewer sees the other viewers' pointers with a name
label. User accounts, a "who's online" roster, follow mode and chat stay out.

The forces:

- Cursor positions are even more transient than drag previews (ADR 0001, addendum
  D2): worthless once a newer one exists, and they must never reach the database
  (A10).
- There are no accounts, so a name cannot come from a user. It has to be made up,
  stay the same for one view, and need no storage.
- Cursors must not cross boards (A07).
- A12 bans custom GenServers, registries and `:pg`, and the Phoenix presence
  modules add a tracker process tree and a CRDT of who is present. A roster is
  explicitly excluded, so that machinery would be paid for without being used.
- Pointer event names may only appear in the canvas hook (A13), and no new runtime
  dependency is allowed (A15).
- A cursor drawn in screen coordinates would be wrong as soon as either side
  scrolls; the canvas is 4000 by 4000 and mostly scrolled.

## Decision

1. **The transport is the preview transport.** The canvas hook pushes `cursor`
   `{x, y, seq}` in canvas coordinates (the pointer position relative to the SVG,
   rounded and clamped to the canvas), at most every 50 ms (20 per second, the
   existing `previewDelay`) and only if the position changed. `BoardLive`
   validates integers inside the canvas and a non-negative `seq` with guards,
   adds the sender's identity and relays
   `{viewer_id, name, color, x, y, seq}` with `broadcast_from/4` on the board
   topic, exactly like `preview`. A pointer leaving the canvas or a hidden tab
   pushes `cursor_leave` `{seq}`, relayed as `{viewer_id, seq}`. Both events
   come from one counter per view. Nothing is stored, so a cursor event cannot
   issue a query (the A10 telemetry test covers it).
2. **Identity is derived from a random view id.** `Sketch.Canvas.Viewer.new/0`
   makes a random id at mount; the name (an adjective and an animal, 20 by 20
   fixed words) and the colour are picked from the id with `:erlang.phash2/2`,
   so every browser derives the same label and nothing needs saving. The colour
   is one of the stroke colour tokens of `Sketch.Canvas.Style` (ADR 0006), so
   it has a light and a dark value. The name is not editable. The view shows its
   own name and colour next to the share link, so people know which cursor on
   other screens is theirs.
3. **Receivers keep the newest message per viewer, and forget silent ones.**
   `RemoteCursors` (`assets/js/hooks/cursor_logic.ts`, pure, with the clock
   passed in) drops a message whose `seq` is not newer than the newest message
   or leave seen for that viewer, so reordering cannot move a cursor back or
   revive one that left. A cursor with no message for 2000 ms is removed, the
   timeout of addendum D3, driven by one timer set for the soonest expiry.
   `CursorSender` (same file) holds the throttle, the only-when-moved rule and
   the counter.
4. **Rendering is an ignored SVG layer in canvas coordinates.** `#remote-cursors`
   (`phx-update="ignore"`, `pointer-events="none"`) is the last child of the
   canvas SVG. Each viewer is a group translated to its canvas position holding
   an arrow and a name tag, coloured through a CSS variable set by a class per
   colour token. Scrolling moves the SVG, so the cursor stays on its canvas
   spot with no extra code. An export clones only `#elements > [data-element]`,
   so the layer is outside it like the selection and draw-preview layers.
5. **No process of our own.** Broadcast is the Phoenix PubSub the board already
   uses. No Phoenix.Presence, Phoenix.Tracker, Registry, `:pg` or GenServer.

## Alternatives considered

- **Phoenix.Presence**: tracks who is present and handles leaves on terminate
  itself. Rejected: it starts a tracker process tree (against the spirit of A12),
  carries a roster that is excluded, and tracking metadata at 20 updates per
  second is what Presence is not meant for.
- **Broadcast from the client over a separate channel**: avoids the LiveView
  process. Rejected: a second socket and topic for the same board, and no
  server-side validation.
- **Screen coordinates, positioned in HTML above the viewport**: no SVG layer, but
  every scroll on either side would need a correction. Rejected.
- **A name chosen by the user**: nicer labels. Rejected for this PR (decided in
  the brief): it needs input, validation and somewhere to keep the choice.
- **Keepalive messages for a still pointer**: a stationary pointer would stay
  visible. Rejected: the brief says a cursor is sent only when it moved, and an
  idle cursor disappearing after 2 seconds matches "silent" and keeps traffic
  down.
- **`cursor_leave` handled by `terminate/2`**: rejected as unnecessary, since
  the 2000 ms timeout covers a view that vanished.

## Consequences

Every move costs one LiveView event, one PubSub broadcast and a push to each
other view on the board, up to 20 per second per moving viewer, with no database
work. That is the same order as a drag preview, but many viewers moving at once
multiply it: with ten viewers each view receives up to 180 cursor pushes per
second. There is no rate limit, as for previews (addendum D7).

A viewer who stops moving disappears after 2 seconds and reappears when it moves
again. The view id changes on every mount, so a reconnecting browser appears as a
new viewer with a new name, and its old cursor lingers for up to 2 seconds. The
label width is estimated from the character count, not measured, so a very wide
name may not fill its tag exactly. A cursor near the right or bottom edge of the
canvas has its tag clipped by the SVG.

Revisit if names must be editable or stable across reconnects (they would need
storage or accounts), if a roster is approved (Presence becomes worth its cost),
or if boards with many simultaneous viewers need a lower send rate.
