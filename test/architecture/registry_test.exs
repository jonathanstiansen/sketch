defmodule Sketch.Architecture.RegistryTest do
  use ExUnit.Case, async: true

  alias Sketch.ArchitectureCheck

  @rule_ids for n <- 1..23, do: "A" <> String.pad_leading(Integer.to_string(n), 2, "0")

  setup_all do
    %{rules: ArchitectureCheck.registry()[:rules]}
  end

  test "every rule A01-A23 is registered exactly once (A19)", %{rules: rules} do
    assert Enum.map(rules, & &1.id) == @rule_ids
  end

  test "every rule has a valid status and a description", %{rules: rules} do
    for rule <- rules do
      assert valid_status?(rule.status), "#{rule.id} has invalid status #{inspect(rule.status)}"
      assert is_binary(rule.rule) and rule.rule != "", rule.id
      assert is_binary(rule.enforcement) and rule.enforcement != "", rule.id
    end
  end

  test "every enforced or unverified rule names verification files that exist", %{rules: rules} do
    for rule <- rules, rule.status in [:enforced, :unverified] do
      assert rule.verified_by != [], "#{rule.id} has no verification"
    end

    for rule <- rules, path <- rule.verified_by do
      assert File.exists?(path), "#{rule.id} verified_by #{path} does not exist"
    end
  end

  test "every CI requirement that names verification files names files that exist" do
    for requirement <- ArchitectureCheck.registry()[:ci_requirements],
        path <- Map.get(requirement, :verified_by, []) do
      assert File.exists?(path),
             "CI requirement #{requirement.item} verified_by #{path} does not exist"
    end
  end

  test "every architecture test is referenced by the registry", %{rules: rules} do
    referenced = rules |> Enum.flat_map(& &1.verified_by) |> MapSet.new()

    for path <- Path.wildcard("test/architecture/*_test.exs"),
        path != "test/architecture/registry_test.exs" do
      assert MapSet.member?(referenced, path),
             "#{path} is not referenced by architecture/rules.exs"
    end
  end

  test "ARCHITECTURE.md documents every rule", %{rules: rules} do
    architecture = File.read!("ARCHITECTURE.md")

    for rule <- rules do
      assert architecture =~ rule.id, "ARCHITECTURE.md does not mention #{rule.id}"
    end
  end

  test "ARCHITECTURE.md lists each check category's rule IDs as architecture/rules.exs declares them" do
    violations = ArchitectureCheck.rule_category_violations(File.cwd!())

    assert violations == [], ArchitectureCheck.format_violations(violations)
  end

  test "rejects a stale rule ID list, a list with no category and a category with no list" do
    violations =
      ArchitectureCheck.rule_category_violations(
        "test/architecture/fixtures/files/rule_categories"
      )

    assert Enum.map(violations, & &1.detail) |> Enum.sort() == [
             "Dependencies lists nil; architecture/rules.exs says [\"A03\"]",
             "Source files lists [\"A02\"]; architecture/rules.exs says [\"A02\", \"A04\"]",
             "Stale category lists [\"A01\"]; architecture/rules.exs says nil",
             "unknown check category :nonsense"
           ]
  end

  defp valid_status?(:enforced), do: true
  defp valid_status?(:unverified), do: true
  defp valid_status?({:pending, gate}) when gate in 1..5, do: true
  defp valid_status?(_status), do: false
end
