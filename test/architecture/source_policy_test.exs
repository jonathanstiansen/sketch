defmodule Sketch.Architecture.SourcePolicyTest do
  use ExUnit.Case, async: true

  alias Sketch.ArchitectureCheck
  alias Sketch.Canvas.Style

  @fixtures "test/architecture/fixtures/files"

  describe "pointer behaviour lives in the canvas hook (A13)" do
    test "application" do
      violations = ArchitectureCheck.pointer_event_violations(File.cwd!(), pointer_event_files())

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects pointer events outside the hook, in TypeScript and in templates" do
      violations =
        ArchitectureCheck.pointer_event_violations(fixture("a13"), pointer_event_files())

      assert subjects(violations, "A13") == ["assets/js/app.ts:1", "lib/board_live.ex:4"]
    end
  end

  describe "E2E tests use the real stack without fixed sleeps (A18, A20)" do
    test "application" do
      violations = ArchitectureCheck.e2e_violations(File.cwd!(), e2e_context_paths())

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects fixed sleeps (A20)" do
      violations = ArchitectureCheck.e2e_violations(fixture("a20"), e2e_context_paths())

      assert subjects(violations, "A20") == ["e2e/sleep.spec.ts:4", "e2e/sleep.spec.ts:5"]
    end

    test "rejects request interception and mock libraries (A18)" do
      violations = ArchitectureCheck.e2e_violations(fixture("a18"), e2e_context_paths())

      assert subjects(violations, "A18") == [
               "e2e/mock.spec.ts:2",
               "e2e/mock.spec.ts:5",
               "e2e/package.json"
             ]
    end

    test "rejects a browser context or page created outside the shared helper (CI requirement 11)" do
      violations = ArchitectureCheck.e2e_violations(fixture("e2e_contexts"), e2e_context_paths())

      assert subjects(violations, "e2e_contexts") == [
               "e2e/tests/direct.spec.ts:4",
               "e2e/tests/direct.spec.ts:5",
               "e2e/tests/direct.spec.ts:7",
               "e2e/tests/support/other.ts:4"
             ]
    end

    test "only the shared helper may create browser contexts" do
      assert e2e_context_paths() == ["e2e/tests/support/contexts.ts"]
    end
  end

  describe "no suppression directives (A21)" do
    test "application" do
      violations = ArchitectureCheck.application_suppression_violations()

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects ESLint, TypeScript, Credo and Dialyzer suppressions" do
      details =
        fixture("a21")
        |> ArchitectureCheck.suppression_violations()
        |> Enum.filter(&(&1.rule == "A21"))
        |> Enum.map(&{&1.subject, &1.detail |> String.split(":") |> hd()})
        |> Enum.sort()

      assert details == [
               {".dialyzer_ignore.exs", "Dialyzer ignore file"},
               {"assets/js/suppressed.ts:1", "ESLint directive"},
               {"assets/js/suppressed.ts:3", "TypeScript suppression comment"},
               {"lib/suppressed.ex:3", "Dialyzer attribute"},
               {"lib/suppressed.ex:5", "Credo suppression comment"}
             ]
    end
  end

  describe "kind-specific branching lives in kind modules, renderers and generated files (A22)" do
    test "application" do
      violations =
        ArchitectureCheck.kind_branching_violations(
          File.cwd!(),
          element_kinds(),
          kind_branching_paths()
        )

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects every direct form of kind branching outside the allowed paths" do
      violations =
        ArchitectureCheck.kind_branching_violations(
          fixture("a22"),
          element_kinds(),
          kind_branching_paths()
        )

      assert subjects(violations, "A22") ==
               Enum.sort([
                 "assets/js/hooks/branches.ts:2",
                 "assets/js/hooks/branches.ts:5",
                 "assets/js/hooks/branches.ts:8",
                 "assets/js/hooks/branches.ts:11",
                 "assets/js/hooks/branches.ts:13",
                 "assets/js/hooks/note.ts:1",
                 "lib/branches.ex:4",
                 "lib/branches.ex:5",
                 "lib/branches.ex:6",
                 "lib/branches.ex:7",
                 "lib/branches.ex:8",
                 "lib/branches.ex:9"
               ])
    end

    test "only the kind modules, renderers and generated files may branch, with no per-file exception" do
      assert kind_branching_paths() == [
               "lib/sketch/canvas/kinds/",
               "lib/sketch_web/elements/",
               "assets/js/elements/",
               "assets/js/generated/"
             ]

      refute Map.has_key?(ArchitectureCheck.registry()[:allowlists], :legacy_kind_files)
    end
  end

  describe "keyboard shortcuts come from SketchWeb.Shortcuts (A23)" do
    test "application" do
      violations =
        ArchitectureCheck.literal_chord_violations(File.cwd!(), literal_chord_paths())

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects literal key checks, LiveView key bindings and literal aria-keyshortcuts outside the allowed files" do
      violations =
        ArchitectureCheck.literal_chord_violations(fixture("a23"), literal_chord_paths())

      assert subjects(violations, "A23") ==
               Enum.sort([
                 "assets/js/hooks/keys.ts:2",
                 "assets/js/hooks/keys.ts:3",
                 "assets/js/hooks/keys.ts:4",
                 "assets/js/hooks/keys.ts:5",
                 "assets/js/hooks/keys.ts:6",
                 "assets/js/hooks/keys.ts:9",
                 "assets/js/hooks/keys.ts:10",
                 "lib/board_live.ex:4",
                 "lib/board_live.ex:5"
               ])
    end

    test "only the generated table, the one matcher and two files with no Sketch shortcut are exempt" do
      assert literal_chord_paths() == [
               "assets/js/generated/",
               "assets/js/hooks/shortcuts.ts",
               "assets/js/app.ts",
               "lib/sketch_web/components/layouts/root.html.heex"
             ]
    end
  end

  describe "docs refer to registries instead of enumerating what they own (CI requirement 10)" do
    test "application" do
      violations =
        ArchitectureCheck.doc_enumeration_violations(
          File.cwd!(),
          owned_sets(),
          enumeration_exempt_docs()
        )

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects a stale list of shortcut registries, kinds, tools, style tokens, contexts or groups" do
      violations =
        ArchitectureCheck.doc_enumeration_violations(
          fixture("doc_enumerations"),
          owned_sets(),
          enumeration_exempt_docs()
        )

      assert Enum.map(violations, &{&1.subject, &1.detail |> String.split(" (") |> hd()}) == [
               {"ARCHITECTURE.md:5", "lists 4 shortcut registries"},
               {"ARCHITECTURE.md:7", "lists 3 element kinds"},
               {"ARCHITECTURE.md:9", "lists 3 tools"},
               {"ARCHITECTURE.md:11", "lists 3 style tokens"},
               {"architecture/rules.exs:3", "lists 2 focus contexts"},
               {"docs/NOTES.md:3", "lists 3 shortcut groups"}
             ]
    end

    test "only the human-owned specification is exempt" do
      assert enumeration_exempt_docs() == ["docs/SPEC.md", "docs/SPEC-ADDENDUM.md"]
    end
  end

  describe "scripts stop only processes they started, by PID" do
    test "application" do
      violations = ArchitectureCheck.process_kill_violations(File.cwd!())

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects pkill, killall and kill without a PID variable in scripts and DEMO.md exec blocks" do
      violations = ArchitectureCheck.process_kill_violations(fixture("processes"))

      assert subjects(violations, "processes") == [
               "docs/evidence/demo/DEMO.md:6",
               "docs/evidence/demo/record.sh:3",
               "docs/evidence/demo/record.sh:4",
               "docs/evidence/demo/record.sh:5",
               "docs/evidence/demo/record.sh:6",
               "docs/evidence/demo/record.sh:7",
               "e2e/tests/restart.spec.ts:6",
               "scripts/stop.mjs:3"
             ]
    end
  end

  defp literal_chord_paths, do: allowlist(:literal_chord_paths)

  defp e2e_context_paths, do: allowlist(:e2e_context_paths)

  defp enumeration_exempt_docs, do: allowlist(:enumeration_exempt_docs)

  defp owned_sets do
    [
      %{
        name: "shortcut registries",
        source: "SketchWeb.Shortcuts.registries/0",
        members:
          Enum.map(SketchWeb.Shortcuts.registries(), &(&1 |> Module.split() |> List.last())),
        form: :word,
        min: 2
      },
      %{
        name: "element kinds",
        source: "Sketch.Canvas.Kinds",
        members: Enum.map(Sketch.Canvas.element_kinds(), &Atom.to_string/1),
        form: :code,
        min: 3
      },
      %{
        name: "tools",
        source: "SketchWeb.Tools",
        members: Enum.map(SketchWeb.Tools.all(), & &1.id),
        form: :code,
        min: 3
      },
      %{
        name: "style tokens",
        source: "Sketch.Canvas.Style",
        members:
          Style.properties()
          |> Enum.flat_map(&Style.tokens/1)
          |> Enum.uniq()
          |> Enum.map(&Atom.to_string/1),
        form: :code,
        min: 3
      },
      %{
        name: "focus contexts",
        source: "SketchWeb.Shortcuts.contexts/0",
        members: Enum.map(SketchWeb.Shortcuts.contexts(), &Atom.to_string(&1.id)),
        form: :code,
        min: 2
      },
      %{
        name: "shortcut groups",
        source: "SketchWeb.Shortcuts.groups/0",
        members: Enum.map(SketchWeb.Shortcuts.groups(), &Atom.to_string/1),
        form: :code,
        min: 3
      }
    ]
  end

  defp element_kinds, do: Enum.map(Sketch.Canvas.element_kinds(), &Atom.to_string/1)

  defp kind_branching_paths, do: allowlist(:kind_branching_paths)

  defp allowlist(name),
    do: Enum.map(Map.fetch!(ArchitectureCheck.registry()[:allowlists], name), &elem(&1, 0))

  defp pointer_event_files do
    Enum.map(ArchitectureCheck.registry()[:allowlists].pointer_event_files, &elem(&1, 0))
  end

  defp fixture(name), do: Path.join(@fixtures, name)

  defp subjects(violations, rule) do
    violations
    |> Enum.filter(&(&1.rule == rule))
    |> Enum.map(& &1.subject)
    |> Enum.uniq()
    |> Enum.sort()
  end
end
