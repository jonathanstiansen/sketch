defmodule Sketch.Properties.GeometryTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Sketch.Canvas
  alias Sketch.Canvas.{Element, Geometry}

  @raw_insert """
  INSERT INTO elements (id, board_id, kind, x, y, width, height)
  VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
  """

  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()

  defp kind, do: member_of(Canvas.element_kinds())

  defp integer_near_bounds(limit) do
    one_of([
      member_of([-1, 0, 1, limit - 1, limit, limit + 1]),
      integer(-10_000..10_000),
      integer(-1_000_000_000..1_000_000_000)
    ])
  end

  defp valid_box do
    bind(tuple({integer(1..@canvas_width), integer(1..@canvas_height)}), fn {width, height} ->
      fixed_map(%{
        x: integer(0..(@canvas_width - width)),
        y: integer(0..(@canvas_height - height)),
        width: constant(width),
        height: constant(height)
      })
    end)
  end

  defp touching_edges(box),
    do: %{box | width: @canvas_width - box.x, height: @canvas_height - box.y}

  defp nudged(box) do
    bind(tuple({member_of([:x, :y, :width, :height]), integer(-2..2)}), fn {field, delta} ->
      constant(Map.update!(box, field, &(&1 + delta)))
    end)
  end

  defp replaced(box) do
    bind(member_of([:x, :y, :width, :height]), fn field ->
      map(integer_near_bounds(@canvas_width), &Map.put(box, field, &1))
    end)
  end

  defp any_box do
    bind(valid_box(), fn box ->
      one_of([
        constant(box),
        constant(touching_edges(box)),
        nudged(box),
        nudged(touching_edges(box)),
        replaced(box)
      ])
    end)
  end

  defp in_bounds?(%{x: x, y: y, width: width, height: height}) do
    x >= 0 and y >= 0 and width >= 1 and height >= 1 and x + width <= @canvas_width and
      y + height <= @canvas_height
  end

  defp ash_accepts?(board, kind, box) do
    attrs = Map.merge(box, %{board_id: board.id, kind: kind})
    Ash.Changeset.for_create(Element, :create, attrs).valid?
  end

  defp database_accepts?(board, kind, %{x: x, y: y, width: width, height: height}) do
    params = [Ecto.UUID.dump!(board.id), Atom.to_string(kind), x, y, width, height]
    match?({:ok, _result}, Repo.query(@raw_insert, params, mode: :savepoint))
  end

  setup do
    %{board: Canvas.create_board!()}
  end

  property "Ash alone accepts a box of any kind iff it is at least 1 x 1 and inside the canvas",
           %{
             board: board
           } do
    check all kind <- kind(), box <- any_box(), max_runs: 300 do
      assert ash_accepts?(board, kind, box) == in_bounds?(box), inspect({kind, box})
    end
  end

  property "PostgreSQL alone accepts a box of any kind iff it is at least 1 x 1 and inside the canvas",
           %{board: board} do
    check all kind <- kind(), box <- any_box(), max_runs: 300 do
      assert database_accepts?(board, kind, box) == in_bounds?(box), inspect({kind, box})
    end
  end

  property "clamp_box always yields a box inside the canvas, and keeps one already inside" do
    check all box <- any_box(), max_runs: 1000 do
      clamped = Geometry.clamp_box(box)
      assert in_bounds?(clamped)
      if in_bounds?(box), do: assert(clamped == box)
    end
  end

  property "the default box of the next element is inside the canvas" do
    check all count <- non_negative_integer(), max_runs: 500 do
      assert in_bounds?(Canvas.default_box(count))
    end
  end
end
