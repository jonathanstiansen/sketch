# Credo 1.7.19 Refactor.CyclomaticComplexity rule, re-implemented over the AST.
# Usage: elixir cc.exs <file> ... ; prints one TSV line per def clause:
#   file \t module \t name/arity \t line \t cc
defmodule CC do
  @def_ops [:def, :defp, :defmacro]
  @double [:if, :unless, :for, :try, :and, :or, :&&, :||]
  @multi [:case, :cond]

  def run(path) do
    src = File.read!(path)

    case Code.string_to_quoted(src, columns: false) do
      {:error, err} ->
        IO.puts(:stderr, "PARSE_ERROR\t#{path}\t#{inspect(err)}")
        []

      {:ok, ast} ->
        {_, rows} = Macro.prewalk(ast, {nil, []}, &visit(&1, &2, path))
        elem(rows, 1) |> Enum.reverse()
    end
  end

  # track the enclosing module name (first defmodule seen wins per file)
  defp visit({:defmodule, _, [{:__aliases__, _, parts} | _]} = node, {nil, acc}, _p),
    do: {node, {Enum.join(parts, "."), acc}}

  defp visit({op, meta, args} = node, {mod, acc}, path)
       when op in @def_ops and is_list(args) do
    # Credo skips `defmacro __using__`
    if match?({:defmacro, _, [{:__using__, _, _}, _]}, node) do
      {node, {mod, acc}}
    else
      cc = complexity(node)
      {name, arity} = name_arity(args)
      row = {path, mod || "-", "#{name}/#{arity}", meta[:line] || 0, cc}
      {node, {mod, [row | acc]}}
    end
  end

  defp visit(node, state, _), do: {node, state}

  defp complexity(ast) do
    {_, n} = Macro.prewalk(ast, 0, &count/2)
    n
  end

  defp count({op, _, args} = node, n) when op in @def_ops and is_list(args), do: {node, n + 1}
  defp count({op, _, args} = node, n) when op in @double and is_list(args), do: {node, n + 1}

  defp count({op, _, args} = node, n) when op in @multi and is_list(args),
    do: {node, n + clauses(args)}

  defp count(node, n), do: {node, n}

  defp clauses(args) do
    case List.last(args) do
      kw when is_list(kw) ->
        case Keyword.get(kw, :do) do
          nil -> 0
          block -> length(List.wrap(block))
        end

      _ ->
        0
    end
  end

  defp name_arity([{:when, _, [head | _]} | _]), do: name_arity([head])
  defp name_arity([{name, _, a} | _]) when is_atom(name) and is_list(a), do: {name, length(a)}
  defp name_arity([{name, _, _} | _]) when is_atom(name), do: {name, 0}
  defp name_arity(_), do: {"?", 0}
end

Enum.each(System.argv(), fn path ->
  Enum.each(CC.run(path), fn {f, m, n, l, cc} ->
    IO.puts(Enum.join([f, m, n, l, cc], "\t"))
  end)
end)
