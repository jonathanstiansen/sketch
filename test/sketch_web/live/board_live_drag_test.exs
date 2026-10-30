defmodule SketchWeb.BoardLiveDragTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Sketch.Canvas

  @query_event [:sketch, :repo, :query]
  @drag_id "11111111-2222-4333-8444-555555555555"

  setup %{conn: conn} do
    board = Canvas.create_board!()
    rectangle = Canvas.create_element!(rectangle(%{x: 100, y: 100, board_id: board.id}))
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
      "element_id" => rectangle.id,
      "drag_id" => @drag_id,
      "seq" => seq,
      "base_version" => rectangle.version,
      "x" => x,
      "y" => 200,
      "width" => 120,
      "height" => 80
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
        "element_id" => rectangle.id,
        "drag_id" => @drag_id
      })

      assert_push_event(watcher, "preview", %{seq: 1, x: 101, y: 200, base_version: 0})
      assert_push_event(watcher, "preview", %{seq: 50, x: 150})
      assert_push_event(watcher, "drag_cancel", %{element_id: rectangle_id})
      assert rectangle_id == rectangle.id

      render(dragger)
      render(watcher)
      refute_received {:repo_query, _pid, _query}
      refute_push_event(dragger, "preview", %{})

      assert [%{x: 100, y: 100, version: 0}] =
               Canvas.list_elements_for_board!(rectangle.board_id)
    end

    test "cursor moves and leaves reach other views without any database query", ctx do
      %{dragger: dragger, watcher: watcher} = ctx
      record_queries([dragger, watcher])

      for seq <- 1..50 do
        render_hook(dragger, "cursor", %{"x" => 100 + seq, "y" => 200, "seq" => seq})
      end

      render_hook(dragger, "cursor_leave", %{"seq" => 51})

      assert_push_event(watcher, "cursor", %{seq: 1, x: 101, y: 200})
      assert_push_event(watcher, "cursor", %{seq: 50, x: 150})
      assert_push_event(watcher, "cursor_leave", %{seq: 51})

      render(dragger)
      render(watcher)
      refute_received {:repo_query, _pid, _query}
      refute_push_event(dragger, "cursor", %{})
    end

    test "a commit writes exactly one update and broadcasts the next version", ctx do
      %{board: board, rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx
      :ok = SketchWeb.Endpoint.subscribe("board:#{board.id}")
      record_queries([dragger, watcher])

      render_hook(dragger, "commit", %{
        "drag_id" => @drag_id,
        "element_id" => rectangle.id,
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

      assert has_element?(watcher, "#element-#{rectangle.id}[data-x='640'][data-version='1']")
      assert has_element?(dragger, "#element-#{rectangle.id}[data-x='640'][data-version='1']")
    end
  end

  test "previews on one board do not reach another board (A07)", ctx do
    %{conn: conn, rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx
    other_board = Canvas.create_board!()
    {:ok, outsider, _html} = live(conn, ~p"/b/#{other_board.id}")

    render_hook(dragger, "preview", preview(rectangle, 1, 300))
    render_hook(dragger, "cursor", %{"x" => 300, "y" => 300, "seq" => 1})
    render_hook(dragger, "cursor_leave", %{"seq" => 2})

    assert_push_event(watcher, "preview", %{x: 300})
    assert_push_event(watcher, "cursor", %{x: 300, y: 300})
    assert_push_event(watcher, "cursor_leave", %{seq: 2})
    render(outsider)
    refute_push_event(outsider, "preview", %{})
    refute_push_event(outsider, "cursor", %{})
    refute_push_event(outsider, "cursor_leave", %{})
  end

  test "invalid preview, cancel and commit payloads are ignored", ctx do
    %{rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx

    for payload <- [
          %{},
          %{preview(rectangle, 1, 100) | "x" => 5000},
          %{preview(rectangle, 1, 100) | "x" => 3881},
          %{preview(rectangle, 1, 100) | "width" => 0},
          %{preview(rectangle, 1, 100) | "x" => "10"},
          %{preview(rectangle, 1, 100) | "seq" => -1},
          %{preview(rectangle, 1, 100) | "element_id" => "short"},
          Map.delete(preview(rectangle, 1, 100), "base_version")
        ] do
      render_hook(dragger, "preview", payload)
    end

    render_hook(dragger, "drag_cancel", %{"element_id" => 1})

    render_hook(dragger, "commit", %{
      "drag_id" => @drag_id,
      "element_id" => rectangle.id,
      "x" => 1.5,
      "y" => 2
    })

    assert render(dragger) =~ "element-#{rectangle.id}"
    render(watcher)
    refute_push_event(watcher, "preview", %{})
    refute_push_event(watcher, "drag_cancel", %{})
    assert [%{version: 0}] = Canvas.list_elements_for_board!(rectangle.board_id)
  end

  test "an older committed notification cannot overwrite newer state", ctx do
    %{board: board, rectangle: rectangle, watcher: watcher} = ctx

    committed = fn version, x ->
      %Phoenix.Socket.Broadcast{
        topic: "board:#{board.id}",
        event: "commit_position",
        payload:
          rectangle_event(%{id: rectangle.id, board_id: board.id, x: x, y: 50, version: version})
      }
    end

    send(watcher.pid, committed.(3, 300))
    assert render(watcher) =~ ~s(data-version="3")

    send(watcher.pid, committed.(2, 200))
    render(watcher)

    assert has_element?(watcher, "#element-#{rectangle.id}[data-version='3'][data-x='300']")
    refute has_element?(watcher, "#element-#{rectangle.id}[data-version='2']")
  end

  test "a failed commit flashes an error and asks the client to revert", ctx do
    %{dragger: dragger} = ctx
    other_board = Canvas.create_board!()
    foreign = Canvas.create_element!(rectangle(%{x: 10, y: 10, board_id: other_board.id}))

    render_hook(dragger, "commit", %{
      "drag_id" => @drag_id,
      "element_id" => foreign.id,
      "x" => 500,
      "y" => 500
    })

    assert_push_event(dragger, "revert", %{element_id: rectangle_id})
    assert rectangle_id == foreign.id
    assert render(dragger) =~ "Could not move element"
    assert [%{x: 10, version: 0}] = Canvas.list_elements_for_board!(other_board.id)
  end

  test "a failed commit cancels the drag preview in other views", ctx do
    %{rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx

    render_hook(dragger, "preview", preview(rectangle, 1, 300))
    assert_push_event(watcher, "preview", %{drag_id: @drag_id})

    render_hook(dragger, "commit", %{
      "element_id" => rectangle.id,
      "drag_id" => @drag_id,
      "x" => 5000,
      "y" => 200
    })

    assert_push_event(dragger, "revert", %{})
    assert_push_event(watcher, "drag_cancel", %{element_id: rectangle_id, drag_id: @drag_id})
    assert rectangle_id == rectangle.id
    assert [%{x: 100, version: 0}] = Canvas.list_elements_for_board!(rectangle.board_id)
  end

  test "the canvas hook gets the canvas size from the server", %{dragger: dragger} do
    %{canvas_width: width, canvas_height: height} = Canvas.geometry()

    assert has_element?(
             dragger,
             "#canvas-viewport[data-canvas-width='#{width}'][data-canvas-height='#{height}']"
           )
  end

  describe "resizing" do
    defp commit_shape(view, element, box) do
      params = Map.new(box, fn {key, value} -> {to_string(key), value} end)

      render_hook(
        view,
        "commit_shape",
        Map.merge(params, %{"element_id" => element.id, "drag_id" => @drag_id})
      )
    end

    test "a resize preview reaches other views and a commit_shape writes one update", ctx do
      %{board: board, rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx
      :ok = SketchWeb.Endpoint.subscribe("board:#{board.id}")
      record_queries([dragger, watcher])

      render_hook(dragger, "preview", %{preview(rectangle, 1, 90) | "width" => 400, "height" => 7})

      assert_push_event(watcher, "preview", %{x: 90, y: 200, width: 400, height: 7, seq: 1})
      refute_received {:repo_query, _pid, _query}

      commit_shape(dragger, rectangle, %{x: 90, y: 200, width: 400, height: 7})

      assert_receive {:repo_query, pid, "UPDATE" <> _query}
      assert pid == dragger.pid
      refute_received {:repo_query, _pid, "UPDATE" <> _query}

      assert_receive %Phoenix.Socket.Broadcast{
        event: "commit_shape",
        payload: %{x: 90, y: 200, width: 400, height: 7, version: 1}
      }

      selector =
        "#element-#{rectangle.id}[x='90'][y='200'][width='400'][height='7'][data-version='1']"

      assert has_element?(watcher, selector)
      assert has_element?(dragger, selector)
    end

    test "an out-of-bounds commit_shape reverts the resizer and cancels the preview", ctx do
      %{rectangle: rectangle, dragger: dragger, watcher: watcher} = ctx

      commit_shape(dragger, rectangle, %{x: 3000, y: 0, width: 1001, height: 10})

      assert_push_event(dragger, "revert", %{element_id: element_id})
      assert element_id == rectangle.id
      assert_push_event(watcher, "drag_cancel", %{element_id: ^element_id, drag_id: @drag_id})
      assert render(dragger) =~ "Could not resize element"

      assert [%{width: 120, height: 80, version: 0}] =
               Canvas.list_elements_for_board!(rectangle.board_id)
    end

    test "draw previews and cancels are relayed without any database query", ctx do
      %{board: board, dragger: dragger, watcher: watcher} = ctx
      record_queries([dragger, watcher])

      draw = %{
        "kind" => "rectangle",
        "drag_id" => @drag_id,
        "x" => 5,
        "y" => 6,
        "width" => 7,
        "height" => 8
      }

      for seq <- 1..20, do: render_hook(dragger, "draw_preview", Map.put(draw, "seq", seq))
      render_hook(dragger, "draw_preview", %{draw | "width" => 4000} |> Map.put("seq", 21))
      render_hook(dragger, "draw_cancel", %{"drag_id" => @drag_id})

      assert_push_event(watcher, "draw_preview", %{seq: 1, x: 5, width: 7})
      assert_push_event(watcher, "draw_preview", %{seq: 20})
      refute_push_event(watcher, "draw_preview", %{seq: 21})
      assert_push_event(watcher, "draw_end", %{drag_id: @drag_id})

      render(dragger)
      render(watcher)
      refute_received {:repo_query, _pid, _query}
      assert [_rectangle] = Canvas.list_elements_for_board!(board.id)
    end
  end
end
