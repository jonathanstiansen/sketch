# Architecture rules

This file explains the approved invariants from [docs/SPEC.md](docs/SPEC.md) section 6 and
[docs/SPEC-ADDENDUM.md](docs/SPEC-ADDENDUM.md). The machine-readable registry is
[architecture/rules.exs](architecture/rules.exs): every rule's ID, status
(`:enforced`, `{:pending, gate}` or `:unverified`), what enforces it and which files verify it.
The registry also holds every allowlist, each entry with its justification.

Changing a rule, a status, an allowlist or any enforcement code follows the change policy in
SPEC section 9 and needs explicit human approval. `.github/CODEOWNERS` routes those files to the
reviewer.

## How the rules are enforced

All architecture checks are ExUnit tests in `test/architecture/`, run by `mix test` (and so by
`mix ci` and CI). They use one checker, `Sketch.ArchitectureCheck` in
`test/support/architecture_check.ex`, which only uses OTP and the standard library:

- **Compiled code (A01, A02, A03, A12)**: reads the BEAM files of modules whose source is in `lib/`.
  OTP `:xref` gives remote call edges; the BEAM atom table catches references that are not calls
  (for example passing `Sketch.Repo` around as a value); module attributes give declared behaviours.
- **Source files (A13, A18, A20, A21, A22)**: line-based scans of the relevant source trees.
- **Dependencies (A15)**: the production deps from `mix.exs` and the `dependencies` of
  `assets/package.json` and `e2e/package.json` must equal the allowlist exactly.
- **TypeScript (A14)**: `tsc` and ESLint run in CI; a test asserts the resolved compiler and ESLint
  settings and runs both tools against violating fixtures.

Every mechanical rule has a negative test: the same checker runs against deliberately violating
fixtures in `test/architecture/fixtures/` and must report that rule ID. BEAM fixtures are compiled
into a temporary directory during the test, never into the application. The fixtures directory is
the only path excluded from the A21 scan.

## Rules

| ID | Rule | Status |
|---|---|---|
| A01 | Domain operations go through `Sketch.Canvas` code interfaces. Web modules may call no application module in the `Sketch` namespace other than `Sketch.Canvas`. | Enforced |
| A02 | Web modules do not call or reference `Sketch.Repo`, Ecto, Postgrex, AshPostgres or Ash data layers. | Enforced |
| A03 | No resource mutation outside Ash actions. Web modules do not call the `Ash` API or build `Ash.Changeset`/`Ash.Query`/`Ash.ActionInput`; no `lib` module except `Sketch.Repo` calls the Repo, Ecto or Postgrex directly. Action-level tests come with the resources. | Enforced (static) |
| A04 | Board and Element use AshPostgres. | Enforced |
| A05 | Every Element belongs to exactly one Board. | Enforced |
| A06 | Board membership is immutable. | Enforced |
| A07 | Queries and events are scoped to the selected board. | Enforced |
| A08 | Invalid coordinates and sizes cannot be persisted (addendum D1, D8): `x, y >= 0`, `width, height >= 1` (`>= 0` for point kinds such as lines, arrows and freehand strokes), `x + width` and `y + height` within the canvas, a line or arrow's two points, or a freehand stroke's 2 to 500 points, inside its box, and text only on text and note elements, at most 2000 code points and non-blank for text (ADR 0003). `Sketch.Canvas.Geometry` holds the bounds; the `FitsCanvas`, `PointsFitShape` and `TextFitsKind` validations (atomic, so they also check stored values during updates), the code-point `max_length` on `text` and PostgreSQL CHECK constraints all derive from it, and property tests compare Ash and raw SQL over arbitrary boxes, points and strings. | Enforced |
| A09 | Durable movement and resizing increment `version` atomically (ADR 0001, ADR 0003). `commit_position` and `commit_shape` use `atomic_update(:version, expr(version + 1))`; a non-sandboxed test runs 50 interleaved moves and resizes across 25 concurrent connections and requires versions `1..50` with no duplicates and a stored box equal to the commit that returned version 50. | Enforced |
| A10 | Transient previews never trigger persistence. Previews and cancels are relayed with `SketchWeb.Endpoint.broadcast_from/4`; an instrumented LiveView test asserts they cause zero Repo queries. | Enforced |
| A11 | Durable events originate from successful Ash changes. | Enforced |
| A12 | No custom GenServer, event broker or repository layer: no `lib` module implements GenServer, `:gen_server`, `:gen_statem`, `:gen_event` or GenStage, uses Agent, Registry or `:pg`, or is named `*Repository*`. | Enforced |
| A13 | Pointer, mouse and touch event names appear only in `assets/js/hooks/canvas.ts`, the `Canvas` LiveView hook. The scan covers `assets/js` and `lib` (colocated hooks and templates). | Enforced |
| A14 | TypeScript strict mode with `noUncheckedIndexedAccess`; ESLint bans `any` and TS suppression comments and disables inline config. | Enforced |
| A15 | Production runtime deps equal the allowlist (addendum D4). | Enforced |
| A16 | Enforcement code and CI changes need review. | Unverified (addendum D6) |
| A17 | Resource definitions match generated migrations (`mix ash.codegen --check`). | Enforced |
| A18 | E2E tests use no request interception or mock libraries. | Enforced |
| A19 | Accepted rules stay active until explicitly changed. The registry test requires A01-A22 exactly once with valid statuses and existing verification files. | Unverified (addendum D6) |
| A20 | E2E tests contain no fixed sleeps (`waitForTimeout`, `setTimeout`, `sleep(`). | Enforced |
| A21 | No suppression directives for ESLint, TypeScript, Credo or Dialyzer and no Dialyzer ignore file (addendum D5). | Enforced |
| A22 | Kind-specific branching lives only in kind modules (`lib/sketch/canvas/kinds/`), element renderers (`lib/sketch_web/elements/`, `assets/js/elements/`) and generated files (`assets/js/generated/`) (ADR 0004). The scan of `lib` and `assets/js` rejects `kind == :x` and `kind === "x"` (either order, negated), `kind in [`, `kind: :x`, `data-kind="x"` and `dataset.kind` comparisons for any element kind. There is no per-file exception: a test requires the allowed paths to be exactly those four directories. The canvas hook reads per-kind behaviour (geometry, text, `draw_gesture`, default size) from the specs in the generated manifest, never from kind ids. Element kinds are declared once in `Sketch.Canvas.Kinds`, which fails to compile if a draw gesture cannot produce its kind's geometry; `SketchWeb.Tools` fails to compile if a tool creates an unknown kind, and `mix sketch.gen.manifest --check` fails `mix ci` and CI if `assets/js/generated/manifest.ts` is stale. Renderers are forced equal: `SketchWeb.Elements` fails to compile unless its renderers cover exactly the registered kinds, the client `RENDERERS` table `satisfies Record<ElementKind, Renderer>` (so `tsc` fails if either side lacks one), `mix sketch.gen.render_fixtures --check` fails `mix ci` and CI if `assets/test/fixtures/render_parity.json` or `wrap_parity.json` is stale, and `assets/test/render_parity.test.ts` and `wrap_parity.test.ts` fail if a client renderer draws a different node tree from the server for any fixture shape, or the client wraps a fixture text into different lines. | Enforced |

## Element kinds

ADR 0004 is complete: every kind is a spec module in `lib/sketch/canvas/kinds/`, rendered by one
server and one client renderer in local coordinates, and the canvas hook has no kind-specific
code. Adding a kind takes:

1. A spec module `lib/sketch/canvas/kinds/<kind>.ex` and its line in `Sketch.Canvas.Kinds`.
2. A server renderer `lib/sketch_web/elements/<kind>.ex` and its line in `SketchWeb.Elements`.
3. A client renderer `assets/js/elements/<kind>.ts` and its entry in `RENDERERS`
   (`assets/js/elements/index.ts`).
4. A tool entry in `SketchWeb.Tools`.
5. `mix sketch.gen.manifest` and `mix sketch.gen.render_fixtures` (both outputs are committed and
   checked in CI), and `mix ash.codegen` if the kind holds text or points, because the CHECK
   constraints list those kinds.
6. CSS for any new class, and tests.

Leaving out step 1, 2, 3 or 4 fails compilation or `tsc`; a stale step 5 fails `mix ci`.

## Known limits

- A22 is a line-based scan of direct forms. A kind compared through a variable built at runtime, a
  `case` on the kind or a kind name split across lines is not seen; code review covers those, and
  the negative fixture covers each direct form.
- The `elements` CHECK constraints list point kinds in the order the existing migration was
  generated with (`line`, `arrow`, `freedraw`), not registry order. `Element` keeps that order so the
  SQL text, and therefore `ash.codegen --check`, does not change; a new point kind is appended.
- Render parity is checked on a fixed set of shapes per kind (sizes 0, 1, 2, 119, 120, 3999 and
  4000 in both directions, plus point sets and texts derived from the kind's spec; text kinds use
  widths around the note's wrapping boundaries instead). Note wrapping is also compared on 885
  deterministic (text, width) pairs. Two implementations that agree on all of them but differ
  elsewhere are not caught. Odd and even sizes are both included,
  so a renderer that halves a size is checked on whole and fractional results.

- The BEAM checks see static calls and module references. A module name built at runtime (for
  example with `Module.concat/1` or `String.to_existing_atom/1`) would not be seen. Code review
  covers that case; Credo and the atom-table check make it unusual enough to stand out.
- A16 and A19 depend on repository settings the code cannot enforce: a ruleset on `main` requiring
  a pull request, passing CI and CODEOWNERS review, with agents pushing under an identity distinct
  from the reviewer. Until a human enables that, both are reported as unverified in every PR.
- Element has an unscoped primary `read` action because the atomic `commit_position` update
  and the `erase` destroy look the record up through it. A07 still holds: every code interface
  that writes takes the board id (`get_by: [:id, :board_id]`), no code interface exposes that read and web
  modules can only call `Sketch.Canvas`. A follow-up will add an actor and Ash policies so the
  scoping no longer depends on the code interface alone.
- The A10 test watches Repo queries issued by the LiveView processes that handle previews. A
  preview handler that delegated persistence to another process (for example `Task.start/1`)
  would not be seen by it. The E2E reload checks and code review cover that case.
- The A09 test must not use the SQL sandbox, which serialises everything through one connection.
  It runs `async: false`, uses `Ecto.Adapters.SQL.Sandbox.unboxed_run/2` in every task and deletes
  its board in `on_exit`. The test pool is `System.schedulers_online() * 2` connections (20 here),
  so the 25 concurrent tasks do contend for connections.
- E2E runs with one worker. The restart test spawns a second dev server, whose asset watchers
  rewrite `priv/static` and trigger LiveReload in every open browser page; parallel workers made
  that reload land mid-drag. The restart test also waits for the spawned server's asset watchers to
  finish before opening a page.
- Simultaneous drags of one element can show different positions in different browsers until
  both commits land. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for the measurements.
- SPEC section 8 item 7 (Docker Compose deployment smoke test) is the `compose-smoke` job in
  `.github/workflows/ci.yml`; the registry lists it under `ci_requirements`. It builds the image,
  starts `compose.yaml`, checks health, that PostgreSQL publishes no host port, runs the E2E
  suite against the container and checks persistence across restart, recreation and `down`/`up`.
  It is `:enforced` by CI only. The container steps have not been run locally (Docker was not
  available when Gate 5 was written); the release, migration, health check, binding and E2E were
  verified against a native `mix release`.
