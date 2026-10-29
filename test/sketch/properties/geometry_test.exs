defmodule Sketch.Properties.GeometryTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Sketch.Canvas
  alias Sketch.Canvas.{Element, Geometry}

  @raw_insert """
  INSERT INTO elements (id, board_id, kind, x, y, width, height, points)
  VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
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

  defp zero_sized(box) do
    bind(member_of([:width, :height]), fn field -> constant(Map.put(box, field, 0)) end)
  end

  defp shape_box do
    bind(valid_box(), fn box -> one_of([any_box(), zero_sized(box)]) end)
  end

  defp coordinate_near(limit) do
    one_of([member_of([-1, 0, 1, limit - 1, limit, limit + 1]), integer(-2..(abs(limit) + 2))])
  end

  defp malformed_point(%{x: x, y: y}) do
    member_of([
      %{x: x + 0.5, y: y},
      %{x: x, y: nil},
      %{x: true, y: y},
      %{x: x},
      %{y: y},
      %{x: [x], y: y}
    ])
  end

  defp point_near(%{width: width, height: height}) do
    bind(fixed_map(%{x: coordinate_near(width), y: coordinate_near(height)}), fn point ->
      frequency([{9, constant(point)}, {1, malformed_point(point)}])
    end)
  end

  defp points_near(box) do
    bind(one_of([constant(2), integer(0..(Geometry.max_points() + 2))]), fn count ->
      list_of(point_near(box), length: count)
    end)
  end

  defp shape do
    bind(tuple({kind(), shape_box()}), fn {kind, box} ->
      map(points_near(box), &{kind, box, &1})
    end)
  end

  defp in_bounds?(%{x: x, y: y, width: width, height: height}, min_size \\ 1) do
    x >= 0 and y >= 0 and width >= min_size and height >= min_size and
      x + width <= @canvas_width and y + height <= @canvas_height
  end

  defp well_formed?(%{x: x, y: y} = point),
    do: map_size(point) == 2 and is_integer(x) and is_integer(y)

  defp well_formed?(_point), do: false

  defp valid_shape?({kind, box, points}) do
    in_bounds?(box, min_size(kind)) and length(points) == point_count(kind) and
      Enum.all?(points, &well_formed?/1) and inside?(points, box.width, box.height)
  end

  defp min_size(kind) when kind in [:arrow, :line], do: 0
  defp min_size(_box_kind), do: 1

  defp point_count(kind) when kind in [:arrow, :line], do: 2
  defp point_count(_box_kind), do: 0

  defp inside?(points, width, height),
    do: Enum.all?(points, &(&1.x in 0..width//1 and &1.y in 0..height//1))

  defp ash_accepts?(board, {kind, box, points}) do
    attrs = Map.merge(box, %{board_id: board.id, kind: kind, points: points})
    Ash.Changeset.for_create(Element, :create, attrs).valid?
  end

  defp database_accepts?(board, {kind, %{x: x, y: y, width: width, height: height}, points}) do
    params = [Ecto.UUID.dump!(board.id), Atom.to_string(kind), x, y, width, height, points]
    match?({:ok, _result}, Repo.query(@raw_insert, params, mode: :savepoint))
  end

  setup do
    %{board: Canvas.create_board!()}
  end

  property "Ash alone accepts a shape iff its box fits the canvas and its kind's minimum size, and its points fit the kind and the box",
           %{board: board} do
    check all shape <- shape(), max_runs: 500 do
      assert ash_accepts?(board, shape) == valid_shape?(shape), inspect(shape)
    end
  end

  property "PostgreSQL alone accepts a shape iff its box fits the canvas and its kind's minimum size, and its points fit the kind and the box",
           %{board: board} do
    check all shape <- shape(), max_runs: 500 do
      assert database_accepts?(board, shape) == valid_shape?(shape), inspect(shape)
    end
  end

  property "Ash and PostgreSQL agree on every shape", %{board: board} do
    check all shape <- shape(), max_runs: 300 do
      assert ash_accepts?(board, shape) == database_accepts?(board, shape), inspect(shape)
    end
  end

  property "the box around any two canvas points is a valid line whose points round-trip" do
    check all a <- fixed_map(%{x: integer(-100..4100), y: integer(-100..4100)}),
              b <- fixed_map(%{x: integer(-100..4100), y: integer(-100..4100)}),
              max_runs: 1000 do
      %{box: box, points: points} = Geometry.around_points([a, b])
      assert valid_shape?({:line, box, points})

      clamp = fn %{x: x, y: y} ->
        %{x: x |> max(0) |> min(@canvas_width), y: y |> max(0) |> min(@canvas_height)}
      end

      assert Enum.map(points, &%{x: &1.x + box.x, y: &1.y + box.y}) == Enum.map([a, b], clamp)
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
