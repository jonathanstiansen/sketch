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
- **Source files (A13, A18, A20, A21)**: line-based scans of the relevant source trees.
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
| A04 | Board and Rectangle use AshPostgres. | Pending, Gate 1 |
| A05 | Every Rectangle belongs to exactly one Board. | Pending, Gate 1 |
| A06 | Board membership is immutable. | Pending, Gate 2 |
| A07 | Queries and events are scoped to the selected board. | Pending, Gate 2 |
| A08 | Invalid coordinates cannot be persisted (addendum D1). | Pending, Gate 1 |
| A09 | Durable movement increments `version` atomically (ADR 0001). | Pending, Gate 4 |
| A10 | Transient previews never trigger persistence. | Pending, Gate 3 |
| A11 | Durable events originate from successful Ash changes. | Pending, Gate 1 |
| A12 | No custom GenServer, event broker or repository layer: no `lib` module implements GenServer, `:gen_server`, `:gen_statem`, `:gen_event` or GenStage, uses Agent, Registry or `:pg`, or is named `*Repository*`. | Enforced |
| A13 | Pointer, mouse and touch event names appear only in `assets/js/hooks/canvas.ts`. The scan covers `assets/js` and `lib` (colocated hooks and templates). | Enforced |
| A14 | TypeScript strict mode with `noUncheckedIndexedAccess`; ESLint bans `any` and TS suppression comments and disables inline config. | Enforced |
| A15 | Production runtime deps equal the allowlist (addendum D4). | Enforced |
| A16 | Enforcement code and CI changes need review. | Unverified (addendum D6) |
| A17 | Resource definitions match generated migrations (`mix ash.codegen --check`). | Pending, Gate 1 (the check already runs) |
| A18 | E2E tests use no request interception or mock libraries. | Enforced |
| A19 | Accepted rules stay active until explicitly changed. The registry test requires A01-A21 exactly once with valid statuses and existing verification files. | Unverified (addendum D6) |
| A20 | E2E tests contain no fixed sleeps (`waitForTimeout`, `setTimeout`, `sleep(`). | Enforced |
| A21 | No suppression directives for ESLint, TypeScript, Credo or Dialyzer and no Dialyzer ignore file (addendum D5). | Enforced |

## Known limits

- The BEAM checks see static calls and module references. A module name built at runtime (for
  example with `Module.concat/1` or `String.to_existing_atom/1`) would not be seen. Code review
  covers that case; Credo and the atom-table check make it unusual enough to stand out.
- A16 and A19 depend on repository settings the code cannot enforce: a ruleset on `main` requiring
  a pull request, passing CI and CODEOWNERS review, with agents pushing under an identity distinct
  from the reviewer. Until a human enables that, both are reported as unverified in every PR.
- SPEC section 8 item 7 (Docker Compose deployment smoke test) is pending until Gate 5; the
  registry lists it under `ci_requirements`.
