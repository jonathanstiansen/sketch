defmodule Sketch.Architecture.DependencyPolicyTest do
  use ExUnit.Case, async: true

  alias Sketch.ArchitectureCheck

  test "production dependencies equal the approved allowlist (A15)" do
    violations =
      ArchitectureCheck.dependency_violations(
        Mix.Project.config()[:deps],
        File.cwd!(),
        allowlists()
      )

    assert violations == [], ArchitectureCheck.format_violations(violations)
  end

  test "rejects an unapproved Mix runtime dependency (A15)" do
    deps = Mix.Project.config()[:deps] ++ [{:req, "~> 0.5"}, {:mox, "~> 1.0", only: :test}]

    details =
      deps |> ArchitectureCheck.dependency_violations(File.cwd!(), allowlists()) |> details()

    assert details == ["production dependency req is not in the allowlist"]
  end

  test "rejects an unapproved npm runtime dependency (A15)" do
    details =
      Mix.Project.config()[:deps]
      |> ArchitectureCheck.dependency_violations(
        "test/architecture/fixtures/files/a15",
        allowlists()
      )
      |> details()

    assert details == ["production dependency left-pad is not in the allowlist"]
  end

  test "rejects a removed allowlisted dependency so the allowlist stays exact (A15)" do
    deps = Enum.reject(Mix.Project.config()[:deps], &(elem(&1, 0) == :jason))

    details =
      deps |> ArchitectureCheck.dependency_violations(File.cwd!(), allowlists()) |> details()

    assert details == ["allowlisted dependency jason is missing; update the allowlist"]
  end

  defp allowlists do
    ArchitectureCheck.registry()[:allowlists]
    |> Map.take([:production_mix_deps, :production_npm_deps])
    |> Keyword.new()
  end

  defp details(violations) do
    violations |> Enum.filter(&(&1.rule == "A15")) |> Enum.map(& &1.detail)
  end
end
