defmodule Sketch.Properties.CommitModelTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Phoenix.Socket.Broadcast
  alias Sketch.Canvas
  alias Sketch.Canvas.Geometry

  @rectangle_count 3

  defp coordinate(max), do: one_of([integer(0..max), member_of([-1, max + 1])])

  defp op do
    {member_of([:commit, :commit_wrong_board]), integer(0..(@rectangle_count - 1)),
     coordinate(Geometry.max_x()), coordinate(Geometry.max_y())}
    |> tuple()
  end

  defp in_bounds?(x, y), do: x in 0..Geometry.max_x() and y in 0..Geometry.max_y()

  defp seed_board do
    board = Canvas.create_board!()
    other_board = Canvas.create_board!()

    rectangles =
      for index <- 0..(@rectangle_count - 1) do
        {x, y} = Canvas.default_position(index)
        Canvas.create_rectangle!(%{board_id: board.id, x: x, y: y})
      end

    model = Map.new(Enum.with_index(rectangles), fn {r, i} -> {i, {r.x, r.y, r.version}} end)
    {board, other_board, rectangles, model}
  end

  defp run(op, ctx, model) do
    {kind, index, x, y} = op
    rectangle = Enum.at(ctx.rectangles, index)
    target_board = if kind == :commit, do: ctx.board, else: ctx.other_board
    result = Canvas.commit_position(rectangle.id, target_board.id, %{x: x, y: y})
    {result, next_model(op, model)}
  end

  defp next_model({:commit, index, x, y}, model) do
    if in_bounds?(x, y),
      do: Map.update!(model, index, fn {_x, _y, version} -> {x, y, version + 1} end),
      else: model
  end

  defp next_model({:commit_wrong_board, _index, _x, _y}, model), do: model

  defp expected_broadcast({_kind, index, _x, _y}, model, true), do: [{index, model[index]}]
  defp expected_broadcast(_op, _model, false), do: []

  defp stored(ctx) do
    by_id = Map.new(Canvas.list_rectangles_for_board!(ctx.board.id), &{&1.id, &1})

    ctx.rectangles
    |> Enum.with_index()
    |> Map.new(fn {r, i} -> {i, {by_id[r.id].x, by_id[r.id].y, by_id[r.id].version}} end)
  end

  defp received_commits(ctx, board) do
    topic = Canvas.board_topic(board.id)

    receive do
      %Broadcast{topic: ^topic, event: "commit_position", payload: payload} ->
        index = Enum.find_index(ctx.rectangles, &(&1.id == payload.id))
        [{index, {payload.x, payload.y, payload.version}} | received_commits(ctx, board)]
    after
      0 -> []
    end
  end

  defp subscribe(board), do: :ok = SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

  property "the database and the broadcasts follow a model of successful commits (A09, A11)" do
    check all ops <- list_of(op(), max_length: 15), max_runs: 50 do
      {board, other_board, rectangles, initial} = seed_board()
      ctx = %{board: board, other_board: other_board, rectangles: rectangles}
      subscribe(board)
      subscribe(other_board)

      {_model, expected_broadcasts} =
        Enum.reduce(ops, {initial, []}, fn op, {model, broadcasts} ->
          {result, next} = run(op, ctx, model)
          committed? = next != model

          assert match?({:ok, _rectangle}, result) == committed?
          assert stored(ctx) == next

          {next, broadcasts ++ expected_broadcast(op, next, committed?)}
        end)

      assert received_commits(ctx, board) == expected_broadcasts
      assert received_commits(ctx, other_board) == []
    end
  end
end
