[
  rules: [
    %{
      id: "A01",
      rule: "Domain operations are exposed through Ash code interfaces on Sketch.Canvas",
      status: :enforced,
      enforcement:
        "Web modules may only call application modules in the Sketch namespace through Sketch.Canvas (xref call edges)",
      verified_by: ["test/architecture/web_boundary_test.exs"]
    },
    %{
      id: "A02",
      rule: "No Repo, Ecto SQL or Postgrex access from web modules",
      status: :enforced,
      enforcement:
        "Web modules may not call or reference Sketch.Repo, Ecto, Postgrex, AshPostgres or Ash data-layer modules (xref call edges and BEAM atom tables)",
      verified_by: ["test/architecture/web_boundary_test.exs"]
    },
    %{
      id: "A03",
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
        "test/sketch_web/live/board_live_erase_test.exs"
      ]
    },
    %{
      id: "A08",
      rule: "Invalid coordinates and sizes cannot be persisted",
      status: :enforced,
      enforcement: "Ash attribute constraints (text max_length counted in code points), the atomic FitsCanvas, PointsFitShape and TextFitsKind validations and per-kind minimum sizes, plus PostgreSQL CHECK constraints on the box, on line, arrow and freehand points (2 to 500 per stroke) and on text (at most 2000 code points for text and note elements, non-blank for text elements, empty otherwise) (addendum D1, D8, ADR 0003); property tests compare Ash and raw SQL inserts over arbitrary boxes, points and strings",
      verified_by: [
        "test/sketch/canvas/element_test.exs",
        "test/sketch/properties/geometry_test.exs",
        "test/sketch/properties/commit_model_test.exs",
        "assets/test/freedraw_geometry.test.ts",
        "assets/test/text_geometry.test.ts"
      ]
    },
    %{
      id: "A09",
      rule: "Durable movement and resizing increment version atomically",
      status: :enforced,
      enforcement:
        "The commit_position and commit_shape actions use atomic_update(:version, expr(version + 1)); a test runs 50 commits over real concurrent connections and asserts versions 1..50 with no duplicates and last-writer-wins state (ADR 0001)",
      verified_by: [
        "test/sketch/canvas/concurrent_commits_test.exs",
        "test/sketch/properties/commit_model_test.exs"
      ]
    },
    %{
      id: "A10",
      rule: "Transient previews never trigger persistence",
      status: :enforced,
      enforcement:
        "A telemetry handler on [:sketch, :repo, :query] records queries from the LiveView processes while previews and cancels are relayed; the test asserts none, and that a commit issues exactly one UPDATE",
      verified_by: ["test/sketch_web/live/board_live_drag_test.exs", "e2e/tests/dragging.spec.ts"]
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
        "e2e/tests/eraser.spec.ts"
      ]
    },
    %{
      id: "A12",
      rule: "No custom GenServer, event broker or repository layer",
      status: :enforced,
      enforcement:
        "No lib module declares a process behaviour (GenServer, gen_server, gen_statem, gen_event, GenStage) or calls Agent, Registry or :pg; no module name contains Repository",
      verified_by: ["test/architecture/process_policy_test.exs"]
    },
    %{
      id: "A13",
      rule: "Client pointer behaviour lives in the designated hook",
      status: :enforced,
      enforcement:
        "Pointer, mouse and touch event names appear only in assets/js/hooks/canvas.ts, the Canvas LiveView hook (scans assets/js and lib templates)",
      verified_by: ["test/architecture/source_policy_test.exs"]
    },
    %{
      id: "A14",
      rule: "TypeScript strict mode; no any or TS suppression directives",
      status: :enforced,
      enforcement:
        "tsc --noEmit with strict and noUncheckedIndexedAccess; ESLint strictTypeChecked with no-explicit-any and ban-ts-comment as errors and inline config disabled; run by mix ts.check and CI",
      verified_by: ["test/architecture/typescript_policy_test.exs", ".github/workflows/ci.yml"]
    },
    %{
      id: "A15",
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
      rule: "No mocked database or collaboration transport in E2E tests",
      status: :enforced,
      enforcement:
        "E2E sources may not use request routing/HAR interception or import mock libraries; e2e/package.json may not depend on them",
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
      rule: "No arbitrary fixed sleeps in E2E tests",
      status: :enforced,
      enforcement: "E2E sources may not contain waitForTimeout, setTimeout or sleep calls",
      verified_by: ["test/architecture/source_policy_test.exs"]
    },
    %{
      id: "A21",
      rule: "No lint, type-check, Credo or Dialyzer suppressions",
      status: :enforced,
      enforcement:
        "Source files may not contain ESLint disable directives, TypeScript ignore/expect-error/nocheck comments, Credo disable comments or Dialyzer attributes, and no Dialyzer ignore file may exist (addendum D5)",
      verified_by: ["test/architecture/source_policy_test.exs"]
    },
    %{
      id: "A22",
      rule: "Kind-specific branching lives only in kind modules, element renderers and generated files",
      status: :enforced,
      enforcement:
        "lib and assets/js may not compare kind with a literal element kind (kind == :x or kind === \"x\", in either order or negated), use kind in [, match kind: :x, select data-kind=\"x\" or compare dataset.kind outside kind_branching_paths. legacy_kind_files lists the old code paths of kinds still in Sketch.Canvas.Kinds.Legacy; every entry must still match and the list must be empty exactly when Legacy has no kinds (ADR 0004). SketchWeb.Tools fails to compile if a tool creates an unknown kind, and mix sketch.gen.manifest --check fails in mix ci and CI if the client manifest is stale. SketchWeb.Elements fails to compile unless its renderers cover exactly the kinds outside Legacy; the client RENDERERS table satisfies Record<MigratedKind, Renderer> from the manifest, so tsc fails if either side lacks a renderer; mix sketch.gen.render_fixtures --check fails in mix ci and CI if the parity fixture is stale, and assets/test/render_parity.test.ts fails if a client renderer draws a different node tree",
      verified_by: [
        "test/architecture/source_policy_test.exs",
        "test/sketch/canvas/kind_contract_test.exs",
        "test/sketch_web/elements_test.exs",
        "assets/test/render_parity.test.ts"
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
    }
  ],
  allowlists: %{
    web_forbidden_reference_exceptions: [],
    process_behaviour_exceptions: [],
    pointer_event_files: [
      {"assets/js/hooks/canvas.ts", "The designated canvas hook (A13)"}
    ],
    kind_branching_paths: [
      {"lib/sketch/canvas/kinds/", "Kind modules (A22, ADR 0004)"},
      {"lib/sketch_web/elements/", "Server element renderers (A22, ADR 0004)"},
      {"assets/js/elements/", "Client element renderers (A22, ADR 0004)"},
      {"assets/js/generated/", "Files written by mix tasks, never edited by hand (A22, ADR 0004)"}
    ],
    legacy_kind_files: [
      {"lib/sketch_web/live/board_live.ex", "Legacy kinds: element_shape clauses for text and note"},
      {"assets/js/hooks/canvas.ts", "Legacy kinds: text and note editing and the note default size"},
      {"assets/js/hooks/selection.ts", "Legacy kinds: draw previews for note and text"}
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
