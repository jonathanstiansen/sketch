[
  check_categories: [
    compiled_code: "Compiled code",
    source_scan: "Source files",
    dependencies: "Dependencies",
    typescript: "TypeScript"
  ],
  rules: [
    %{
      id: "A01",
      check: :compiled_code,
      rule: "Domain operations are exposed through Ash code interfaces on Sketch.Canvas",
      status: :enforced,
      enforcement:
        "Web modules may only call application modules in the Sketch namespace through Sketch.Canvas (xref call edges)",
      verified_by: ["test/architecture/web_boundary_test.exs"]
    },
    %{
      id: "A02",
      check: :compiled_code,
      rule: "No Repo, Ecto SQL or Postgrex access from web modules",
      status: :enforced,
      enforcement:
        "Web modules may not call or reference Sketch.Repo, Ecto, Postgrex, AshPostgres or Ash data-layer modules (xref call edges and BEAM atom tables)",
      verified_by: ["test/architecture/web_boundary_test.exs"]
    },
    %{
      id: "A03",
      check: :compiled_code,
      rule: "No direct resource mutation outside declared Ash actions",
      status: :enforced,
      enforcement:
        "Web modules may not build Ash changesets or queries or call Ash action functions directly; no lib module other than Sketch.Repo calls the Repo, Ecto or Postgrex. Action-level tests are added with the resources in Gate 1",
      verified_by: ["test/architecture/web_boundary_test.exs"]
    },
    %{
      id: "A04",
      rule: "Board and Element use AshPostgres",
      status: :enforced,
      enforcement: "Resource configuration test asserts both resources use AshPostgres and Sketch.Repo",
      verified_by: ["test/sketch/canvas/element_test.exs"]
    },
    %{
      id: "A05",
      rule: "Every Element belongs to exactly one Board",
      status: :enforced,
      enforcement: "Ash allow_nil? false validation and the elements.board_id foreign key; tests cover a nil board and an unknown board id",
      verified_by: ["test/sketch/canvas/element_test.exs"]
    },
    %{
      id: "A06",
      rule: "Board membership is immutable",
      status: :enforced,
      enforcement: "Action restrictions and cross-board update tests",
      verified_by: ["test/sketch/canvas/sessions_test.exs"]
    },
    %{
      id: "A07",
      rule: "All board queries and events are scoped to the selected board",
      status: :enforced,
      enforcement: "Integration and two-board E2E tests; commits and erases find the element by id and board, so a wrong-board erase fails and broadcasts nothing",
      verified_by: [
        "test/sketch/canvas/sessions_test.exs",
        "e2e/tests/sessions.spec.ts",
        "test/sketch/canvas/element_test.exs",
        "test/sketch/properties/commit_model_test.exs",
        "test/sketch_web/live/board_live_erase_test.exs",
        "test/sketch_web/live/board_live_drag_test.exs",
        "e2e/tests/cursors.spec.ts"
      ]
    },
    %{
      id: "A08",
      rule: "Invalid coordinates and sizes cannot be persisted",
      status: :enforced,
      enforcement: "Ash attribute constraints (text max_length counted in code points), the atomic FitsCanvas, PointsFitShape and TextFitsKind validations and per-kind minimum sizes, plus PostgreSQL CHECK constraints on the box, on line, arrow and freehand points (2 to 500 per stroke) and on text (at most 2000 code points for text and note elements, non-blank for text elements, empty otherwise) and on the hand-drawn seed (0 to 2147483647), and the style tokens: each style property is an Ash enum of its registry tokens with a known-token CHECK, and an attribute_equals validation (atomic, against the stored kind) plus a fits-kind CHECK keep a property that does not apply to the kind at its default (addendum D1, D8, D9, D10, ADR 0003, ADR 0005, ADR 0006); property tests compare Ash and raw SQL inserts over arbitrary boxes, points, strings and seeds, and the commit model includes arbitrary and inapplicable style tokens",
      verified_by: [
        "test/sketch/canvas/element_test.exs",
        "test/sketch/canvas/element_style_test.exs",
        "test/sketch/properties/geometry_test.exs",
        "test/sketch/properties/commit_model_test.exs",
        "assets/test/freedraw_geometry.test.ts",
        "assets/test/text_geometry.test.ts"
      ]
    },
    %{
      id: "A09",
      rule: "Durable movement, resizing and restyling increment version atomically",
      status: :enforced,
      enforcement:
        "The commit_position, commit_shape and commit_style actions use atomic_update(:version, expr(version + 1)) and each writes only its own attributes; a test runs 50 interleaved moves, resizes and restyles over real concurrent connections and asserts versions 1..50 with no duplicates, a stored row equal to the commit that returned version 50, and the box and style of the last box and last style commit, so neither overwrites the other (ADR 0001, ADR 0006). Undo and redo replay through the same actions (ADR 0008): a second concurrent test interleaves 25 moves with their undos and asserts versions 1..50, and a LiveView test asserts an undone move, resize and restyle each reach every view with the next version",
      verified_by: [
        "test/sketch/canvas/concurrent_commits_test.exs",
        "test/sketch/properties/commit_model_test.exs",
        "test/sketch_web/live/board_live_undo_test.exs"
      ]
    },
    %{
      id: "A10",
      check: :source_scan,
      rule: "Transient previews never trigger persistence",
      status: :enforced,
      enforcement:
        "SketchWeb.BoardEvents declares every relay-only event with a valid example and BoardLive forwards only what it declares. A telemetry handler on [:sketch, :repo, :query] records queries from the LiveView processes while the test sends every declared example; it asserts that the event reaches the other view and that there were no queries, and that a commit issues exactly one UPDATE. A source check fails if BoardLive relays, forwards or handles an event the registry does not declare, if a durable event never reaches its Sketch.Canvas action, or if anything but broadcast_preview broadcasts",
      verified_by: [
        "test/architecture/board_events_test.exs",
        "test/sketch_web/live/board_live_drag_test.exs",
        "test/sketch_web/live/board_live_cursor_test.exs",
        "e2e/tests/dragging.spec.ts"
      ]
    },
    %{
      id: "A11",
      rule: "Durable events originate from successful Ash changes",
      status: :enforced,
      enforcement: "Ash.Notifier.PubSub on Element publishes after commit; tests cover a successful create, a failed create and a rolled-back transaction, and the same for erase (a successful, a wrong-board and a rolled-back erase, and commits after an erase)",
      verified_by: [
        "test/sketch/canvas/element_test.exs",
        "e2e/tests/collaboration.spec.ts",
        "test/sketch/properties/commit_model_test.exs",
        "e2e/tests/eraser.spec.ts",
        "e2e/tests/undo.spec.ts"
      ]
    },
    %{
      id: "A12",
      check: :compiled_code,
      rule: "No custom GenServer, event broker or repository layer",
      status: :enforced,
      enforcement:
        "No lib module declares a process behaviour (GenServer, gen_server, gen_statem, gen_event, GenStage) or calls Agent, Registry or :pg; no module name contains Repository",
      verified_by: ["test/architecture/process_policy_test.exs"]
    },
    %{
      id: "A13",
      check: :source_scan,
      rule: "Client pointer behaviour lives in the designated hook",
      status: :enforced,
      enforcement:
        "Pointer, mouse and touch event names appear only in assets/js/hooks/canvas.ts, the Canvas LiveView hook (scans assets/js and lib templates)",
      verified_by: ["test/architecture/source_policy_test.exs"]
    },
    %{
      id: "A14",
      check: :typescript,
      rule: "TypeScript strict mode; no any or TS suppression directives",
      status: :enforced,
      enforcement:
        "tsc --noEmit with strict and noUncheckedIndexedAccess; ESLint strictTypeChecked with no-explicit-any and ban-ts-comment as errors and inline config disabled; run by mix ts.check and CI",
      verified_by: ["test/architecture/typescript_policy_test.exs", ".github/workflows/ci.yml"]
    },
    %{
      id: "A15",
      check: :dependencies,
      rule: "No production runtime dependency added without approval",
      status: :enforced,
      enforcement:
        "Production Mix deps and npm dependencies must equal the allowlist below (addendum D4)",
      verified_by: ["test/architecture/dependency_policy_test.exs"]
    },
    %{
      id: "A16",
      rule: "No unreviewed change to enforcement code or CI policies",
      status: :unverified,
      enforcement:
        ".github/CODEOWNERS names the reviewer; needs a ruleset on main with required review and a distinct agent identity (addendum D6)",
      verified_by: [".github/CODEOWNERS"]
    },
    %{
      id: "A17",
      rule: "Database resource definitions match generated migrations",
      status: :enforced,
      enforcement: "mix ash.codegen --check runs in mix ci and CI against the real Board and Element resources",
      verified_by: [".github/workflows/ci.yml"]
    },
    %{
      id: "A18",
      check: :source_scan,
      rule: "No mocked database or collaboration transport in E2E tests",
      status: :enforced,
      enforcement:
        "E2E sources may not use request routing/HAR interception or import a library in e2e_mock_packages; e2e/package.json may not depend on one, and its dependencies must equal e2e_npm_deps, so a mock library under a new name also fails",
      verified_by: ["test/architecture/source_policy_test.exs"]
    },
    %{
      id: "A19",
      rule: "All accepted rules remain active until explicitly changed",
      status: :unverified,
      enforcement:
        "This registry is checked by a test; protected review of changes to it needs branch protection (addendum D6)",
      verified_by: ["test/architecture/registry_test.exs"]
    },
    %{
      id: "A20",
      check: :source_scan,
      rule: "No arbitrary fixed sleeps in E2E tests",
      status: :enforced,
      enforcement: "E2E sources may not contain waitForTimeout, setTimeout or sleep calls",
      verified_by: ["test/architecture/source_policy_test.exs"]
    },
    %{
      id: "A21",
      check: :source_scan,
      rule: "No lint, type-check, Credo or Dialyzer suppressions",
      status: :enforced,
      enforcement:
        "Source files may not contain ESLint disable directives, TypeScript ignore/expect-error/nocheck comments, Credo disable comments or Dialyzer attributes, and no Dialyzer ignore file may exist (addendum D5)",
      verified_by: ["test/architecture/source_policy_test.exs"]
    },
    %{
      id: "A22",
      check: :source_scan,
      rule: "Kind-specific branching lives only in kind modules, element renderers and generated files",
      status: :enforced,
      enforcement:
        "lib and assets/js may not compare kind with a literal element kind (kind == :x or kind === \"x\", in either order or negated), use kind in [, match kind: :x, select data-kind=\"x\" or compare dataset.kind outside kind_branching_paths, which must be exactly the four directories ADR 0004 names; there is no per-file exception (ADR 0004). Per-kind behaviour in the canvas hook comes from spec fields in the generated manifest (geometry, text, draw_gesture, default_size, style). SketchWeb.Tools fails to compile if a tool creates an unknown kind, Sketch.Canvas.Kinds fails to compile if a draw gesture cannot produce its kind's geometry or a spec's style names a property the style registry does not declare (ADR 0006), and mix sketch.gen.manifest --check fails in mix ci and CI if the client manifest is stale. SketchWeb.Elements fails to compile unless its renderers cover exactly the registered kinds; the client RENDERERS table satisfies Record<ElementKind, Renderer> from the manifest, so tsc fails if either side lacks a renderer; mix sketch.gen.render_fixtures --check fails in mix ci and CI if the render, wrap or random parity fixture is stale, and assets/test/render_parity.test.ts, assets/test/wrap_parity.test.ts and assets/test/random_parity.test.ts fail if a client renderer draws a different node tree for any fixture shape, seed or sampled style, the client wraps text into different lines, or the hand-drawn random source or number formatting differs (ADR 0005)",
      verified_by: [
        "test/architecture/source_policy_test.exs",
        "test/sketch/canvas/kind_contract_test.exs",
        "test/sketch_web/elements_test.exs",
        "assets/test/render_parity.test.ts",
        "assets/test/wrap_parity.test.ts",
        "assets/test/random_parity.test.ts"
      ]
    },
    %{
      id: "A23",
      check: :source_scan,
      rule: "Every keyboard shortcut is declared in a registry aggregated by SketchWeb.Shortcuts; chords are unique across focus contexts that can be active at once",
      status: :enforced,
      enforcement:
        "SketchWeb.Shortcuts aggregates every registry in SketchWeb.Shortcuts.registries/0 at compile time through SketchWeb.Shortcuts.Aggregate. Each registry declares the shortcut groups it owns and may declare focus contexts with the contexts each can be active with, and every chord declares a modifier policy (ADR 0010). The aggregate raises a CompileError when two actions share a chord in the same or overlapping contexts (comparing the characters a press can produce: key case ignored, KeyE equals e, Digit1 equals 1 and with Shift !; Ctrl/⌘ overlaps Ctrl, Shift any overlaps either, a chord that ignores Alt or every modifier overlaps both states), when an action id, group or context repeats, when an entry names a group its registry does not declare or a context no registry declares, or when an entry, chord or modifier policy is malformed. mix sketch.gen.render_fixtures writes the conflict model's verdict for every pair of a fixed chord set (checked in mix ci and CI) and assets/test/shortcut_parity.test.ts requires the client matcher to match a press with both chords exactly when the server says they collide. The shortcuts help renders from the aggregate only, buttons take aria-keyshortcuts and titles from it, mix sketch.gen.manifest emits it as SHORTCUTS (checked in mix ci and CI) and assets/js/hooks/shortcuts.ts is the one client matcher. lib and assets/js may not compare a key or code with a string literal, switch on key or code, call a literal array's includes with a key, bind phx-key/phx-keydown/phx-window-keydown or write a literal aria-keyshortcuts outside literal_chord_paths. Pointer gestures are data too: registries declare pointer_gestures/0, the aggregate raises a CompileError when two can match one input or a chordless help row is written by hand, the help text is derived from the gesture's fields, mix sketch.gen.manifest emits them as POINTER_GESTURES and pointerAction reads only that table; assets/test/tools.test.ts checks with fast-check that every gesture maps to its action and exhaustively that no input matches two",
      verified_by: [
        "test/architecture/source_policy_test.exs",
        "test/sketch_web/shortcuts_test.exs",
        "assets/test/shortcuts.test.ts",
        "assets/test/shortcut_parity.test.ts",
        "assets/test/tools.test.ts"
      ]
    },
    %{
      id: "A24",
      check: :source_scan,
      rule: "Style properties are listed only by the style registry: a new property needs no edit to code that handles every property",
      status: :enforced,
      enforcement:
        "No file in lib or assets/js outside style_property_paths names more than two of Sketch.Canvas.style_properties/0, as snake_case or as a data-kebab-case attribute, so code that handles every property derives the list from the registry (ADR 0006, ADR 0014). The Ash attributes and their one_of constraints, BoardLive's token check (Sketch.Canvas.style_token/2), the elements' data attributes, the client's STYLE_DEFAULTS and the clipboard envelope all derive from the registry. Property tests at the boundaries hold every property to the same contract: any registry style round-trips through create_element and commit_style and is refused outside the registry (test/sketch/properties/style_registry_test.exs), and any registry style round-trips through the clipboard envelope (assets/test/clipboard_logic.test.ts)",
      verified_by: [
        "test/architecture/source_policy_test.exs",
        "test/sketch/properties/style_registry_test.exs",
        "assets/test/clipboard_logic.test.ts"
      ]
    }
  ],
  ci_requirements: [
    %{item: 1, check: "Formatting, strict compilation, Credo and Dialyzer", status: :enforced},
    %{item: 2, check: "TypeScript strict compilation and ESLint", status: :enforced},
    %{item: 3, check: "Architecture checks and negative enforcement tests", status: :enforced},
    %{item: 4, check: "Ash migration consistency", status: :enforced},
    %{item: 5, check: "Unit and PostgreSQL integration tests", status: :enforced},
    %{item: 6, check: "Real two-browser Playwright tests", status: :enforced},
    %{
      item: 7,
      check: "Docker Compose production-build/deployment smoke tests",
      status: :enforced,
      verified_by: [".github/workflows/ci.yml", "compose.yaml", "e2e/tests/deploy-persistence.spec.ts"],
      note: "Container steps run only in the compose-smoke CI job; they were not run locally because Docker was unavailable"
    },
    %{
      item: 8,
      check: "Header, style bar and canvas controls do not overlap or leave the viewport at 860, 1024, 1280 and 1600 px wide",
      status: :enforced,
      verified_by: ["e2e/tests/layout.spec.ts", ".github/workflows/ci.yml"],
      note: "Runs in the Playwright CI job with the rest of the E2E suite"
    },
    %{
      item: 9,
      check: "Evidence, E2E and helper scripts stop only processes they started, by PID: no pkill, killall or kill without a PID variable",
      status: :enforced,
      verified_by: ["test/architecture/source_policy_test.exs"],
      note: "Scans every tracked script (git ls-files, by extension or a shebang line) and the exec blocks of every tracked DEMO.md, except deps, _build, node_modules and script_scan_exempt_paths"
    },
    %{
      item: 10,
      check: "Living docs refer to a registry instead of enumerating what it owns: shortcut registries, element kinds, tools, style tokens, focus contexts and shortcut groups",
      status: :enforced,
      verified_by: ["test/architecture/source_policy_test.exs"],
      note: "Scans every Markdown file at the root and directly in docs/ and architecture/rules.exs, except enumeration_exempt_docs; the sets come from the registries at test time"
    },
    %{
      item: 11,
      check: "Every Playwright browser context, in E2E tests and evidence scripts alike, is created by the shared helper, so every context gets the shared options",
      status: :enforced,
      verified_by: ["test/architecture/source_policy_test.exs", "e2e/tests/support/contexts.ts"],
      note: "Rejects .newContext(, .launchPersistentContext( and browser.newPage( in every tracked script outside e2e_context_paths and script_scan_exempt_paths"
    },
    %{
      item: 12,
      check: "Every event a board client pushes is declared in SketchWeb.BoardEvents and pushed through the typed pushClientEvent, and selection state appears in no event, payload or broadcast (addendum D8)",
      status: :enforced,
      verified_by: ["test/architecture/board_events_test.exs", "test/architecture/typescript_policy_test.exs", "assets/js/hooks/client_events.ts"],
      note: "tsc rejects an undeclared event or field, the contract rejects a field naming selection state at compile time, and a source scan rejects a raw pushEvent outside client_push_paths and selection names in BoardLive's event code"
    }
  ],
  allowlists: %{
    web_forbidden_reference_exceptions: [],
    process_behaviour_exceptions: [],
    pointer_event_files: [
      {"assets/js/hooks/canvas.ts", "The designated canvas hook (A13)"}
    ],
    style_property_paths: [
      {"lib/sketch/canvas/style.ex", "The style registry itself (ADR 0006, A24)"},
      {"lib/sketch/canvas/kinds/", "Kind specs declare which properties style each kind (ADR 0006, A24)"},
      {"lib/sketch_web/element_renderer.ex", "Server helpers that turn each property into SVG (ADR 0006, A24)"},
      {"assets/js/elements/style.ts", "Client twin of the element renderer's style helpers (ADR 0006, A24)"},
      {"lib/sketch_web/components/style_panel.ex", "One icon per property in the properties panel (ADR 0006, A24)"},
      {"assets/js/generated/", "Files written by mix tasks, never edited by hand (A24)"}
    ],
    kind_branching_paths: [
      {"lib/sketch/canvas/kinds/", "Kind modules (A22, ADR 0004)"},
      {"lib/sketch_web/elements/", "Server element renderers (A22, ADR 0004)"},
      {"assets/js/elements/", "Client element renderers (A22, ADR 0004)"},
      {"assets/js/generated/", "Files written by mix tasks, never edited by hand (A22, ADR 0004)"}
    ],
    literal_chord_paths: [
      {"assets/js/generated/", "Files written by mix tasks, never edited by hand; the SHORTCUTS table (A23)"},
      {"assets/js/hooks/shortcuts.ts", "The one client matcher for the SHORTCUTS table (A23)"},
      {"assets/js/app.ts",
       "Phoenix LiveReload's development-only hold-c or hold-d and click to open the editor, generated by phx.new; not a Sketch shortcut and only attached when the dev reloader is present"},
      {"lib/sketch_web/components/layouts/root.html.heex",
       "Compares StorageEvent.key with the phx:theme localStorage entry, not a keyboard key"}
    ],
    enumeration_exempt_docs: [
      {"docs/SPEC.md", "The human-owned specification; the registries implement it (CI requirement 10)"},
      {"docs/SPEC-ADDENDUM.md", "The human-owned specification addendum; the registries implement it (CI requirement 10)"}
    ],
    e2e_context_paths: [
      {"e2e/tests/support/contexts.ts",
       "The one helper that creates browser contexts with the shared options, which playwright.config.ts also uses (CI requirement 11)"}
    ],
    script_scan_exempt_paths: [
      {"test/architecture/fixtures/", "Negative fixtures that violate the script policies on purpose"},
      {"test/architecture/source_policy_test.exs", "Names the forbidden commands in its test names"},
      {"architecture/rules.exs", "Names the forbidden commands in the rule text"}
    ],
    client_push_paths: [
      {"assets/js/hooks/client_events.ts", "The one typed wrapper around pushEvent (CI requirement 12)"}
    ],
    broadcast_paths: [
      {"lib/sketch_web/live/board_live.ex", "Checked by board_event_violations: only broadcast_preview broadcasts (A10)"}
    ],
    e2e_mock_packages: [
      {"msw", "HTTP and WebSocket mocking (A18)"},
      {"@mswjs/", "The msw package scope (A18)"},
      {"nock", "HTTP mocking (A18)"},
      {"sinon", "Stubs and fake servers (A18)"},
      {"mock-socket", "WebSocket mocking (A18)"},
      {"playwright-msw", "msw for Playwright (A18)"},
      {"jest-mock", "Module mocking (A18)"}
    ],
    e2e_npm_deps: [
      {"@playwright/test", "The two-browser test runner (SPEC section 8)"},
      {"@types/node", "Node types for the specs and config"},
      {"eslint", "Lints the specs (A14)"},
      {"fast-check", "Property-based E2E tests"},
      {"typescript", "Type-checks the specs (A14)"}
    ],
    production_mix_deps: [
      {:ash, "Core framework (SPEC section 3)"},
      {:ash_phoenix, "Ash integration for Phoenix (SPEC section 3)"},
      {:ash_postgres, "Ash data layer for PostgreSQL (SPEC section 3)"},
      {:bandit, "HTTP server generated by phx.new"},
      {:daisyui, "CSS component source generated by phx.new; compiled into assets, not loaded at runtime"},
      {:dns_cluster, "Generated by phx.new; inert without DNS_CLUSTER_QUERY"},
      {:ecto_sql, "Required by AshPostgres and the generated Repo"},
      {:esbuild, "Asset build tool generated by phx.new; runtime only in dev"},
      {:gettext, "Error translations generated by phx.new"},
      {:heroicons, "Icon source generated by phx.new; compiled into assets"},
      {:jason, "JSON library generated by phx.new"},
      {:phoenix, "Web framework (SPEC section 3)"},
      {:phoenix_ecto, "Generated by phx.new; Plug.Exception mappings for Ecto errors"},
      {:phoenix_html, "Generated by phx.new"},
      {:phoenix_live_dashboard, "Generated by phx.new; mounted only with dev_routes"},
      {:phoenix_live_view, "LiveView (SPEC section 3)"},
      {:postgrex, "PostgreSQL driver required by AshPostgres"},
      {:tailwind, "Asset build tool generated by phx.new; runtime only in dev"},
      {:telemetry_metrics, "Generated telemetry supervisor"},
      {:telemetry_poller, "Generated telemetry supervisor"}
    ],
    production_npm_deps: []
  }
]
