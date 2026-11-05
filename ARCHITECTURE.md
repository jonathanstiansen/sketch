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
- **Source files (A10, A13, A18, A20, A21, A22, A23)**: line-based scans of the relevant source trees,
  and for A10 a parse of `SketchWeb.BoardLive` against `SketchWeb.BoardEvents`.
- **Docs (CI requirement 10)**: no line of a living doc (every Markdown file at the root and directly
  in `docs/`, and `architecture/rules.exs`; the specification is exempt) names two or more shortcut
  registries, both focus contexts, or three or more element kinds, tools, style tokens or shortcut
  groups in code form. A doc refers to the registry instead, so adding a registry, kind or token
  never leaves a stale list behind.
- **Browser contexts (CI requirement 11)**: every Playwright browser context, in E2E tests and
  evidence scripts alike, comes from `e2e/tests/support/contexts.ts`, which adds the shared options
  (the clipboard permissions) that `playwright.config.ts` also uses; a scan of every tracked script
  rejects `.newContext(`, `.launchPersistentContext(` and `browser.newPage(` anywhere else.
- **Processes (CI requirement 9)**: a line-based scan of every tracked script (`git ls-files` plus
  files not yet added, by extension or a `#!` first line, except `deps`, `_build`, `node_modules` and
  `script_scan_exempt_paths`) and of the exec blocks of every tracked `DEMO.md`: no `pkill`, no
  `killall` and no `kill` whose target is not a PID variable (`kill "$pid"`, `kill -9 $server`,
  `kill $!`). A script stops only the processes it started.
- **Board events (CI requirement 12)**: every event a board client pushes is declared in
  `SketchWeb.BoardEvents` and goes through `pushClientEvent`, typed from the generated
  `ClientEventPayloads`, so `tsc` rejects an undeclared event or field. The contract refuses a field
  naming selection state at compile time; a scan rejects a raw `pushEvent` outside
  `client_push_paths`, and a parse of `SketchWeb.BoardLive` rejects selection names in its event code
  (addendum D8).
- **Pull request evidence (CI requirement 13)**: the `pr-evidence` workflow passes the pull request
  description to `.github/scripts/check_pr_evidence.sh` through the `BODY` environment variable and
  fails unless it holds a Markdown image, an `<img>` or `<video>` tag, a GitHub attachment URL or a
  link to an image or video file. It is its own workflow so that it re-runs when the description is
  edited without touching the `ci.yml` jobs; `.github/pull_request_template.md` prompts for the
  evidence.
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
| A07 | Queries and events, including live cursors, are scoped to the selected board. | Enforced |
| A08 | Invalid coordinates and sizes cannot be persisted (addendum D1, D8): `x, y >= 0`, `width, height >= 1` (`>= 0` for point kinds such as lines, arrows and freehand strokes), `x + width` and `y + height` within the canvas, a line or arrow's two points, or a freehand stroke's 2 to 500 points, inside its box, text only on text and note elements, at most 2000 code points and non-blank for text (ADR 0003), a `seed` in `0..2_147_483_647` (addendum D9, ADR 0005), and style tokens from `Sketch.Canvas.Style`, with every property that does not apply to the kind at its default (addendum D10, ADR 0006). `Sketch.Canvas.Geometry` holds the bounds; the `FitsCanvas`, `PointsFitShape` and `TextFitsKind` validations (atomic, so they also check stored values during updates), the code-point `max_length` on `text` and PostgreSQL CHECK constraints all derive from it, and property tests compare Ash and raw SQL over arbitrary boxes, points, strings and seeds. | Enforced |
| A09 | Durable movement, resizing and restyling increment `version` atomically (ADR 0001, ADR 0003, ADR 0006). `commit_position`, `commit_shape` and `commit_style` use `atomic_update(:version, expr(version + 1))` and each writes only its own attributes; a non-sandboxed test runs 50 interleaved moves, resizes and restyles across 25 concurrent connections and requires versions `1..50` with no duplicates, a stored row equal to the commit that returned version 50, and the box and style of the last box and last style commit. Undo and redo are replays of these actions (ADR 0008), checked by a second interleaved test of moves and their undos. | Enforced |
| A10 | Transient previews never trigger persistence. Previews, cancels and live cursors (addendum D11, ADR 0007) are relayed with `SketchWeb.Endpoint.broadcast_from/4`. `SketchWeb.BoardEvents.transient/0` declares every relay-only event with a valid example; `SketchWeb.BoardLive` forwards only what it declares, and an instrumented LiveView test sends every example and asserts it reaches the other view with zero Repo queries. A parse of `BoardLive` fails if it relays, forwards or handles an undeclared event, if a durable event never reaches the `Sketch.Canvas` action it names, or if anything but `broadcast_preview` broadcasts (ADR 0011). | Enforced |
| A11 | Durable events originate from successful Ash changes. | Enforced |
| A12 | No custom GenServer, event broker or repository layer: no `lib` module implements GenServer, `:gen_server`, `:gen_statem`, `:gen_event` or GenStage, uses Agent, Registry or `:pg`, or is named `*Repository*`. | Enforced |
| A13 | Pointer, mouse and touch event names appear only in `assets/js/hooks/canvas.ts`, the `Canvas` LiveView hook. The scan covers `assets/js` and `lib` (colocated hooks and templates). | Enforced |
| A14 | TypeScript strict mode with `noUncheckedIndexedAccess`; ESLint bans `any` and TS suppression comments and disables inline config. | Enforced |
| A15 | Production runtime deps equal the allowlist (addendum D4). | Enforced |
| A16 | Enforcement code and CI changes need review. | Unverified (addendum D6) |
| A17 | Resource definitions match generated migrations (`mix ash.codegen --check`). | Enforced |
| A18 | E2E tests use no request interception or mock libraries. Names of mock libraries are data (`e2e_mock_packages`), and `e2e/package.json` must equal `e2e_npm_deps`, so a mock library under a new name fails too. | Enforced |
| A19 | Accepted rules stay active until explicitly changed. The registry test requires A01-A23 exactly once with valid statuses and existing verification files, and that the rule IDs listed above per check category equal the `check:` fields in the registry. | Unverified (addendum D6) |
| A20 | E2E tests contain no fixed sleeps (`waitForTimeout`, `setTimeout`, `sleep(`). | Enforced |
| A21 | No suppression directives for ESLint, TypeScript, Credo or Dialyzer and no Dialyzer ignore file (addendum D5). | Enforced |
| A22 | Kind-specific branching lives only in kind modules (`lib/sketch/canvas/kinds/`), element renderers (`lib/sketch_web/elements/`, `assets/js/elements/`) and generated files (`assets/js/generated/`) (ADR 0004). The scan of `lib` and `assets/js` rejects `kind == :x` and `kind === "x"` (either order, negated), `kind in [`, `kind: :x`, `data-kind="x"` and `dataset.kind` comparisons for any element kind. There is no per-file exception: a test requires the allowed paths to be exactly those four directories. The canvas hook reads per-kind behaviour (geometry, text, `draw_gesture`, default size, style properties) from the specs in the generated manifest, never from kind ids. Element kinds are declared once in `Sketch.Canvas.Kinds`, which fails to compile if a draw gesture cannot produce its kind's geometry or a spec's `style` names an unknown property (ADR 0006); `SketchWeb.Tools` fails to compile if a tool creates an unknown kind, and `mix sketch.gen.manifest --check` fails `mix ci` and CI if `assets/js/generated/manifest.ts` is stale. Renderers are forced equal: `SketchWeb.Elements` fails to compile unless its renderers cover exactly the registered kinds, the client `RENDERERS` table `satisfies Record<ElementKind, Renderer>` (so `tsc` fails if either side lacks one), `mix sketch.gen.render_fixtures --check` fails `mix ci` and CI if `assets/test/fixtures/render_parity.json`, `wrap_parity.json` or `random_parity.json` is stale, and `assets/test/render_parity.test.ts`, `wrap_parity.test.ts` and `random_parity.test.ts` fail if a client renderer draws a different node tree from the server for any fixture shape, seed and sampled style, the client wraps a fixture text into different lines, or the hand-drawn random source or number formatting differs (ADR 0005). | Enforced |
| A23 | Every keyboard shortcut is declared in a registry aggregated by `SketchWeb.Shortcuts` (the registries are `SketchWeb.Shortcuts.registries/0`); chords are unique across focus contexts that can be active at once (ADR 0009, ADR 0010). Each registry declares the shortcut groups it owns and may declare focus contexts, each naming the contexts it can be active with; every chord declares a modifier policy. `SketchWeb.Shortcuts.Aggregate` fails compilation when two actions share a chord in the same or overlapping contexts, comparing the characters a key press can produce (keys without case, `KeyE` as `e`, `Digit1` as `1` and, with Shift, as `!`), Ctrl/⌘ as overlapping Ctrl, Shift "any" as overlapping either and a chord that ignores Alt (or every modifier) as overlapping both states; it also rejects a repeated action id, group or context, an entry whose group its registry does not declare, a context no registry declares, a malformed entry and a modifier policy that contradicts its chord. `mix sketch.gen.render_fixtures` writes the conflict model's verdict for every pair of a fixed chord set, and `assets/test/shortcut_parity.test.ts` requires the client matcher to match some key press with both chords of a pair exactly when the server says they collide. The shortcuts help renders from the aggregate only, buttons take `aria-keyshortcuts` and titles from it, `mix sketch.gen.manifest` emits it as `SHORTCUTS` and `assets/js/hooks/shortcuts.ts` is the one client matcher. The scan of `lib` and `assets/js` rejects a `key`/`code` compared with a string literal, a `switch` on them, a literal array's `.includes(key)`, `phx-key`/`phx-keydown`/`phx-window-keydown` bindings and literal `aria-keyshortcuts` outside `literal_chord_paths`. Pointer gestures are data too (ADR 0011): registries declare `pointer_gestures/0`, the aggregate fails compilation when two can match one input or a chordless help row is written by hand, the help text is derived from the gesture's fields, and `pointerAction` reads only the generated `POINTER_GESTURES`. | Enforced |

## Keyboard shortcuts

A23 keeps every chord in one place. Adding a shortcut takes:

1. A chord in its feature's registry (one of `SketchWeb.Shortcuts.registries/0`), or in
   `SketchWeb.FixedShortcuts` if it belongs to none. A new registry is a module with `shortcuts/0`
   and `shortcut_groups/0` (the groups it owns) added to `@registries` in `SketchWeb.Shortcuts`.
   The entry, chord and context formats are in the `SketchWeb.Shortcuts.Aggregate` moduledoc.
   Every chord names its modifier policy: `:exact` for most, `:any` for a cancel such as Esc, so it
   still works while a gesture holds Alt or Shift.
2. A focus context only if the shortcut must be active where the existing ones are not: declare it
   in the registry's `shortcut_contexts/0` with the contexts it can be active at the same time as
   (`overlaps`), and pass it to `shortcutFor` while it is active. A chord in a context that overlaps
   another must not collide with that context's chords.
3. `mix sketch.gen.manifest`, so `SHORTCUTS` in `assets/js/generated/manifest.ts` has it.
4. Client code that asks `shortcutFor(input, context)` (or a wrapper such as `zoomActionFor`) for
   the action, checks that `shortcut.group` is its own and acts on `shortcut.action`; it never
   compares `event.key` or `event.code` itself.

A chord already used in the same or an overlapping focus context fails compilation with both
actions and their contexts named; pick another chord or a context that cannot be active at the
same time. The help panel, `aria-keyshortcuts` and titles follow without further work. Docs refer
to `SketchWeb.Shortcuts.registries/0` instead of listing the registries (CI requirement 10).

A pointer gesture is one row in a registry's `pointer_gestures/0` (format in the
`SketchWeb.Shortcuts.Aggregate` moduledoc): button, tools, target, modifiers and the action. It
reaches `pointerAction` through `mix sketch.gen.manifest`, and its optional `help` gives the help
row, whose keys and wording come from those fields. Two gestures that can match one input fail
compilation. A help row without chords cannot be written by hand. A new action name fails `tsc`
until the canvas hook's `Record<PointerAction, …>` of handlers has it.

## Board events

ADR 0011 keeps every event a board client pushes in `SketchWeb.BoardEvents`. Adding one takes:

1. An entry in `@transient` (relay-only: `relays_as`, `payload` and a valid `example`) or `@durable`
   (`writes`, the `Sketch.Canvas` action it reaches, and `payload`). `BoardLive` forwards what
   `relayed_events/0` returns, so a transient event not listed there never reaches another view.
2. Its `handle_event` clause in `SketchWeb.BoardLive`, requiring exactly the payload's non-optional
   fields, and a relay through `broadcast_preview`.
3. `mix sketch.gen.manifest`, so `ClientEventPayloads` has it, then `pushClientEvent(this, event,
   payload)` on the client. A raw `pushEvent` fails a source scan, and `tsc` rejects an undeclared
   event or field, including through a spread or a variable.

The A10 test sends every `example` without further work. Selection state is never declared (addendum
D8): the contract refuses a field or event named after it.

## Element kinds

ADR 0004 is complete: every kind is a spec module in `lib/sketch/canvas/kinds/`, rendered by one
server and one client renderer in local coordinates, and the canvas hook has no kind-specific
code. Adding a kind takes:

1. A spec module `lib/sketch/canvas/kinds/<kind>.ex` and its line in `Sketch.Canvas.Kinds`, including
   the style properties that apply to it (ADR 0006).
2. A server renderer `lib/sketch_web/elements/<kind>.ex` and its line in `SketchWeb.Elements`.
3. A client renderer `assets/js/elements/<kind>.ts` and its entry in `RENDERERS`
   (`assets/js/elements/index.ts`).
4. A tool entry in `SketchWeb.Tools`.
5. `mix sketch.gen.manifest` and `mix sketch.gen.render_fixtures` (both outputs are committed and
   checked in CI), and `mix ash.codegen`, because the CHECK constraints list the kinds that hold
   text or points and the kinds each style property applies to.
6. CSS for any new class, and tests.

Leaving out step 1, 2, 3 or 4 fails compilation or `tsc`; a stale step 5 fails `mix ci`.

## Known limits

- A23's scan is line-based, like A22's. A key compared through a variable whose name holds neither
  `key` nor `code`, a key name split across lines or a lookup table keyed by key names is not seen;
  the negative fixture covers each direct form. The conflict check assumes a physical key types its
  US character, or its unshifted character with Shift held (as on AZERTY digits), and that any
  character may come from some other key with or without Shift; a physical key that types
  something else on another layout is compared as the US key. The parity fixture covers a fixed set
  of keys and codes, not every key.
- The docs check (CI requirement 10) matches registry module names as words and kinds, tools,
  tokens, contexts and groups only in code form (`` `x` ``, `:x`, `"x"`), one line at a time. A list
  written in plain words ("text and note elements") or spread over several lines is not seen.
- The browser context scan (CI requirement 11) is line-based: a browser held under a name without
  `browser` that calls `newPage(` is not seen; `.newContext(` is rejected on any receiver. It reads
  scripts, not `DEMO.md` exec blocks, where a `grep` for the pattern is the normal use.
- The script scans (CI requirements 9 and 11) identify a script by extension or `#!` first line, and
  run `git ls-files`, so they need a git checkout.
- The board event parse (A10, CI requirement 12) reads `SketchWeb.BoardLive` only and sees literal
  event names; an event name built at runtime is not seen, though it would not reach another view
  unless `relayed_events/0` lists it. The "durable event reaches its action" check follows local
  calls and captures by name, not arity.
- Typed pushes (CI requirement 12) close the field names, not what a field means. A declared id list
  such as `erase`'s `element_ids` may hold selected ids, because erasing a selection is an action on
  those elements (addendum D13). A new event carrying ids to show a selection would pass unless its
  name says so; a reviewer has to catch that. The scan of selection names reads `BoardLive`'s event
  code, and the E2E tests still check that another browser shows no selection.
- Pointer gestures describe the press that starts an interaction. What happens during it (Shift adds
  to a marquee, a click on a group member collapses the selection) stays in the canvas hook and its
  E2E tests. Space + drag keeps a hand-written `suffix` on its chord, since it has a chord.
- The layout spec (CI requirement 8) checks a fresh board and the style bar with a drawing tool
  selected, at 860, 1024, 1280 and 1600 px wide and 800 px high, in Chromium. Open menus, the help
  panel and widths outside that set are not checked.
- A22 is a line-based scan of direct forms. A kind compared through a variable built at runtime, a
  `case` on the kind or a kind name split across lines is not seen; code review covers those, and
  the negative fixture covers each direct form.
- The `elements` CHECK constraints list point kinds in the order the existing migration was
  generated with (`@migrated_point_kind_order` in `Sketch.Canvas.Element`), not registry order.
  `Element` keeps that order so the SQL text, and therefore `ash.codegen --check`, does not change;
  a new point kind is appended.
- Render parity is checked on a fixed set of shapes per kind (sizes 0, 1, 2, 119, 120, 3999 and
  4000 in both directions, plus point sets and texts derived from the kind's spec; text kinds use
  widths around the note's wrapping boundaries instead), each with fixture seeds including 0 and
  the largest (every seed for box kinds without text, the seeds in turn for the others). The
  hand-drawn generator uses only integer arithmetic in hundredths of a pixel, so the two sides
  have no float rounding or printing to disagree on (ADR 0005). Note wrapping is also compared on 885
  deterministic (text, width) pairs. Two implementations that agree on all of them but differ
  elsewhere are not caught. Odd and even sizes are both included,
  so a renderer that halves a size is checked on whole and fractional results. Styles are sampled,
  not multiplied out: every shape in the default style, and three shapes per kind in each
  applicable token on its own and in a few combinations (ADR 0006).
- Style colours live in `assets/css/app.css`. A test requires a light and two dark values (the
  `prefers-color-scheme` and `data-theme` blocks) for every colour token and a rule for every
  class a renderer maps a token to; whether a colour is readable in a theme is checked by eye in
  the evidence screenshots, not by a test.

- Export (PNG, SVG and clipboard) is built on the client from the live DOM, so it is not
  covered by the server render-parity checks. It resolves each element's colours with
  `getComputedStyle` for the theme on screen and rasterises through an `Image` and a canvas
  (area capped at 16 million pixels). `font-family` is written out, but the exported file
  depends on the viewer having a matching font, and PNG text uses the browser's own fallback.
  Copying SVG text next to the PNG and reading the clipboard need a secure context and the
  browser's permission; a refusal is shown as a message, not retried.

- Live cursors (ADR 0007) are relayed per move without a rate limit beyond the client's 20 per
  second, and the label width is estimated from the name's length. Names are random per mount,
  so a reconnecting browser appears as a new viewer. A cursor only reaches boards through the
  board topic; the A07 tests check two views of one board against a third view on another.
- Undo and redo (ADR 0008) live in each view's canvas hook and die with it: a reload clears them.
  An undone erase re-creates the element under a new id, so it is drawn above elements created
  since. An undo overwrites a newer change by someone else (last writer wins). The stack logic is
  checked by fast-check models in `assets/test/history_logic.test.ts`; the wiring in the hook only
  by the E2E tests in `e2e/tests/undo.spec.ts`.
- Zoom (10% to 400%) is local UI state of the `Canvas` hook: it is never pushed, broadcast or
  stored, and a reload returns to 100%. The svg keeps its `viewBox` in canvas units and only its
  rendered `width` and `height` change, so everything on the wire stays in canvas coordinates.
  `assets/js/hooks/zoom_logic.ts` holds the pure math (clamp, levels, screen to canvas, the scroll
  that keeps the point under the pointer fixed, fit to content) and is checked
  by fast-check in `assets/test/zoom_logic.test.ts`; the wiring is checked by
  `e2e/tests/zoom.spec.ts`. The chords come from `SketchWeb.ZoomActions` through `SketchWeb.Shortcuts`
  and the manifest, like every other shortcut (A23). Selection handles, the outline, line and freehand hit areas and remote cursors
  keep their screen size; the text editor layer is scaled with a CSS transform. At zoom levels
  where the scroll position would have to be negative (the canvas is smaller than the viewport)
  the point under the pointer cannot stay put.
- Duplicate, copy, cut, paste and Alt+drag (Ctrl/⌘+D, C, X, V from `SketchWeb.ClipboardActions`)
  are client-side compositions of the existing `create_element` and `erase` events, so the
  server validates and clamps every pasted element like any other create. The system clipboard
  holds text/plain JSON `{"type":"sketch/elements","version":1,"elements":[...]}`;
  `assets/js/hooks/clipboard_logic.ts` encodes, validates (total: it never throws) and places it
  and is checked by fast-check in `assets/test/clipboard_logic.test.ts`; the wiring is checked by
  `e2e/tests/clipboard.spec.ts`. Copy and paste need a secure context and the browser's clipboard
  permission (Chromium asks on the first paste, Firefox may not offer `readText`); a refusal is
  shown in the status line, not retried. The clipboard is a list, so a multi-selection copies and
  pastes as one group (addendum D13). A duplicate or paste is one undo entry; undo erases the created
  elements (so redo creates them under new ids, D12). Alt+drag shows the copy as a draw preview and
  sends nothing for the original; Esc cancels it with Alt still held, because the Esc chord ignores
  held modifiers (ADR 0010).
- Multi-select (addendum D13) is local UI state of the `Canvas` hook, like zoom: never pushed,
  broadcast or stored; the E2E tests check that the other browser shows no selection outline,
  marquee or selection attribute. A group drag sends one batched `group_preview` per tick and
  commits each element on its own, so a group move is several versions, not one transaction: a
  viewer can see some members land before others, and a member that fails is reverted alone.
  `assets/js/hooks/selection_logic.ts` holds the pure parts (selection set operations, the marquee
  hit test, the group move that clamps one delta for the whole group, the per-element merge of a
  batched preview and the mixed style state) and is checked by fast-check in
  `assets/test/selection_logic.test.ts`; the wiring by `e2e/tests/multi-select.spec.ts`. The
  marquee hit test uses bounding boxes, so a marquee that touches a line's or stroke's box selects
  it even if it misses the stroke. A group preview of more than 1000 elements is dropped by the
  server and the group moves without live previews.
- Exports clone `#elements > [data-element]` only, which is how the selection, draw-preview and
  remote-cursor layers stay out of them; there is no exclusion list to extend.

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
