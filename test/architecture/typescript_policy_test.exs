defmodule Sketch.Architecture.TypeScriptPolicyTest do
  use ExUnit.Case, async: true

  @assets "assets"
  @fixtures "test/architecture/fixtures/typescript"
  @eslint Path.expand("assets/node_modules/.bin/eslint")
  @tsc Path.expand("assets/node_modules/.bin/tsc")

  test "tsconfig keeps strict mode and unchecked index access (A14)" do
    options =
      @assets
      |> Path.join("tsconfig.json")
      |> File.read!()
      |> JSON.decode!()
      |> Map.fetch!("compilerOptions")

    assert options["strict"] == true
    assert options["noUncheckedIndexedAccess"] == true
    refute options["allowJs"] == true
  end

  test "resolved ESLint config bans any and suppression comments as errors (A14, A21)" do
    {output, 0} = System.cmd(@eslint, ["--print-config", "js/app.ts"], cd: @assets)
    config = JSON.decode!(output)

    assert error?(config["rules"]["@typescript-eslint/no-explicit-any"])
    assert error?(config["rules"]["@typescript-eslint/ban-ts-comment"])
    assert config["linterOptions"]["noInlineConfig"] == true
    assert config["linterOptions"]["reportUnusedDisableDirectives"] in [2, "error"]
  end

  test "ESLint rejects explicit any and TypeScript suppression comments (A14)" do
    {output, status} =
      System.cmd(
        @eslint,
        [
          "--format",
          "json",
          "--config",
          "eslint.config.mjs",
          "explicit_any.ts",
          "ts_ignore.ts",
          "ts_expect_error.ts",
          "ts_nocheck.ts"
        ],
        cd: @fixtures
      )

    assert status == 1

    rules_by_file =
      output
      |> JSON.decode!()
      |> Map.new(fn result ->
        {Path.basename(result["filePath"]), Enum.map(result["messages"], & &1["ruleId"])}
      end)

    assert "@typescript-eslint/no-explicit-any" in rules_by_file["explicit_any.ts"]

    for file <- ~w(ts_ignore.ts ts_expect_error.ts ts_nocheck.ts) do
      assert "@typescript-eslint/ban-ts-comment" in rules_by_file[file], file
    end
  end

  test "tsc rejects implicit any and unchecked index access (A14)" do
    {output, status} = System.cmd(@tsc, ["--noEmit", "-p", "tsconfig.json"], cd: @fixtures)

    assert status != 0
    assert output =~ "unchecked_index.ts(3,10): error TS18048"
    assert output =~ "unchecked_index.ts(6,29): error TS7006"
  end

  defp error?(nil), do: false
  defp error?([severity | _options]), do: error?(severity)
  defp error?(severity), do: severity in [2, "error"]
end
