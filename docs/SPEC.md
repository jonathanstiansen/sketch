# Collaborative Canvas — Agent Specification v0.2

**Status:** Proposed architectural baseline  
**Objective:** Build a minimal, self-hosted, collaborative canvas with exceptionally strict, mechanically enforced engineering rules.

> Addendum v0.3 decisions (gap resolutions) are in [SPEC-ADDENDUM.md](SPEC-ADDENDUM.md). Where they conflict, the addendum wins.

## 1. Non-negotiable agent contract

Build the smallest complete vertical slices. Preserve all agreed architectural constraints.

An agent MUST NOT modify, weaken, bypass, suppress, or remove a constraint without explicit human approval.

This applies to architectural checks, compiler settings, CI, dependency policies, database constraints, tests and verification requirements.

When blocked, report the failing rule, cause and alternatives. Do not silently work around it.

Every implementation step must end with executed verification commands and observed results.

## 2. Product requirements

The application is a small Excalidraw-like experiment.

Users can:
- Open a collaborative board.
- Create rectangles.
- Drag rectangles with immediate local rendering.
- See other users' movement while dragging.
- See rectangles created by other users.
- Reload and recover completed changes.
- Use unique board URLs to collaborate with others.

The application has no login system.

A board is a persistent collaboration session with a unique UUID, accessible at `/b/:board_id`.

Anyone with network access and the URL can access that board. The URL does not establish authenticated ownership.

Multiple boards must have isolated data and broadcasts.

### Initial exclusions

No resizing, deleting, selection, styling, undo, history, offline editing, user accounts, presence indicators, CRDTs, external message brokers or multi-node deployment.

## 3. Technology

- Elixir / OTP.
- Phoenix and Phoenix LiveView.
- Ash, AshPhoenix and AshPostgres.
- PostgreSQL.
- Phoenix PubSub.
- One minimal TypeScript LiveView hook.
- Playwright.
- Docker Compose.

Use the official Ash installer and conventional generated project structure.

Prefer established Ash/Phoenix functionality to custom infrastructure.

Do not introduce a custom service architecture, GenServer coordinator or separate repository abstraction unless an actual requirement demonstrates the need.

## 4. Domain model

One Ash domain: `Sketch.Canvas`.

Two Ash resources:

**Board**
- UUID primary key.
- `create` action.
- `get` action.

**Rectangle**
- UUID primary key.
- Required `belongs_to :board` relationship.
- Integer `x`, `y`.
- Nonnegative integer `version`, initially zero.
- `create` action.
- `list_for_board` read action.
- `commit_position` update action.

Rectangle size is constant and is not stored.

Rectangle membership of a board cannot change.

Use a database foreign key and constraints for position bounds.

Expose operations through `Sketch.Canvas` code interfaces.

The web layer must not construct arbitrary Ash changesets, bypass actions, or use the Repo directly.

## 5. Real-time collaboration

### Creation and committed changes

Creation and completed movement use Ash actions.

Configure Ash.Notifier.PubSub for board-scoped notifications.

Subscribe only to the active board.

A successful commit increments the rectangle's persisted version atomically.

Committed notifications carry the resulting version. Consumers discard updates older than their known committed version.

No successful committed notification may be emitted for a failed database transaction.

### Drag previews

The client renders local pointer movement immediately.

A minimal hook sends throttled previews over LiveView, using Phoenix PubSub to reach other clients.

Previews are:
- Ephemeral.
- Best-effort.
- Scoped to the active board.
- Throttled to at most 20 updates per second per active drag.
- Associated with a drag identifier and sequence number.
- Never written to PostgreSQL.

Reconnection discards uncommitted previews and reloads an authoritative Ash snapshot.

A completed drag persists its final position using `commit_position`, independently of whether intermediate previews were delivered.

### Concurrent edits

PostgreSQL determines the ordering of successful durable commits. The final persisted position is last-write-wins.

The persisted version is atomically incremented for each successful commit.

Concurrent in-progress drags have no global total-order guarantee. Their visual previews may temporarily disagree.

The current milestone does not require sophisticated reconciliation of simultaneous active drags, drag ownership or locks.

Tests must confirm that completed commits preserve the database revision invariant and that clients recover the authoritative result after refresh.

If simultaneous dragging proves problematic, document it as a measured limitation before proposing additional coordination.

## 6. Architectural constraints

The following are mandatory. Each rule must have an explicit verification mechanism, and where mechanical verification is feasible, a negative test proving the check fails when violated.

| ID | Rule | Verification |
|---|---|---|
| A01 | Domain operations exposed through Ash code interfaces | Static dependency check |
| A02 | No Repo, Ecto SQL or Postgrex access from web modules | Static architecture check |
| A03 | No direct resource mutation outside declared Ash actions | Static check + tests |
| A04 | Board and Rectangle use AshPostgres | Resource configuration test |
| A05 | Every Rectangle belongs to exactly one Board | Ash validation + database FK |
| A06 | Board membership is immutable | Action restrictions + tests |
| A07 | All board queries and events are scoped to the selected board | Integration/E2E tests |
| A08 | Invalid coordinates cannot be persisted | Ash + database constraints |
| A09 | Durable movement increments version atomically | Concurrent integration test |
| A10 | Transient previews never trigger persistence | Instrumented integration test |
| A11 | Durable events originate from successful Ash changes | Action notification tests |
| A12 | No custom GenServer/event broker/repository layer | Structural check + dependency policy |
| A13 | Client pointer behaviour lives in the designated hook | File/module policy |
| A14 | TypeScript strict mode; no `any` or TS suppression directives | TypeScript + ESLint |
| A15 | No production runtime dependency added without approval | Dependency diff policy |
| A16 | No unreviewed change to enforcement code or CI policies | Protected branch + required review |
| A17 | Database resource definitions match generated migrations | Ash migration check |
| A18 | No mocked database or collaboration transport in E2E tests | Test dependency policy |
| A19 | All accepted rules remain active until explicitly changed | Architecture rule registry + protected review |
| A20 | No arbitrary fixed sleeps in E2E tests | Static test check |

Start with conventional Mix, Ash, Credo and Dialyzer tooling.

Use the smallest dedicated architecture check capable of enforcing the forbidden dependencies. Validate it with deliberately failing fixture tests.

Do not install the Boundary package by default.

If standard tooling cannot reliably enforce an approved rule, report the gap and propose a specialized tool. Do not silently downgrade the rule to documentation.

## 7. Tracer-bullet implementation gates

### Gate 0 — Enforced foundation

Generate the Ash/Phoenix application and set up PostgreSQL, CI and architecture checks.

Verify strict compilation, formatting, Credo, Dialyzer, migration consistency and architecture enforcement.

Introduce intentional violations to prove checks fail.

**Done when:** the repository rejects known structural mistakes before implementing product features.

### Gate 1 — First end-to-end collaboration tracer

Use one seeded board, already identified by a UUID and board-scoped URL, for the tracer's manual run. Automated E2E tests create a board per test (addendum D7).

Create rectangles through an Ash action.

Show new rectangles in two real browser contexts using Ash notifications.

Verify browser → LiveView → Ash → PostgreSQL → PubSub → second browser.

**Done when:** creation is genuinely collaborative, durable and browser-tested.

### Gate 2 — Unique collaboration sessions

Implement creation of new boards and navigation to their unique URLs.

Verify:
- Two boards have distinct URLs and identifiers.
- Rectangle creation is scoped to the selected board.
- Subscribers to another board receive no unrelated board events.
- Cross-board rectangle updates are rejected: `commit_position` runs against the board the client is subscribed to, and a rectangle id from another board is refused.
- Reloading a board preserves its state.
- Invalid board URLs do not silently create boards.

**Done when:** users can create an isolated collaboration session and share its URL.

### Gate 3 — Live dragging

Implement the minimal client hook.

Verify:
- Local drag renders immediately.
- Remote browser observes movement before pointer release.
- Final position is persisted via Ash.
- Refresh restores the committed position.
- Interrupted drags do not falsely report completion.
- Reconnection restores authoritative state.
- Transient updates do not generate database writes.

**Done when:** actual live collaboration works.

### Gate 4 — Concurrent persistence and failures

Verify:
- Concurrent commits increment versions without lost increments.
- Final persisted state follows PostgreSQL commit ordering.
- Older committed notifications cannot overwrite newer state.
- Failed commits do not send success notifications.
- Restart preserves completed positions.
- Ten concurrent browser connections can operate.

Simultaneous in-progress drag visuals are not required to be perfectly ordered. Record any observed inconsistency.

**Done when:** durable consistency guarantees and failure semantics are demonstrated.

### Gate 5 — Deployment and measurement

Create a self-hosted Docker Compose environment with one application and one PostgreSQL instance.

Verify:
- Clean startup and automatic health checks.
- Correct migration procedure.
- Persistent database volume.
- Two-browser E2E against the deployed application.
- Restart and container recreation preserve durable changes.
- PostgreSQL is not exposed through a public host port.
- Application binding is configurable and limited to the intended network.

Record p50, p95 and p99 collaboration latency and the test environment. No hard performance target yet.

## 8. Required CI

Every PR must run:

1. Formatting, strict compilation, Credo and Dialyzer.
2. TypeScript strict compilation and ESLint.
3. Architecture checks and negative enforcement tests.
4. Ash migration consistency.
5. Unit and PostgreSQL integration tests.
6. Real two-browser Playwright tests.
7. Docker Compose production-build/deployment smoke tests.

No gate may be skipped to merge.

Use deterministic test setup and assertions based on observed state, rather than arbitrary waits.

## 9. Architectural change policy

Store approved invariants in `ARCHITECTURE.md`. The machine-readable registry of enforced rules and their tests lives in `architecture/rules.exs`.

Keep agent instructions and framework usage rules synchronized using UsageRules.

Protect architectural policy, CI configuration, dependency configuration and enforcement tests using repository permissions and required human review.

Any proposed relaxation must document:
- The rule being changed.
- Why the existing design is inadequate.
- Evidence from a failing test, measured performance or real implementation obstacle.
- At least one option preserving the rule.
- The proposed alternative and its consequences.
- Explicit human approval.

The agent cannot authorize its own architectural changes.

## 10. Definition of done

Two real browsers can collaborate on a board, create and drag rectangles, and recover completed positions after restart.

Different collaboration links identify independent boards.

The application is self-hosted using Docker Compose.

All architectural, functional and deployment CI gates pass.

Known concurrent-drag limitations and observed latency distributions are documented.

No architectural constraints have been silently weakened.
