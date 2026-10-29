defmodule Sketch.Properties.CommitModelTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  alias Phoenix.Socket.Broadcast
  alias Sketch.Canvas
  alias Sketch.Canvas.Geometry
  alias Sketch.CanvasFixtures

  @kinds Canvas.element_kinds()
  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()
  @max_text_length Geometry.max_text_length()
  @shape_fields [:kind, :x, :y, :width, :height, :points, :text, :version]

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
      bind(member_of([0, 0, 1, 2, 2, 2, 3]), fn count ->
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

  defp text do
    one_of([
      constant(""),
      member_of([" ", "\n\t", "hi", "a\nb", "<b>x</b>", "é😀", "a\u0000"]),
      string(:printable, max_length: 20),
      member_of([@max_text_length, @max_text_length + 1]) |> map(&String.duplicate("a", &1))
    ])
  end

  defp with_text(shape), do: one_of([shape, map(tuple({shape, text()}), &put_text/1)])

  defp put_text({shape, text}), do: Map.put(shape, :text, text)

  defp text_edit do
    text_box =
      fixed_map(%{
        x: integer(0..3500),
        y: integer(0..3500),
        width: integer(1..500),
        height: integer(1..500)
      })

    map(tuple({one_of([text_box, box()]), text()}), fn {box, text} ->
      Map.merge(box, %{points: [], text: text})
    end)
  end

  defp op do
    index = integer(0..100)

    one_of([
      tuple({constant(:create), CanvasFixtures.element_kind(), with_text(shape())}),
      tuple(
        {member_of([:commit_position, :commit_position_wrong_board]), index,
         fixed_map(%{x: coordinate(@canvas_width), y: coordinate(@canvas_height)})}
      ),
      tuple(
        {member_of([:commit_shape, :commit_shape_wrong_board]), index,
         with_text(one_of([shape(), line_between_points()]))}
      ),
      tuple({member_of([:edit_text, :edit_text_wrong_board]), index, text_edit()}),
      tuple({member_of([:erase, :erase, :erase_wrong_board]), index})
    ])
  end

  defp valid_shape?(%{kind: kind, x: x, y: y, width: width, height: height} = shape) do
    min_size = min_size(kind)

    x >= 0 and y >= 0 and width >= min_size and height >= min_size and
      x + width <= @canvas_width and y + height <= @canvas_height and
      length(shape.points) in point_count(kind) and
      inside?(shape.points, width, height) and text_fits?(kind, shape.text)
  end

  defp min_size(kind) when kind in [:arrow, :freedraw, :line], do: 0
  defp min_size(_box_kind), do: 1

  defp point_count(:freedraw), do: 2..Geometry.max_points()
  defp point_count(kind) when kind in [:arrow, :line], do: 2..2
  defp point_count(_box_kind), do: 0..0

  defp inside?(points, width, height),
    do: Enum.all?(points, &(&1.x in 0..width//1 and &1.y in 0..height//1))

  defp text_fits?(:text, text) do
    length(String.codepoints(text)) <= @max_text_length and not String.contains?(text, "\u0000") and
      String.replace(text, [" ", "\t", "\n", "\r"], "") != ""
  end

  defp text_fits?(:note, text) do
    length(String.codepoints(text)) <= @max_text_length and not String.contains?(text, "\u0000")
  end

  defp text_fits?(_kind, text), do: text == ""

  defp initial_shape(kind, box) when kind in [:arrow, :freedraw, :line],
    do: %{points: [%{x: 0, y: 0}, %{x: box.width, y: box.height}]}

  defp initial_shape(:text, _box), do: %{text: "hello"}
  defp initial_shape(_box_kind, _box), do: %{}

  defp seed_board do
    board = Canvas.create_board!()

    elements =
      for {kind, index} <- Enum.with_index(@kinds) do
        box = Canvas.default_box(index)

        box
        |> Map.merge(%{board_id: board.id, kind: kind})
        |> Map.merge(initial_shape(kind, box))
        |> Canvas.create_element!()
      end

    {board, Enum.map(elements, &{&1.id, stored_shape(&1)})}
  end

  defp stored_shape(element) do
    element
    |> Canvas.element_event()
    |> Map.take(@shape_fields)
  end

  defp run({:create, kind, input}, ctx, model) do
    attrs = Map.merge(input, %{board_id: ctx.board.id, kind: kind})
    created = Map.merge(%{points: [], text: "", version: 0}, Map.put(input, :kind, kind))

    case Canvas.create_element(attrs) do
      {:ok, element} -> {:ok, model ++ [{element.id, created}], {"create", element.id, created}}
      {:error, _error} -> {:error, model, nil}
    end
  end

  defp run({action, index}, ctx, model) do
    {id, shape} = Enum.at(model, rem(index, length(model)))
    board = if action == :erase, do: ctx.board, else: ctx.other_board

    case {Canvas.erase_element(id, board.id), action, erased?(shape)} do
      {:ok, :erase, false} ->
        {:ok, List.keyreplace(model, id, 0, {id, Map.put(shape, :erased?, true)}),
         {"erase", id, %{}}}

      {{:error, _not_found}, _action, erased_or_wrong_board}
      when erased_or_wrong_board or action == :erase_wrong_board ->
        {:error, model, nil}

      {result, _action, erased} ->
        flunk("#{inspect(action)} of an element erased? #{erased} returned #{inspect(result)}")
    end
  end

  defp run({action, index, input}, ctx, model) do
    candidates =
      if action in [:edit_text, :edit_text_wrong_board], do: text_elements(model), else: model

    {id, shape} = Enum.at(candidates, rem(index, length(candidates)))
    {interface, board} = target(action, ctx)
    next = next_shape(action, Map.merge(shape, input))

    case {apply(Canvas, interface, [id, board.id, input]), next} do
      {{:ok, _element}, {:ok, moved}} ->
        {:ok, List.keyreplace(model, id, 0, {id, moved}), {Atom.to_string(interface), id, moved}}

      {{:error, _error}, :rejected} ->
        {:error, model, nil}

      {result, expected} ->
        flunk("#{inspect(action)} returned #{inspect(result)}, the model #{inspect(expected)}")
    end
  end

  defp target(:commit_position, ctx), do: {:commit_position, ctx.board}
  defp target(:commit_position_wrong_board, ctx), do: {:commit_position, ctx.other_board}
  defp target(:commit_shape, ctx), do: {:commit_shape, ctx.board}
  defp target(:commit_shape_wrong_board, ctx), do: {:commit_shape, ctx.other_board}
  defp target(:edit_text, ctx), do: {:commit_shape, ctx.board}
  defp target(:edit_text_wrong_board, ctx), do: {:commit_shape, ctx.other_board}

  defp text_elements(model), do: Enum.filter(model, fn {_id, shape} -> shape.kind == :text end)

  defp erased?(shape), do: Map.get(shape, :erased?, false)

  defp live(model), do: Enum.reject(model, fn {_id, shape} -> erased?(shape) end)

  defp next_shape(action, moved) when action in [:commit_position, :commit_shape, :edit_text] do
    if valid_shape?(moved) and not erased?(moved),
      do: {:ok, %{moved | version: moved.version + 1}},
      else: :rejected
  end

  defp next_shape(_wrong_board, _moved), do: :rejected

  defp expected_create?({:create, kind, input}),
    do: valid_shape?(Map.merge(%{points: [], text: ""}, Map.put(input, :kind, kind)))

  defp stored(board) do
    board.id
    |> Canvas.list_elements_for_board!()
    |> Enum.map(&{&1.id, stored_shape(&1)})
  end

  defp received(board) do
    topic = Canvas.board_topic(board.id)

    receive do
      %Broadcast{topic: ^topic, event: event, payload: payload} ->
        assert payload.board_id == board.id
        [{event, payload.id, Map.take(payload, @shape_fields)} | received(board)]
    after
      0 -> []
    end
  end

  defp subscribe(board), do: :ok = SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

  property "the database and the broadcasts follow a model of creates, moves, shape and text edits, erases, and wrong-board edits and erases (A07, A08, A09, A11)" do
    check all ops <- list_of(op(), max_length: 20), max_runs: 75 do
      {board, initial} = seed_board()
      ctx = %{board: board, other_board: Canvas.create_board!()}
      subscribe(board)
      subscribe(ctx.other_board)
      _seeded = received(board)

      expected =
        ops
        |> Enum.reduce({initial, []}, fn op, {model, broadcasts} ->
          {result, next, broadcast} = run(op, ctx, model)

          if elem(op, 0) == :create,
            do: assert(result == :ok == expected_create?(op), inspect(op))

          assert Map.new(stored(board)) == Map.new(live(next)), inspect(op)
          {next, [broadcast | broadcasts]}
        end)
        |> elem(1)
        |> Enum.reject(&is_nil/1)
        |> Enum.reverse()

      assert received(board) == expected
      assert received(ctx.other_board) == []
    end
  end

  property "a commit or erase after an erase fails, broadcasts nothing and leaves the row gone (A11)" do
    check all kind <- CanvasFixtures.element_kind(),
              later <-
                list_of(member_of([:commit_position, :commit_shape, :erase]), min_length: 1),
              max_runs: 50 do
      board = Canvas.create_board!()
      box = Canvas.default_box(0)

      element =
        box
        |> Map.merge(%{board_id: board.id, kind: kind})
        |> Map.merge(initial_shape(kind, box))
        |> Canvas.create_element!()

      subscribe(board)
      assert :ok = Canvas.erase_element(element.id, board.id)
      assert [{"erase", id, %{}}] = received(board)
      assert id == element.id

      for action <- later do
        assert {:error, _not_found} = late(action, element, board)
      end

      assert received(board) == []
      assert Canvas.list_elements_for_board!(board.id) == []
    end
  end

  defp late(:commit_position, element, board),
    do: Canvas.commit_position(element.id, board.id, %{x: 1, y: 1})

  defp late(:commit_shape, element, board),
    do: Canvas.commit_shape(element.id, board.id, Map.take(element, [:x, :y, :width, :height]))

  defp late(:erase, element, board), do: Canvas.erase_element(element.id, board.id)
end
