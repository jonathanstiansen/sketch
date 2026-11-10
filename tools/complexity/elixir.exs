defmodule Complexity.Elixir do
  @def_ops [:def, :defp, :defmacro]

  def measure(root) do
    root
    |> Path.join("lib/**/*.ex")
    |> Path.wildcard()
    |> Enum.flat_map(&file_complexities/1)
  end

  defp file_complexities(path) do
    case path |> File.read!() |> Code.string_to_quoted() do
      {:ok, ast} -> definitions(ast)
      {:error, _reason} -> []
    end
  end

  defp definitions(ast) do
    {_ast, found} = Macro.prewalk(ast, [], &collect/2)
    found
  end

  defp collect({op, _meta, arguments} = definition, found)
       when op in @def_ops and is_list(arguments) do
    {:measured, [Credo.Check.Refactor.CyclomaticComplexity.complexity_for(definition) | found]}
  end

  defp collect(node, found), do: {node, found}
end

for root <- System.argv() do
  IO.puts(JSON.encode!(%{root: root, complexities: Complexity.Elixir.measure(root)}))
end
