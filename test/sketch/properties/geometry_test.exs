defmodule Sketch.Properties.GeometryTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Sketch.Canvas
  alias Sketch.Canvas.Geometry

  @raw_insert """
  INSERT INTO rectangles (id, board_id, x, y) VALUES (gen_random_uuid(), $1, $2, $3)
  """

  defp coordinate(max) do
    one_of([
      member_of([-1, 0, max, max + 1]),
      integer(-3..3),
      integer((max - 3)..(max + 3)),
      integer(0..max),
      integer(-10_000..10_000)
    ])
  end

  defp in_bounds?(x, y), do: x in 0..Geometry.max_x() and y in 0..Geometry.max_y()

  defp ash_accepts?(board, x, y) do
    match?({:ok, _rectangle}, Canvas.create_rectangle(%{board_id: board.id, x: x, y: y}))
  end

  defp database_accepts?(board, x, y) do
    params = [Ecto.UUID.dump!(board.id), x, y]
    match?({:ok, _result}, Repo.query(@raw_insert, params, mode: :savepoint))
  end

  setup do
    %{board: Canvas.create_board!()}
  end

  property "Ash accepts a position iff it is within the geometry bounds", %{board: board} do
    check all x <- coordinate(Geometry.max_x()), y <- coordinate(Geometry.max_y()), max_runs: 100 do
      assert ash_accepts?(board, x, y) == in_bounds?(x, y)
    end
  end

  property "PostgreSQL alone accepts a position iff it is within the geometry bounds", %{
    board: board
  } do
    check all x <- coordinate(Geometry.max_x()), y <- coordinate(Geometry.max_y()), max_runs: 100 do
      assert database_accepts?(board, x, y) == in_bounds?(x, y)
    end
  end

  property "the default position of the next rectangle is within bounds" do
    check all count <- non_negative_integer(), max_runs: 500 do
      {x, y} = Canvas.default_position(count)
      assert in_bounds?(x, y)
    end
  end
end
