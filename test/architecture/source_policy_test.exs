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
