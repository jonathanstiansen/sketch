defmodule SketchWeb.BoardLiveCursorTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Sketch.Canvas

  setup %{conn: conn} do
    board = Canvas.create_board!()
    {:ok, mover, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
    %{board: board, mover: mover, watcher: watcher}
  end

  defp cursor(x, y, seq), do: %{"x" => x, "y" => y, "seq" => seq}

  test "a cursor reaches the other views with the mover's name and colour, not the mover", ctx do
    %{mover: mover, watcher: watcher} = ctx

    render_hook(mover, "cursor", cursor(120, 340, 1))

    assert_push_event(watcher, "cursors", %{
      cursors: [%{viewer_id: viewer_id, name: name, color: color, x: 120, y: 340, seq: 1}]
    })

    assert viewer_id =~ ~r/^[A-Za-z0-9_-]{11}$/
    assert name =~ ~r/^[A-Z][a-z]+ [A-Z][a-z]+$/
    assert color in ~w(ink red green blue orange)a
    assert has_element?(mover, "#viewer-name", name)
    refute has_element?(watcher, "#viewer-name", name)
    refute_push_event(mover, "cursors", %{})
  end

  test "each view has its own identity, and the name is shown to its owner", ctx do
    %{mover: mover, watcher: watcher} = ctx

    render_hook(mover, "cursor", cursor(1, 1, 1))
    render_hook(watcher, "cursor", cursor(2, 2, 1))

    assert_push_event(watcher, "cursors", %{cursors: [%{viewer_id: mover_id, name: mover_name}]})

    assert_push_event(mover, "cursors", %{cursors: [%{viewer_id: watcher_id, name: watcher_name}]})

    assert mover_id != watcher_id
    assert has_element?(mover, "#viewer-name", mover_name)
    assert has_element?(watcher, "#viewer-name", watcher_name)
  end

  test "the cursor layer is an ignored container above the elements", %{mover: mover} do
    assert has_element?(
             mover,
             "svg#canvas > g#remote-cursors[phx-update='ignore'][pointer-events='none']"
           )
  end

  test "a leave carries the viewer and its sequence number", ctx do
    %{mover: mover, watcher: watcher} = ctx

    render_hook(mover, "cursor", cursor(1, 1, 1))
    render_hook(mover, "cursor_leave", %{"seq" => 2})

    assert_push_event(watcher, "cursors", %{cursors: [%{viewer_id: viewer_id, seq: 1}]})

    assert_push_event(watcher, "cursors", %{
      cursors: [%{viewer_id: ^viewer_id, seq: 2, left: true}]
    })
  end

  test "the edges of the canvas are valid positions", ctx do
    %{mover: mover, watcher: watcher} = ctx
    %{canvas_width: width, canvas_height: height} = Canvas.geometry()

    render_hook(mover, "cursor", cursor(0, 0, 1))
    render_hook(mover, "cursor", cursor(width, height, 2))

    assert_push_event(watcher, "cursors", %{cursors: [%{x: 0, y: 0, seq: 1}]})
    assert_push_event(watcher, "cursors", %{cursors: [%{x: ^width, y: ^height, seq: 2}]})
  end

  test "positions outside the canvas and malformed payloads are ignored", ctx do
    %{mover: mover, watcher: watcher} = ctx
    %{canvas_width: width, canvas_height: height} = Canvas.geometry()

    for payload <- [
          %{},
          cursor(-1, 0, 1),
          cursor(0, -1, 1),
          cursor(width + 1, 0, 1),
          cursor(0, height + 1, 1),
          cursor(1.5, 2, 1),
          cursor("10", 2, 1),
          cursor(10, 2, -1),
          cursor(10, 2, "1"),
          %{"x" => 10, "y" => 10},
          cursor(nil, nil, nil)
        ] do
      render_hook(mover, "cursor", payload)
    end

    for payload <- [%{}, %{"seq" => -1}, %{"seq" => "2"}] do
      render_hook(mover, "cursor_leave", payload)
    end

    render(watcher)
    refute_push_event(watcher, "cursors", %{})
  end

  test "moves that queue up while a view is busy reach it as each viewer's latest entry, never a superseded one",
       ctx do
    %{conn: conn, board: board, mover: mover, watcher: watcher} = ctx
    {:ok, other, _html} = live(conn, ~p"/b/#{board.id}")

    render_hook(mover, "cursor", cursor(1, 1, 1))
    assert_push_event(watcher, "cursors", %{cursors: [%{viewer_id: mover_id, seq: 1}]})

    :sys.suspend(watcher.pid)
    render_hook(mover, "cursor", cursor(2, 2, 2))
    render_hook(mover, "cursor", cursor(3, 3, 3))
    render_hook(other, "cursor", cursor(9, 9, 1))
    render_hook(mover, "cursor_leave", %{"seq" => 4})
    :sys.resume(watcher.pid)

    pushed = pushed_until_left(watcher, mover_id)
    mover_seqs = for %{viewer_id: ^mover_id, seq: seq} <- pushed, do: seq

    assert List.last(mover_seqs) == 4
    refute 3 in mover_seqs
    assert Enum.any?(pushed, &(&1.viewer_id != mover_id and &1.seq == 1))
  end

  defp pushed_until_left(view, viewer_id, pushed \\ []) do
    assert_push_event(view, "cursors", %{cursors: batch})
    pushed = pushed ++ batch

    if Enum.any?(batch, &(&1.viewer_id == viewer_id and Map.get(&1, :left))),
      do: pushed,
      else: pushed_until_left(view, viewer_id, pushed)
  end

  test "cursors are never stored", %{board: board, mover: mover} do
    render_hook(mover, "cursor", cursor(10, 10, 1))
    render_hook(mover, "cursor_leave", %{"seq" => 2})

    assert Canvas.list_elements_for_board!(board.id) == []
  end
end
