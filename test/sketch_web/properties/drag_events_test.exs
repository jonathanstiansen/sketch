defmodule SketchWeb.Properties.DragEventsTest do
  use SketchWeb.ConnCase
  use ExUnitProperties

  import Phoenix.LiveViewTest

  alias Sketch.Canvas
  alias Sketch.Canvas.Geometry

  @query_event [:sketch, :repo, :query]
  @rectangle_count 2
  @drag_ids for n <- 1..3, do: "00000000-0000-4000-8000-00000000000#{n}"

  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()

  defp coordinate(limit), do: one_of([integer(0..limit), member_of([-1, limit - 120, limit])])

  defp size(limit), do: one_of([integer(1..limit), member_of([0, 1, 120, limit + 1])])

  defp event(view_count) do
    fixed_map(%{
      kind: member_of([:preview, :drag_cancel, :commit, :commit_shape]),
      view: integer(0..(view_count - 1)),
      rectangle: integer(0..(@rectangle_count - 1)),
      drag_id: member_of(@drag_ids),
      seq: integer(0..50),
      base_version: integer(0..5),
      x: coordinate(@canvas_width),
      y: coordinate(@canvas_height),
      width: size(@canvas_width),
      height: size(@canvas_height)
    })
  end

  defp scenario do
    bind(integer(2..3), fn view_count ->
      tuple({constant(view_count), list_of(event(view_count), max_length: 12)})
    end)
  end

  defp in_bounds?(%{x: x, y: y, width: width, height: height}, min_size \\ 1) do
    x >= 0 and y >= 0 and width >= min_size and height >= min_size and
      x + width <= @canvas_width and y + height <= @canvas_height
  end

  defp commits?(%{kind: :commit} = event, stored),
    do: in_bounds?(%{event | width: stored.width, height: stored.height})

  defp commits?(%{kind: :commit_shape} = event, _stored), do: in_bounds?(event)

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
        Canvas.create_element!(
          Map.merge(Canvas.default_box(index), %{board_id: board.id, kind: :rectangle})
        )
      end

    Canvas.create_element!(rectangle(%{board_id: other_board.id, x: 10, y: 10}))

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
    |> Map.take([:drag_id, :seq, :base_version, :x, :y, :width, :height])
    |> Map.merge(%{element_id: rectangle.id, points: []})
  end

  defp params(event, rectangle),
    do: Map.new(preview(event, rectangle), fn {key, value} -> {to_string(key), value} end)

  defp send_event(ctx, event) do
    sender = Enum.at(ctx.views, event.view)
    rectangle = Enum.at(ctx.rectangles, event.rectangle)
    stored = Enum.find(Canvas.list_elements_for_board!(ctx.board.id), &(&1.id == rectangle.id))
    render_hook(sender, to_string(event.kind), params(event, rectangle))
    Enum.each([ctx.outsider | ctx.views], &render/1)
    {sender, rectangle, stored}
  end

  defp expected_relay(%{kind: :preview} = event, rectangle, _stored) do
    if in_bounds?(event), do: [{"preview", preview(event, rectangle)}], else: []
  end

  defp expected_relay(%{kind: :drag_cancel} = event, rectangle, _stored),
    do: [{"drag_cancel", %{element_id: rectangle.id, drag_id: event.drag_id}}]

  defp expected_relay(event, rectangle, stored) do
    if commits?(event, stored),
      do: [],
      else: [{"drag_cancel", %{element_id: rectangle.id, drag_id: event.drag_id}}]
  end

  defp expected_reply(%{kind: kind} = event, rectangle, stored)
       when kind in [:commit, :commit_shape] do
    if commits?(event, stored), do: [], else: [{"revert", %{element_id: rectangle.id}}]
  end

  defp expected_reply(_event, _rectangle, _stored), do: []

  defp expected_queries(%{kind: :commit, x: x, y: y}, sender, _stored) do
    if x in 0..@canvas_width and y in 0..@canvas_height,
      do: [{sender.pid, :update}],
      else: []
  end

  defp expected_queries(%{kind: :commit_shape} = event, sender, _stored) do
    if in_bounds?(event, 0), do: [{sender.pid, :update}], else: []
  end

  defp expected_queries(_event, _sender, _stored), do: []

  defp query_kind({pid, "UPDATE " <> _query}), do: {pid, :update}
  defp query_kind({pid, query}), do: {pid, query}

  defp assert_pushes(view, expected) do
    for {event, payload} <- expected, do: assert_push_event(view, ^event, ^payload, 0)

    refute_push_event(view, "preview", _payload, 0)
    refute_push_event(view, "drag_cancel", _payload, 0)
    refute_push_event(view, "revert", _payload, 0)
  end

  defp assert_converged(board, views) do
    for rectangle <- Canvas.list_elements_for_board!(board.id), view <- views do
      selector =
        "#element-#{rectangle.id}[x='#{rectangle.x}'][y='#{rectangle.y}']" <>
          "[width='#{rectangle.width}'][height='#{rectangle.height}']" <>
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
        {sender, rectangle, stored} = send_event(ctx, event)

        assert Enum.map(received_queries(), &query_kind/1) ==
                 expected_queries(event, sender, stored)

        for view <- ctx.views do
          if view == sender,
            do: assert_pushes(view, expected_reply(event, rectangle, stored)),
            else: assert_pushes(view, expected_relay(event, rectangle, stored))
        end

        assert_pushes(ctx.outsider, [])
      end

      :telemetry.detach(handler_id)
      assert_converged(ctx.board, ctx.views)
      assert_converged(ctx.other_board, [ctx.outsider])
    end
  end
end
