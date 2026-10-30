defmodule Sketch.Canvas.ConcurrentCommitsTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  import Sketch.CanvasFixtures

  alias Sketch.Canvas

  @commits 50

  setup do
    board = Sandbox.unboxed_run(Sketch.Repo, fn -> Canvas.create_board!() end)

    rectangle =
      Sandbox.unboxed_run(Sketch.Repo, fn ->
        Canvas.create_element!(rectangle(%{x: 0, y: 0, board_id: board.id}))
      end)

    on_exit(fn ->
      Sandbox.unboxed_run(Sketch.Repo, fn ->
        Sketch.Repo.query!("DELETE FROM boards WHERE id = $1", [Ecto.UUID.dump!(board.id)])
      end)
    end)

    %{board: board, rectangle: rectangle}
  end

  @box [:x, :y, :width, :height]
  @style Canvas.style_properties()

  defp commit(element, board, n) when rem(n, 3) == 0,
    do: Canvas.commit_position(element.id, board.id, %{x: n, y: 2 * n})

  defp commit(element, board, n) when rem(n, 3) == 2,
    do: Canvas.commit_style(element.id, board.id, style(n))

  defp commit(element, board, n),
    do:
      Canvas.commit_shape(element.id, board.id, %{
        x: n,
        y: 2 * n,
        width: n,
        height: 3 * n,
        points: []
      })

  defp style(n) do
    Map.new(@style, fn property ->
      tokens = Canvas.style_tokens(property)
      {property, Enum.at(tokens, rem(n, length(tokens)))}
    end)
  end

  defp kind_of(n) when rem(n, 3) == 2, do: :style
  defp kind_of(_n), do: :box

  defp last_of(results, kind) do
    results
    |> Enum.filter(fn {n, _element} -> kind_of(n) == kind end)
    |> Enum.max_by(fn {_n, element} -> element.version end)
    |> elem(1)
  end

  test "concurrent moves, resizes and restyles never lose a version increment or each other's fields (A09, ADR 0006)",
       ctx do
    %{board: board, rectangle: rectangle} = ctx

    committed =
      1..@commits
      |> Task.async_stream(
        fn n ->
          {n, Sandbox.unboxed_run(Sketch.Repo, fn -> commit(rectangle, board, n) end)}
        end,
        max_concurrency: 25,
        ordered: false,
        timeout: 30_000
      )
      |> Enum.map(fn {:ok, result} -> result end)

    assert Enum.all?(committed, &match?({_n, {:ok, _rectangle}}, &1))
    numbered = Enum.map(committed, fn {n, {:ok, rectangle}} -> {n, rectangle} end)
    results = Enum.map(numbered, &elem(&1, 1))

    assert results |> Enum.map(& &1.version) |> Enum.sort() == Enum.to_list(1..@commits)

    stored =
      Sandbox.unboxed_run(Sketch.Repo, fn -> Canvas.list_elements_for_board!(board.id) end)

    assert [stored_element] = stored
    last_writer = Enum.find(results, &(&1.version == @commits))
    assert Canvas.element_event(stored_element) == Canvas.element_event(last_writer)

    assert Map.take(stored_element, @box) == Map.take(last_of(numbered, :box), @box)
    assert Map.take(stored_element, @style) == Map.take(last_of(numbered, :style), @style)
  end
end
