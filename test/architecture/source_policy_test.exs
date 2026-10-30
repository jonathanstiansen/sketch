defmodule Sketch.Architecture.SourcePolicyTest do
  use ExUnit.Case, async: true

  alias Sketch.ArchitectureCheck

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
      violations = ArchitectureCheck.e2e_violations(File.cwd!())

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects fixed sleeps (A20)" do
      violations = ArchitectureCheck.e2e_violations(fixture("a20"))

      assert subjects(violations, "A20") == ["e2e/sleep.spec.ts:4", "e2e/sleep.spec.ts:5"]
    end

    test "rejects request interception and mock libraries (A18)" do
      violations = ArchitectureCheck.e2e_violations(fixture("a18"))

      assert subjects(violations, "A18") == [
               "e2e/mock.spec.ts:2",
               "e2e/mock.spec.ts:5",
               "e2e/package.json"
             ]
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
