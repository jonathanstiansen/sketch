defmodule SketchWeb.Properties.DragEventsTest do
  use SketchWeb.ConnCase
  use ExUnitProperties

  import Phoenix.LiveViewTest

  alias Sketch.Canvas
  alias Sketch.Canvas.Geometry

  @query_event [:sketch, :repo, :query]
  @rectangle_count 2
  @drag_ids for n <- 1..3, do: "00000000-0000-4000-8000-00000000000#{n}"

  defp coordinate(max), do: one_of([integer(0..max), member_of([-1, max + 1])])

  defp event(view_count) do
    fixed_map(%{
      kind: member_of([:preview, :drag_cancel, :commit]),
      view: integer(0..(view_count - 1)),
      rectangle: integer(0..(@rectangle_count - 1)),
      drag_id: member_of(@drag_ids),
      seq: integer(0..50),
      base_version: integer(0..5),
      x: coordinate(Geometry.max_x()),
      y: coordinate(Geometry.max_y())
    })
  end

  defp scenario do
    bind(integer(2..3), fn view_count ->
      tuple({constant(view_count), list_of(event(view_count), max_length: 12)})
    end)
  end

  defp in_bounds?(%{x: x, y: y}), do: x in 0..Geometry.max_x() and y in 0..Geometry.max_y()

  def forward_query(_event, _measurements, metadata, %{test_pid: test_pid, pids: pids}) do
    if self() in pids, do: send(test_pid, {:repo_query, self(), metadata.query})
  end

  defp record_queries(views) do
    handler_id = {__MODULE__, make_ref()}
    config = %{test_pid: self(), pids: Enum.map(views, & &1.pid)}
    :ok = :telemetry.attach(handler_id, @query_event, &__MODULE__.forward_query/4, config)
    handler_id
  end

  defp received_queries do
    receive do
      {:repo_query, pid, query} -> [{pid, query} | received_queries()]
    after
      0 -> []
    end
  end

  defp open_boards(conn, view_count) do
    board = Canvas.create_board!()
    other_board = Canvas.create_board!()

    rectangles =
      for index <- 0..(@rectangle_count - 1) do
        {x, y} = Canvas.default_position(index)
        Canvas.create_rectangle!(%{board_id: board.id, x: x, y: y})
      end

    Canvas.create_rectangle!(%{board_id: other_board.id, x: 10, y: 10})

    views =
      for _ <- 1..view_count do
        {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
        view
      end

    {:ok, outsider, _html} = live(conn, ~p"/b/#{other_board.id}")

    %{
      board: board,
      other_board: other_board,
      rectangles: rectangles,
      views: views,
      outsider: outsider
    }
  end

  defp preview(event, rectangle) do
    event
    |> Map.take([:drag_id, :seq, :base_version, :x, :y])
    |> Map.put(:rectangle_id, rectangle.id)
  end

  defp params(event, rectangle),
    do: Map.new(preview(event, rectangle), fn {key, value} -> {to_string(key), value} end)

  defp send_event(ctx, event) do
    sender = Enum.at(ctx.views, event.view)
    rectangle = Enum.at(ctx.rectangles, event.rectangle)
    render_hook(sender, to_string(event.kind), params(event, rectangle))
    Enum.each([ctx.outsider | ctx.views], &render/1)
    {sender, rectangle}
  end

  defp expected_relay(%{kind: :preview} = event, rectangle) do
    if in_bounds?(event), do: [{"preview", preview(event, rectangle)}], else: []
  end

  defp expected_relay(%{kind: :drag_cancel} = event, rectangle),
    do: [{"drag_cancel", %{rectangle_id: rectangle.id, drag_id: event.drag_id}}]

  defp expected_relay(%{kind: :commit} = event, rectangle) do
    if in_bounds?(event),
      do: [],
      else: [{"drag_cancel", %{rectangle_id: rectangle.id, drag_id: event.drag_id}}]
  end

  defp expected_reply(%{kind: :commit} = event, rectangle) do
    if in_bounds?(event), do: [], else: [{"revert", %{rectangle_id: rectangle.id}}]
  end

  defp expected_reply(_event, _rectangle), do: []

  defp expected_queries(%{kind: :commit} = event, sender) do
    if in_bounds?(event), do: [{sender.pid, :update}], else: []
  end

  defp expected_queries(_event, _sender), do: []

  defp query_kind({pid, "UPDATE " <> _query}), do: {pid, :update}
  defp query_kind({pid, query}), do: {pid, query}

  defp assert_pushes(view, expected) do
    for {event, payload} <- expected, do: assert_push_event(view, ^event, ^payload, 0)

    refute_push_event(view, "preview", _payload, 0)
    refute_push_event(view, "drag_cancel", _payload, 0)
    refute_push_event(view, "revert", _payload, 0)
  end

  defp assert_converged(board, views) do
    for rectangle <- Canvas.list_rectangles_for_board!(board.id), view <- views do
      selector =
        "#rect-#{rectangle.id}[x='#{rectangle.x}'][y='#{rectangle.y}']" <>
          "[data-version='#{rectangle.version}']"

      assert has_element?(view, selector)
    end
  end

  property "previews and cancels never touch the database and stay on their board (A07, A10)", %{
    conn: conn
  } do
    check all {view_count, events} <- scenario(), max_runs: 25 do
      ctx = open_boards(conn, view_count)
      handler_id = record_queries([ctx.outsider | ctx.views])

      for event <- events do
        {sender, rectangle} = send_event(ctx, event)

        assert Enum.map(received_queries(), &query_kind/1) == expected_queries(event, sender)

        for view <- ctx.views do
          if view == sender,
            do: assert_pushes(view, expected_reply(event, rectangle)),
            else: assert_pushes(view, expected_relay(event, rectangle))
        end

        assert_pushes(ctx.outsider, [])
      end

      :telemetry.detach(handler_id)
      assert_converged(ctx.board, ctx.views)
      assert_converged(ctx.other_board, [ctx.outsider])
    end
  end
end
