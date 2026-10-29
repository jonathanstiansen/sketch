defmodule Sketch.Properties.CommitModelTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Phoenix.Socket.Broadcast
  alias Sketch.Canvas
  alias Sketch.Canvas.Geometry

  @kinds Canvas.element_kinds()
  @element_count length(@kinds)
  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()

  defp coordinate(limit), do: one_of([integer(0..limit), member_of([-1, 0, limit - 1, limit])])

  defp size(limit), do: one_of([integer(1..limit), member_of([0, 1, limit, limit + 1])])

  defp point_within(width, height) do
    fixed_map(%{
      x: one_of([integer(0..max(width, 0)), member_of([-1, width + 1])]),
      y: one_of([integer(0..max(height, 0)), member_of([-1, height + 1])])
    })
  end

  defp box do
    fixed_map(%{
      x: coordinate(@canvas_width),
      y: coordinate(@canvas_height),
      width: size(@canvas_width),
      height: size(@canvas_height)
    })
  end

  defp shape do
    bind(box(), fn box ->
      bind(member_of([0, 1, 2, 2, 2, 3]), fn count ->
        map(
          list_of(point_within(box.width, box.height), length: count),
          &Map.put(box, :points, &1)
        )
      end)
    end)
  end

  defp canvas_point,
    do:
      fixed_map(%{x: integer(-50..(@canvas_width + 50)), y: integer(-50..(@canvas_height + 50))})

  defp line_between_points do
    map(tuple({canvas_point(), canvas_point()}), fn {a, b} ->
      %{box: box, points: points} = Geometry.around_points([a, b])
      Map.put(box, :points, points)
    end)
  end

  defp op do
    index = integer(0..(@element_count - 1))

    one_of([
      tuple(
        {member_of([:commit_position, :commit_position_wrong_board]), index,
         fixed_map(%{x: coordinate(@canvas_width), y: coordinate(@canvas_height)})}
      ),
      tuple(
        {member_of([:commit_shape, :commit_shape_wrong_board]), index,
         one_of([shape(), line_between_points()])}
      )
    ])
  end

  defp valid_shape?(%{kind: kind, x: x, y: y, width: width, height: height, points: points}) do
    min_size = min_size(kind)

    x >= 0 and y >= 0 and width >= min_size and height >= min_size and
      x + width <= @canvas_width and y + height <= @canvas_height and
      length(points) in point_count(kind) and inside?(points, width, height)
  end

  defp min_size(kind) when kind in [:arrow, :freedraw, :line], do: 0
  defp min_size(_box_kind), do: 1

  defp point_count(:freedraw), do: 2..Geometry.max_points()
  defp point_count(kind) when kind in [:arrow, :line], do: 2..2
  defp point_count(_box_kind), do: 0..0

  defp inside?(points, width, height),
    do: Enum.all?(points, &(&1.x in 0..width//1 and &1.y in 0..height//1))

  defp initial_shape(kind, box) when kind in [:arrow, :freedraw, :line],
    do: %{points: [%{x: 0, y: 0}, %{x: box.width, y: box.height}]}

  defp initial_shape(:text, _box), do: %{text: "hello"}
  defp initial_shape(_box_kind, _box), do: %{}

  defp seed_board do
    board = Canvas.create_board!()
    other_board = Canvas.create_board!()

    elements =
      for {kind, index} <- Enum.with_index(@kinds) do
        box = Canvas.default_box(index)

        box
        |> Map.merge(%{board_id: board.id, kind: kind})
        |> Map.merge(initial_shape(kind, box))
        |> Canvas.create_element!()
      end

    model = Map.new(Enum.with_index(elements), fn {element, i} -> {i, stored_box(element)} end)
    {board, other_board, elements, model}
  end

  defp stored_box(element) do
    element
    |> Canvas.element_event()
    |> Map.take([:kind, :x, :y, :width, :height, :points, :version])
  end

  defp run({action, index, input} = op, ctx, model) do
    element = Enum.at(ctx.elements, index)
    {interface, board} = target(action, ctx)
    result = apply(Canvas, interface, [element.id, board.id, input])
    {result, next_model(op, model)}
  end

  defp target(:commit_position, ctx), do: {:commit_position, ctx.board}
  defp target(:commit_position_wrong_board, ctx), do: {:commit_position, ctx.other_board}
  defp target(:commit_shape, ctx), do: {:commit_shape, ctx.board}
  defp target(:commit_shape_wrong_board, ctx), do: {:commit_shape, ctx.other_board}

  defp next_model({action, index, input}, model)
       when action in [:commit_position, :commit_shape] do
    moved = Map.merge(model[index], input)

    if valid_shape?(moved),
      do: Map.put(model, index, %{moved | version: moved.version + 1}),
      else: model
  end

  defp next_model(_wrong_board, model), do: model

  defp expected_broadcast({action, index, _input}, model, true),
    do: [{Atom.to_string(action), index, model[index]}]

  defp expected_broadcast(_op, _model, false), do: []

  defp stored(ctx) do
    by_id = Map.new(Canvas.list_elements_for_board!(ctx.board.id), &{&1.id, &1})

    ctx.elements
    |> Enum.with_index()
    |> Map.new(fn {element, i} -> {i, stored_box(by_id[element.id])} end)
  end

  defp received_commits(ctx, board) do
    topic = Canvas.board_topic(board.id)

    receive do
      %Broadcast{topic: ^topic, event: event, payload: payload}
      when event in ["commit_position", "commit_shape"] ->
        index = Enum.find_index(ctx.elements, &(&1.id == payload.id))
        shape = Map.take(payload, [:kind, :x, :y, :width, :height, :points, :version])
        [{event, index, shape} | received_commits(ctx, board)]
    after
      0 -> []
    end
  end

  defp subscribe(board), do: :ok = SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

  property "the database and the broadcasts follow a model of successful commits (A08, A09, A11)" do
    check all ops <- list_of(op(), max_length: 20), max_runs: 75 do
      {board, other_board, elements, initial} = seed_board()
      ctx = %{board: board, other_board: other_board, elements: elements}
      subscribe(board)
      subscribe(other_board)

      {_model, expected_broadcasts} =
        Enum.reduce(ops, {initial, []}, fn op, {model, broadcasts} ->
          {result, next} = run(op, ctx, model)
          committed? = next != model

          assert match?({:ok, _element}, result) == committed?, inspect(op)
          assert stored(ctx) == next

          {next, broadcasts ++ expected_broadcast(op, next, committed?)}
        end)

      received = received_commits(ctx, board)
      assert length(received) == length(expected_broadcasts)
      assert received == expected_broadcasts
      assert received_commits(ctx, other_board) == []
    end
  end
end
