defmodule Sketch.Architecture.WebBoundaryTest do
  use ExUnit.Case, async: true

  alias Sketch.ArchitectureCheck

  @fixtures "test/architecture/fixtures/beam/web_boundary"

  setup_all do
    output_dir =
      Path.join(System.tmp_dir!(), "sketch-web-boundary-#{System.unique_integer([:positive])}")

    on_exit(fn -> File.rm_rf!(output_dir) end)

    %{
      fixture_violations:
        @fixtures
        |> ArchitectureCheck.compile_fixtures!(output_dir)
        |> ArchitectureCheck.web_boundary_violations()
    }
  end

  test "application web modules respect the domain boundary (A01, A02, A03)" do
    exceptions = ArchitectureCheck.registry()[:allowlists].web_forbidden_reference_exceptions

    violations =
      ArchitectureCheck.application_beams()
      |> ArchitectureCheck.web_boundary_violations(exceptions)

    assert violations == [], ArchitectureCheck.format_violations(violations)
  end

  test "rejects a web module calling an application module other than Sketch.Canvas (A01)", %{
    fixture_violations: violations
  } do
    assert reported?(violations, "A01", "SketchWeb.ArchitectureFixtures.InternalCaller")
  end

  test "rejects web modules calling the Repo or Ecto SQL (A02)", %{fixture_violations: violations} do
    assert reported?(violations, "A02", "SketchWeb.ArchitectureFixtures.RepoCaller")
    assert reported?(violations, "A02", "SketchWeb.ArchitectureFixtures.SqlCaller")
  end

  test "rejects web modules building changesets or calling Ash actions directly (A03)", %{
    fixture_violations: violations
  } do
    assert reported?(violations, "A03", "SketchWeb.ArchitectureFixtures.ChangesetBuilder")
    assert reported?(violations, "A03", "SketchWeb.ArchitectureFixtures.AshCaller")
  end

  test "rejects application modules writing through the Repo outside Ash (A03)", %{
    fixture_violations: violations
  } do
    assert reported?(violations, "A03", "Sketch.ArchitectureFixtures.DirectRepoWriter")
  end

  test "does not report a plain application module", %{fixture_violations: violations} do
    refute Enum.any?(violations, &(&1.subject == "Sketch.ArchitectureFixtures.Internal"))
  end

  defp reported?(violations, rule, subject) do
    Enum.any?(violations, &(&1.rule == rule and &1.subject == subject))
  end
end
