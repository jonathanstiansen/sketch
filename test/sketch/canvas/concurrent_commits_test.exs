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

  defp commit(element, board, n) when rem(n, 2) == 0,
    do: Canvas.commit_position(element.id, board.id, %{x: n, y: 2 * n})

  defp commit(element, board, n),
    do: Canvas.commit_shape(element.id, board.id, %{x: n, y: 2 * n, width: n, height: 3 * n})

  test "concurrent moves and resizes never lose a version increment (A09)", ctx do
    %{board: board, rectangle: rectangle} = ctx

    committed =
      1..@commits
      |> Task.async_stream(
        fn n ->
          Sandbox.unboxed_run(Sketch.Repo, fn -> commit(rectangle, board, n) end)
        end,
        max_concurrency: 25,
        ordered: false,
        timeout: 30_000
      )
      |> Enum.map(fn {:ok, result} -> result end)

    assert Enum.all?(committed, &match?({:ok, _rectangle}, &1))
    results = Enum.map(committed, fn {:ok, rectangle} -> rectangle end)

    assert results |> Enum.map(& &1.version) |> Enum.sort() == Enum.to_list(1..@commits)

    stored =
      Sandbox.unboxed_run(Sketch.Repo, fn -> Canvas.list_elements_for_board!(board.id) end)

    box = [:x, :y, :width, :height, :version]
    assert [stored_element] = stored
    last_writer = Enum.find(results, &(&1.version == @commits))
    assert Map.take(stored_element, box) == Map.take(last_writer, box)
  end
end
