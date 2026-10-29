defmodule Sketch.Properties.CommitModelTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Phoenix.Socket.Broadcast
  alias Sketch.Canvas
  alias Sketch.Canvas.Geometry

  @element_count 4
  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()

  defp coordinate(limit), do: one_of([integer(0..limit), member_of([-1, 0, limit - 1, limit])])

  defp size(limit), do: one_of([integer(1..limit), member_of([0, 1, limit, limit + 1])])

  defp op do
    one_of([
      tuple(
        {member_of([:commit_position, :commit_position_wrong_board]),
         integer(0..(@element_count - 1)),
         fixed_map(%{x: coordinate(@canvas_width), y: coordinate(@canvas_height)})}
      ),
      tuple(
        {member_of([:commit_shape, :commit_shape_wrong_board]), integer(0..(@element_count - 1)),
         fixed_map(%{
           x: coordinate(@canvas_width),
           y: coordinate(@canvas_height),
           width: size(@canvas_width),
           height: size(@canvas_height)
         })}
      )
    ])
  end

  defp in_bounds?(%{x: x, y: y, width: width, height: height}) do
    x >= 0 and y >= 0 and width >= 1 and height >= 1 and x + width <= @canvas_width and
      y + height <= @canvas_height
  end

  defp kind_at(index),
    do: Enum.at(Canvas.element_kinds(), rem(index, length(Canvas.element_kinds())))

  defp seed_board do
    board = Canvas.create_board!()
    other_board = Canvas.create_board!()

    elements =
      for index <- 0..(@element_count - 1) do
        Canvas.create_element!(
          Map.merge(Canvas.default_box(index), %{board_id: board.id, kind: kind_at(index)})
        )
      end

    model = Map.new(Enum.with_index(elements), fn {element, i} -> {i, stored_box(element)} end)
    {board, other_board, elements, model}
  end

  defp stored_box(element), do: Map.take(element, [:kind, :x, :y, :width, :height, :version])

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

    if in_bounds?(moved),
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
        [{event, index, stored_box(payload)} | received_commits(ctx, board)]
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
