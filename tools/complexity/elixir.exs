defmodule Complexity.Elixir do
  @def_ops [:def, :defp, :defmacro]

  def measure(root) do
    root
    |> Path.join("lib/**/*.ex")
    |> Path.wildcard()
    |> Enum.flat_map(&file_functions(&1, Path.relative_to(&1, root)))
  end

  defp file_functions(path, file) do
    case path |> File.read!() |> Code.string_to_quoted() do
      {:ok, ast} -> ast |> definitions() |> Enum.map(&Map.put(&1, :file, file))
      {:error, _reason} -> []
    end
  end

  defp definitions(ast) do
    {_ast, found} = Macro.prewalk(ast, [], &collect/2)
    found
  end

  defp collect({op, meta, [head | _body]} = definition, found) when op in @def_ops do
    measured = %{
      name: signature(head),
      line: Keyword.get(meta, :line, 0),
      complexity: Credo.Check.Refactor.CyclomaticComplexity.complexity_for(definition)
    }

    {:measured, [measured | found]}
  end

  defp collect(node, found), do: {node, found}

  defp signature({:when, _meta, [call | _guards]}), do: signature(call)
  defp signature({name, _meta, args}) when is_atom(name) and is_list(args), do: "#{name}/#{length(args)}"
  defp signature({name, _meta, _context}) when is_atom(name), do: "#{name}/0"
  defp signature(_head), do: "unknown"
end

for root <- System.argv() do
  IO.puts(JSON.encode!(%{root: root, functions: Complexity.Elixir.measure(root)}))
end
