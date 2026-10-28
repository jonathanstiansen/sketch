defmodule Sketch.Architecture.RegistryTest do
  use ExUnit.Case, async: true

  alias Sketch.ArchitectureCheck

  @rule_ids for n <- 1..21, do: "A" <> String.pad_leading(Integer.to_string(n), 2, "0")

  setup_all do
    %{rules: ArchitectureCheck.registry()[:rules]}
  end

  test "every rule A01-A21 is registered exactly once (A19)", %{rules: rules} do
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

  defp valid_status?(:enforced), do: true
  defp valid_status?(:unverified), do: true
  defp valid_status?({:pending, gate}) when gate in 1..5, do: true
  defp valid_status?(_status), do: false
end
