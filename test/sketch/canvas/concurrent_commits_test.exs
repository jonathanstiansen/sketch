defmodule Sketch.Canvas.ConcurrentCommitsTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias Sketch.Canvas

  @commits 50

  setup do
    board = Sandbox.unboxed_run(Sketch.Repo, fn -> Canvas.create_board!() end)

    rectangle =
      Sandbox.unboxed_run(Sketch.Repo, fn ->
        Canvas.create_rectangle!(%{x: 0, y: 0, board_id: board.id})
      end)

    on_exit(fn ->
      Sandbox.unboxed_run(Sketch.Repo, fn ->
        Sketch.Repo.query!("DELETE FROM boards WHERE id = $1", [Ecto.UUID.dump!(board.id)])
      end)
    end)

    %{board: board, rectangle: rectangle}
  end

  test "concurrent commits never lose a version increment (A09)", ctx do
    %{board: board, rectangle: rectangle} = ctx

    committed =
      1..@commits
      |> Task.async_stream(
        fn n ->
          Sandbox.unboxed_run(Sketch.Repo, fn ->
            Canvas.commit_position(rectangle.id, board.id, %{x: n, y: 2 * n})
          end)
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
      Sandbox.unboxed_run(Sketch.Repo, fn -> Canvas.list_rectangles_for_board!(board.id) end)

    assert [%{version: @commits, x: x, y: y}] = stored
    last_writer = Enum.find(results, &(&1.version == @commits))
    assert {x, y} == {last_writer.x, last_writer.y}
  end
end
