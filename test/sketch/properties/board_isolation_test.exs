defmodule Sketch.Properties.BoardIsolationTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Sketch.Canvas
  alias Sketch.Canvas.Rectangle

  defp seed_rectangles(board, count) do
    Rectangle
    |> Ash.Generator.changeset_generator(:create, defaults: [board_id: board.id])
    |> Ash.Generator.generate_many(count)
  end

  defp ids(rectangles), do: rectangles |> Enum.map(& &1.id) |> Enum.sort()

  property "each board lists exactly its own rectangles (A05)" do
    check all counts <- list_of(integer(0..4), min_length: 1, max_length: 5), max_runs: 50 do
      seeded =
        Enum.map(counts, fn count ->
          board = Canvas.create_board!()
          {board, seed_rectangles(board, count)}
        end)

      for {board, rectangles} <- seeded do
        assert ids(Canvas.list_rectangles_for_board!(board.id)) == ids(rectangles)
      end
    end
  end
end
