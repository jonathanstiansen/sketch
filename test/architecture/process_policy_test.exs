defmodule Sketch.Architecture.ProcessPolicyTest do
  use ExUnit.Case, async: true

  alias Sketch.ArchitectureCheck

  @fixtures "test/architecture/fixtures/beam/processes"

  setup_all do
    output_dir =
      Path.join(System.tmp_dir!(), "sketch-processes-#{System.unique_integer([:positive])}")

    on_exit(fn -> File.rm_rf!(output_dir) end)

    %{
      fixture_violations:
        @fixtures
        |> ArchitectureCheck.compile_fixtures!(output_dir)
        |> ArchitectureCheck.process_violations()
    }
  end

  test "application has no custom GenServer, broker or repository layer (A12)" do
    exceptions = ArchitectureCheck.registry()[:allowlists].process_behaviour_exceptions

    violations =
      ArchitectureCheck.application_beams() |> ArchitectureCheck.process_violations(exceptions)

    assert violations == [], ArchitectureCheck.format_violations(violations)
  end

  test "rejects a GenServer coordinator (A12)", %{fixture_violations: violations} do
    assert reported?(
             violations,
             "Sketch.ArchitectureFixtures.Coordinator",
             "implements GenServer"
           )
  end

  test "rejects a Registry-based broker (A12)", %{fixture_violations: violations} do
    assert reported?(violations, "Sketch.ArchitectureFixtures.Broker", "uses Registry")
  end

  test "rejects a repository layer module (A12)", %{fixture_violations: violations} do
    assert reported?(
             violations,
             "Sketch.ArchitectureFixtures.BoardRepository",
             "is named like a repository layer"
           )
  end

  defp reported?(violations, subject, detail) do
    Enum.any?(violations, &(&1.rule == "A12" and &1.subject == subject and &1.detail == detail))
  end
end
