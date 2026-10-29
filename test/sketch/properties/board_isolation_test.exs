defmodule Sketch.Properties.BoardIsolationTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Sketch.Canvas

  defp ids(elements), do: elements |> Enum.map(& &1.id) |> Enum.sort()

  property "each board lists exactly its own elements (A05)" do
    check all counts <- list_of(integer(0..4), min_length: 1, max_length: 5), max_runs: 50 do
      seeded =
        Enum.map(counts, fn count ->
          board = Canvas.create_board!()
          {board, generate_rectangles(board.id, count)}
        end)

      for {board, elements} <- seeded do
        assert ids(Canvas.list_elements_for_board!(board.id)) == ids(elements)
      end
    end
  end
end
