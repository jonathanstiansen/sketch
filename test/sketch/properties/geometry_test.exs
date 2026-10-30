defmodule Sketch.Properties.GeometryTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Sketch.Canvas
  alias Sketch.Canvas.{Element, Geometry}
  alias Sketch.CanvasFixtures

  @raw_insert """
  INSERT INTO elements (id, board_id, kind, x, y, width, height, points, text)
  VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
  """

  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()
  @max_text_length Geometry.max_text_length()

  defp kind, do: CanvasFixtures.element_kind()

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

  defp stroke_length do
    max = Geometry.max_points()
    one_of([member_of([1, 2, max - 1, max, max + 1, max + 2]), integer(1..(max + 2))])
  end

  defp stroke_inside(%{width: width, height: height}) do
    bind(stroke_length(), fn length ->
      list_of(fixed_map(%{x: integer(0..width), y: integer(0..height)}), length: length)
    end)
  end

  defp stroke_shape do
    bind(valid_box(), fn box -> map(stroke_inside(box), &{:freedraw, box, &1}) end)
  end

  defp text_of_code_points(count) do
    "a é 😀\n\t\r\u0301\u00a0<>&"
    |> String.codepoints()
    |> member_of()
    |> list_of(max_length: 40)
    |> map(&(String.duplicate("a", count - length(&1)) <> Enum.join(&1)))
  end

  defp combining_text(graphemes),
    do: constant(String.duplicate("e\u0301", graphemes))

  defp text do
    one_of([
      constant(""),
      member_of([" ", "\n", " \t\r\n ", "\u00a0", "\u0000", "a\u0000b", "<b>x</b>", "x"]),
      string(:printable, max_length: 40),
      string(:utf8, max_length: 40),
      bind(
        member_of([@max_text_length - 1, @max_text_length, @max_text_length + 1]),
        &text_of_code_points/1
      ),
      bind(member_of([div(@max_text_length, 2), div(@max_text_length, 2) + 1]), &combining_text/1)
    ])
  end

  defp shape do
    bind(
      one_of([
        bind(tuple({kind(), shape_box()}), fn {kind, box} ->
          map(points_near(box), &{kind, box, &1})
        end),
        stroke_shape(),
        map(valid_box(), &{:text, &1, []})
      ]),
      fn {kind, box, points} -> map(text(), &{kind, box, points, &1}) end
    )
  end

  defp in_bounds?(%{x: x, y: y, width: width, height: height}, min_size \\ 1) do
    x >= 0 and y >= 0 and width >= min_size and height >= min_size and
      x + width <= @canvas_width and y + height <= @canvas_height
  end

  defp well_formed?(%{x: x, y: y} = point),
    do: map_size(point) == 2 and is_integer(x) and is_integer(y)

  defp well_formed?(_point), do: false

  defp valid_shape?({kind, box, points, text}) do
    in_bounds?(box, min_size(kind)) and length(points) in point_count(kind) and
      Enum.all?(points, &well_formed?/1) and inside?(points, box.width, box.height) and
      text_fits?(kind, text)
  end

  defp text_fits?(:text, text) do
    length(String.codepoints(text)) <= @max_text_length and not String.contains?(text, "\u0000") and
      String.replace(text, [" ", "\t", "\n", "\r"], "") != ""
  end

  defp text_fits?(:note, text) do
    length(String.codepoints(text)) <= @max_text_length and not String.contains?(text, "\u0000")
  end

  defp text_fits?(_kind, text), do: text == ""

  defp min_size(kind) when kind in [:arrow, :freedraw, :line], do: 0
  defp min_size(_box_kind), do: 1

  defp point_count(:freedraw), do: 2..Geometry.max_points()
  defp point_count(kind) when kind in [:arrow, :line], do: 2..2
  defp point_count(_box_kind), do: 0..0

  defp inside?(points, width, height),
    do: Enum.all?(points, &(&1.x in 0..width//1 and &1.y in 0..height//1))

  defp ash_accepts?(board, {kind, box, points, text}) do
    attrs = Map.merge(box, %{board_id: board.id, kind: kind, points: points, text: text})
    Ash.Changeset.for_create(Element, :create, attrs).valid?
  end

  defp database_accepts?(board, {kind, %{x: x, y: y, width: width, height: height}, points, text}) do
    params = [Ecto.UUID.dump!(board.id), Atom.to_string(kind), x, y, width, height, points, text]
    match?({:ok, _result}, Repo.query(@raw_insert, params, mode: :savepoint))
  end

  setup do
    %{board: Canvas.create_board!()}
  end

  property "Ash alone accepts a shape iff its box fits the canvas and its kind's minimum size, its points fit the kind and the box, and its text fits the kind",
           %{board: board} do
    check all shape <- shape(), max_runs: 500 do
      assert ash_accepts?(board, shape) == valid_shape?(shape), inspect(shape)
    end
  end

  property "PostgreSQL alone accepts a shape iff its box fits the canvas and its kind's minimum size, its points fit the kind and the box, and its text fits the kind",
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

  property "Ash and PostgreSQL both accept a seed iff it is an integer in 0..max_seed", %{
    board: board
  } do
    max_seed = Geometry.max_seed()

    check all seed <- integer_near_bounds(max_seed), max_runs: 300 do
      attrs = %{kind: :rectangle, x: 0, y: 0, width: 1, height: 1, board_id: board.id, seed: seed}
      ash = Ash.Changeset.for_create(Element, :create, attrs).valid?

      database =
        match?(
          {:ok, _result},
          Repo.query(
            "INSERT INTO elements (board_id, kind, x, y, width, height, seed) VALUES ($1, 'rectangle', 0, 0, 1, 1, $2)",
            [Ecto.UUID.dump!(board.id), seed],
            mode: :savepoint
          )
        )

      assert ash == seed in 0..max_seed, inspect(seed)
      assert database == ash, inspect(seed)
    end
  end

  property "the box around any two canvas points is a valid line whose points round-trip" do
    check all a <- fixed_map(%{x: integer(-100..4100), y: integer(-100..4100)}),
              b <- fixed_map(%{x: integer(-100..4100), y: integer(-100..4100)}),
              max_runs: 1000 do
      %{box: box, points: points} = Geometry.around_points([a, b])
      assert valid_shape?({:line, box, points, ""})

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
