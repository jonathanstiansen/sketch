defmodule SketchWeb.BoardLiveDragTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Sketch.Canvas

  @query_event [:sketch, :repo, :query]
  @drag_id "11111111-2222-4333-8444-555555555555"

  setup %{conn: conn} do
    board = Canvas.create_board!()
    rectangle = Canvas.create_rectangle!(%{x: 100, y: 100, board_id: board.id})
    {:ok, dragger, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
    %{board: board, rectangle: rectangle, dragger: dragger, watcher: watcher}
  end

  def forward_query(_event, _measurements, metadata, %{test_pid: test_pid, pids: pids}) do
    if self() in pids, do: send(test_pid, {:repo_query, self(), metadata.query})
  end

  defp record_queries(views) do
    handler_id = {__MODULE__, make_ref()}
    pids = Enum.map(views, & &1.pid)
    config = %{test_pid: self(), pids: pids}
    :ok = :telemetry.attach(handler_id, @query_event, &__MODULE__.forward_query/4, config)
    on_exit(fn -> :telemetry.detach(handler_id) end)
  end

  defp preview(rectangle, seq, x) do
    %{
      "rectangle_id" => rectangle.id,
      "drag_id" => @drag_id,
      "seq" => seq,
      "base_version" => rectangle.version,
      "x" => x,
      "y" => 200
    }
  end

  describe "transient previews never trigger persistence (A10)" do
    test "previews and cancels reach other views without any database query", ctx do
      %{rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx
      record_queries([dragger, watcher])

      for seq <- 1..50 do
        render_hook(dragger, "preview", preview(rectangle, seq, 100 + seq))
      end

      render_hook(dragger, "drag_cancel", %{
        "rectangle_id" => rectangle.id,
        "drag_id" => @drag_id
      })

      assert_push_event(watcher, "preview", %{seq: 1, x: 101, y: 200, base_version: 0})
      assert_push_event(watcher, "preview", %{seq: 50, x: 150})
      assert_push_event(watcher, "drag_cancel", %{rectangle_id: rectangle_id})
      assert rectangle_id == rectangle.id

      render(dragger)
      render(watcher)
      refute_received {:repo_query, _pid, _query}
      refute_push_event(dragger, "preview", %{})

      assert [%{x: 100, y: 100, version: 0}] =
               Canvas.list_rectangles_for_board!(rectangle.board_id)
    end

    test "a commit writes exactly one update and broadcasts the next version", ctx do
      %{board: board, rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx
      :ok = SketchWeb.Endpoint.subscribe("board:#{board.id}")
      record_queries([dragger, watcher])

      render_hook(dragger, "commit", %{
        "drag_id" => @drag_id,
        "rectangle_id" => rectangle.id,
        "x" => 640,
        "y" => 200
      })

      assert_receive {:repo_query, pid, "UPDATE" <> _query}
      assert pid == dragger.pid
      refute_received {:repo_query, _pid, "UPDATE" <> _query}

      assert_receive %Phoenix.Socket.Broadcast{
        event: "commit_position",
        payload: %{x: 640, y: 200, version: 1}
      }

      assert has_element?(watcher, "#rect-#{rectangle.id}[data-x='640'][data-version='1']")
      assert has_element?(dragger, "#rect-#{rectangle.id}[data-x='640'][data-version='1']")
    end
  end

  test "previews on one board do not reach another board (A07)", ctx do
    %{conn: conn, rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx
    other_board = Canvas.create_board!()
    {:ok, outsider, _html} = live(conn, ~p"/b/#{other_board.id}")

    render_hook(dragger, "preview", preview(rectangle, 1, 300))

    assert_push_event(watcher, "preview", %{x: 300})
    render(outsider)
    refute_push_event(outsider, "preview", %{})
  end

  test "invalid preview, cancel and commit payloads are ignored", ctx do
    %{rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx

    for payload <- [
          %{},
          %{preview(rectangle, 1, 100) | "x" => 5000},
          %{preview(rectangle, 1, 100) | "x" => "10"},
          %{preview(rectangle, 1, 100) | "seq" => -1},
          %{preview(rectangle, 1, 100) | "rectangle_id" => "short"},
          Map.delete(preview(rectangle, 1, 100), "base_version")
        ] do
      render_hook(dragger, "preview", payload)
    end

    render_hook(dragger, "drag_cancel", %{"rectangle_id" => 1})

    render_hook(dragger, "commit", %{
      "drag_id" => @drag_id,
      "rectangle_id" => rectangle.id,
      "x" => 1.5,
      "y" => 2
    })

    assert render(dragger) =~ "rect-#{rectangle.id}"
    render(watcher)
    refute_push_event(watcher, "preview", %{})
    refute_push_event(watcher, "drag_cancel", %{})
    assert [%{version: 0}] = Canvas.list_rectangles_for_board!(rectangle.board_id)
  end

  test "a failed commit flashes an error and asks the client to revert", ctx do
    %{dragger: dragger} = ctx
    other_board = Canvas.create_board!()
    foreign = Canvas.create_rectangle!(%{x: 10, y: 10, board_id: other_board.id})

    render_hook(dragger, "commit", %{
      "drag_id" => @drag_id,
      "rectangle_id" => foreign.id,
      "x" => 500,
      "y" => 500
    })

    assert_push_event(dragger, "revert", %{rectangle_id: rectangle_id})
    assert rectangle_id == foreign.id
    assert render(dragger) =~ "Could not move rectangle"
    assert [%{x: 10, version: 0}] = Canvas.list_rectangles_for_board!(other_board.id)
  end

  test "a failed commit cancels the drag preview in other views", ctx do
    %{rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx

    render_hook(dragger, "preview", preview(rectangle, 1, 300))
    assert_push_event(watcher, "preview", %{drag_id: @drag_id})

    render_hook(dragger, "commit", %{
      "rectangle_id" => rectangle.id,
      "drag_id" => @drag_id,
      "x" => 5000,
      "y" => 200
    })

    assert_push_event(dragger, "revert", %{})
    assert_push_event(watcher, "drag_cancel", %{rectangle_id: rectangle_id, drag_id: @drag_id})
    assert rectangle_id == rectangle.id
    assert [%{x: 100, version: 0}] = Canvas.list_rectangles_for_board!(rectangle.board_id)
  end

  test "the canvas hook gets the position bounds from the server", %{dragger: dragger} do
    %{max_x: max_x, max_y: max_y} = Canvas.geometry()
    assert has_element?(dragger, "#canvas-viewport[data-max-x='#{max_x}'][data-max-y='#{max_y}']")
  end
end
