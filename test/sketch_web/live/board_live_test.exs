defmodule SketchWeb.BoardLiveTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Sketch.Canvas

  setup do
    %{board: Canvas.create_board!()}
  end

  test "clicking add renders a rectangle", %{conn: conn, board: board} do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    view |> element("#add-rectangle") |> render_click()

    assert [rectangle] = Canvas.list_elements_for_board!(board.id)
    assert has_element?(view, "#element-#{rectangle.id}[data-version='0']")
  end

  @drag_id "11111111-2222-4333-8444-555555555555"

  defp create_params(x, y, width, height) do
    %{
      "kind" => "rectangle",
      "drag_id" => @drag_id,
      "x" => x,
      "y" => y,
      "width" => width,
      "height" => height
    }
  end

  defp box_selector(element, %{x: x, y: y, width: width, height: height}) do
    "#element-#{element.id}[data-kind='rectangle'][x='#{x}'][y='#{y}']" <>
      "[width='#{width}'][height='#{height}'][data-version='0']"
  end

  test "create_element stores the clamped drawn box and another view renders it at that size", %{
    conn: conn,
    board: board
  } do
    {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

    for {sent, stored} <- [
          {{640, 320, 300, 20}, {640, 320, 300, 20}},
          {{0, 0, 1, 1}, {0, 0, 1, 1}},
          {{0, 3920, 120, 80}, {0, 3920, 120, 80}},
          {{-50, 99_999, 120, 80}, {0, 3920, 120, 80}},
          {{3999, -1, 500, 0}, {3500, 0, 500, 1}},
          {{10, 10, 9_000, 9_000}, {0, 0, 4000, 4000}}
        ] do
      {x, y, width, height} = sent
      render_hook(creator, "create_element", create_params(x, y, width, height))

      {x, y, width, height} = stored
      box = %{x: x, y: y, width: width, height: height}

      element =
        board.id
        |> Canvas.list_elements_for_board!()
        |> Enum.find(&(Map.take(&1, [:x, :y, :width, :height]) == box))

      assert element, "no element stored as #{inspect(box)} for #{inspect(sent)}"
      assert has_element?(watcher, box_selector(element, box))
      assert has_element?(creator, box_selector(element, box))
    end

    assert length(Canvas.list_elements_for_board!(board.id)) == 6
  end

  test "a drawn diamond is stored with its kind and rendered as a polygon in every view", %{
    conn: conn,
    board: board
  } do
    {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

    render_hook(creator, "create_element", %{
      create_params(10, 20, 101, 40)
      | "kind" => "diamond"
    })

    assert [%{kind: :diamond, id: id}] = Canvas.list_elements_for_board!(board.id)

    for view <- [creator, watcher] do
      assert has_element?(
               view,
               "polygon#element-#{id}[data-kind='diamond'][x='10'][width='101'][points='60.5,20 111,40 60.5,60 10,40']"
             )
    end
  end

  test "a drawn ellipse is stored with its kind and rendered inscribed in its box in every view",
       %{
         conn: conn,
         board: board
       } do
    {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

    render_hook(creator, "create_element", %{
      create_params(10, 20, 101, 40)
      | "kind" => "ellipse"
    })

    assert [%{kind: :ellipse, id: id}] = Canvas.list_elements_for_board!(board.id)

    for view <- [creator, watcher] do
      assert has_element?(
               view,
               "ellipse#element-#{id}[data-kind='ellipse'][cx='60.5'][cy='40'][rx='50.5'][ry='20']"
             )
    end
  end

  test "create_element ends the draw preview in other views", %{conn: conn, board: board} do
    {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

    render_hook(creator, "draw_preview", %{
      "kind" => "rectangle",
      "drag_id" => @drag_id,
      "seq" => 1,
      "x" => 10,
      "y" => 20,
      "width" => 30,
      "height" => 40
    })

    assert_push_event(watcher, "draw_preview", %{
      drag_id: @drag_id,
      seq: 1,
      kind: "rectangle",
      x: 10,
      y: 20,
      width: 30,
      height: 40
    })

    assert Canvas.list_elements_for_board!(board.id) == []

    render_hook(creator, "create_element", create_params(10, 20, 30, 40))
    assert_push_event(watcher, "draw_end", %{drag_id: @drag_id})
    refute_push_event(creator, "draw_end", %{})
    assert [%{width: 30, height: 40}] = Canvas.list_elements_for_board!(board.id)
  end

  test "create_element with a bad kind or non-integer box creates nothing", %{
    conn: conn,
    board: board
  } do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    for params <- [
          %{create_params(10, 10, 5, 5) | "x" => "10"},
          %{create_params(10, 10, 5, 5) | "width" => 1.5},
          %{create_params(10, 10, 5, 5) | "kind" => "circle"},
          %{create_params(10, 10, 5, 5) | "drag_id" => "short"},
          Map.delete(create_params(10, 10, 5, 5), "height"),
          %{}
        ] do
      render_hook(view, "create_element", params)
    end

    assert Canvas.list_elements_for_board!(board.id) == []
  end

  test "a rectangle created elsewhere appears", %{conn: conn, board: board} do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    rectangle = Canvas.create_element!(rectangle(%{x: 300, y: 400, board_id: board.id}))

    assert render(view) =~ "element-#{rectangle.id}"
    assert has_element?(view, "#element-#{rectangle.id}[data-x='300'][data-y='400']")
  end

  test "existing rectangles render on mount", %{conn: conn, board: board} do
    rectangle = Canvas.create_element!(rectangle(%{x: 5, y: 6, board_id: board.id}))
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
    assert has_element?(view, "#element-#{rectangle.id}")
  end

  test "a create broadcast for an already loaded rectangle is not counted twice", %{
    conn: conn,
    board: board
  } do
    existing = Canvas.create_element!(rectangle(%{x: 100, y: 100, board_id: board.id}))
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    send(view.pid, %Phoenix.Socket.Broadcast{
      event: "create",
      payload: Canvas.element_event(existing)
    })

    view |> element("#add-rectangle") |> render_click()

    assert [_existing, added] = Canvas.list_elements_for_board!(board.id)
    assert {added.x, added.y} == {250, 250}
  end

  test "unknown and malformed ids redirect without creating a board", %{conn: conn} do
    boards_before = Ash.count!(Sketch.Canvas.Board)

    for id <- [Ash.UUID.generate(), "not-a-uuid"] do
      assert {:error, {:redirect, %{to: "/", flash: %{"error" => "Board not found"}}}} =
               live(conn, ~p"/b/#{id}")
    end

    assert Ash.count!(Sketch.Canvas.Board) == boards_before
  end

  test "shows the shareable board url", %{conn: conn, board: board} do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
    assert render(view) =~ "/b/#{board.id}"
    assert has_element?(view, "#board-url")
  end

  test "a committed position updates the rectangle, ignoring stale versions", %{
    conn: conn,
    board: board
  } do
    rectangle = Canvas.create_element!(rectangle(%{x: 5, y: 6, board_id: board.id}))
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    Canvas.commit_position!(rectangle.id, board.id, %{x: 70, y: 80})
    assert render(view) =~ "data-version=\"1\""
    assert has_element?(view, "#element-#{rectangle.id}[data-x='70'][data-version='1']")

    send(view.pid, %Phoenix.Socket.Broadcast{
      event: "commit_position",
      payload: rectangle(%{id: rectangle.id, board_id: board.id, x: 1, y: 1, version: 0})
    })

    assert has_element?(view, "#element-#{rectangle.id}[data-x='70'][data-version='1']")
  end

  test "a create arriving after a newer commit_position does not undo it", %{
    conn: conn,
    board: board
  } do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
    id = Ash.UUID.generate()

    for {event, x, version} <- [{"commit_position", 70, 1}, {"create", 5, 0}] do
      send(view.pid, %Phoenix.Socket.Broadcast{
        event: event,
        payload: rectangle(%{id: id, board_id: board.id, x: x, y: x, version: version})
      })
    end

    assert has_element?(view, "#element-#{id}[data-x='70'][data-version='1']")
  end

  describe "lines" do
    defp line_params(box, points) do
      %{"kind" => "line", "drag_id" => @drag_id}
      |> Map.merge(Map.new(box, fn {key, value} -> {to_string(key), value} end))
      |> Map.put("points", Enum.map(points, fn {x, y} -> %{"x" => x, "y" => y} end))
    end

    defp line_selector(id, {x1, y1, x2, y2}, version) do
      "g#element-#{id}[data-kind='line'][data-version='#{version}'] " <>
        "line[data-line-stroke][x1='#{x1}'][y1='#{y1}'][x2='#{x2}'][y2='#{y2}']"
    end

    test "a drawn line is stored with its relative points and rendered in every view", %{
      conn: conn,
      board: board
    } do
      {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 200, y: 220, width: 200, height: 80}

      render_hook(creator, "create_element", line_params(box, [{200, 80}, {0, 0}]))

      assert [%{kind: :line, id: id, x: 200, y: 220, width: 200, height: 80} = line] =
               Canvas.list_elements_for_board!(board.id)

      assert Enum.map(line.points, &{&1.x, &1.y}) == [{200, 80}, {0, 0}]

      for view <- [creator, watcher] do
        assert has_element?(view, line_selector(id, {400, 300, 200, 220}, 0))
        assert has_element?(view, "#element-#{id}[data-points='200,80 0,0'] line[data-line-hit]")
      end
    end

    test "a drawn arrow keeps its start and end and renders an arrowhead on the end", %{
      conn: conn,
      board: board
    } do
      {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 200, y: 220, width: 200, height: 80}
      params = box |> line_params([{200, 80}, {0, 0}]) |> Map.put("kind", "arrow")

      render_hook(view, "create_element", params)

      assert [%{kind: :arrow, id: id} = arrow] = Canvas.list_elements_for_board!(board.id)
      assert Enum.map(arrow.points, &{&1.x, &1.y}) == [{200, 80}, {0, 0}]

      assert has_element?(
               view,
               "g#element-#{id}[data-kind='arrow'][data-points='200,80 0,0'] " <>
                 "line[data-line-stroke][marker-end='url(#arrowhead)'][x1='400'][y1='300'][x2='200'][y2='220']"
             )

      assert has_element?(view, "#canvas defs marker#arrowhead")
    end

    test "the server rebuilds a line's box around its points clamped into the canvas", %{
      conn: conn,
      board: board
    } do
      {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 3900, y: 10, width: 300, height: 5}

      render_hook(view, "create_element", line_params(box, [{0, 5}, {300, 5}]))

      assert [%{id: id, x: 3900, y: 15, width: 100, height: 0}] =
               Canvas.list_elements_for_board!(board.id)

      assert has_element?(view, line_selector(id, {3900, 15, 4000, 15}, 0))
    end

    test "a line with too few, too many or malformed points creates nothing", %{
      conn: conn,
      board: board
    } do
      {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 10, y: 10, width: 10, height: 10}

      for params <- [
            line_params(box, []),
            line_params(box, [{0, 0}]),
            line_params(box, [{0, 0}, {5, 5}, {10, 10}]),
            line_params(box, [{0, 0}, {5.5, 5}]),
            %{line_params(box, []) | "points" => [%{"x" => 1}, %{"x" => 2, "y" => 2}]},
            %{line_params(box, []) | "points" => "0,0 10,10"}
          ] do
        render_hook(view, "create_element", params)
      end

      assert Canvas.list_elements_for_board!(board.id) == []
    end

    test "a line draw preview carries its points to other views, even when 0 tall", %{
      conn: conn,
      board: board
    } do
      {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      params = line_params(%{x: 10, y: 20, width: 30, height: 0}, [{30, 0}, {0, 0}])

      render_hook(creator, "draw_preview", Map.put(params, "seq", 1))

      assert_push_event(watcher, "draw_preview", %{
        kind: "line",
        seq: 1,
        width: 30,
        height: 0,
        points: [%{x: 30, y: 0}, %{x: 0, y: 0}]
      })

      render_hook(creator, "draw_preview", %{Map.put(params, "seq", 2) | "kind" => "rectangle"})
      refute_push_event(watcher, "draw_preview", %{seq: 2})
      assert Canvas.list_elements_for_board!(board.id) == []
    end

    test "dragging an endpoint previews to other views and commit_shape stores the new shape", %{
      conn: conn,
      board: board
    } do
      line =
        Canvas.create_element!(%{
          kind: :line,
          x: 100,
          y: 100,
          width: 100,
          height: 0,
          points: [%{x: 0, y: 0}, %{x: 100, y: 0}],
          board_id: board.id
        })

      {:ok, editor, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

      shape = %{
        "element_id" => line.id,
        "drag_id" => @drag_id,
        "x" => 100,
        "y" => 50,
        "width" => 100,
        "height" => 50,
        "points" => [%{"x" => 0, "y" => 50}, %{"x" => 100, "y" => 0}]
      }

      render_hook(editor, "preview", Map.merge(shape, %{"seq" => 1, "base_version" => 0}))

      assert_push_event(watcher, "preview", %{
        element_id: element_id,
        height: 50,
        points: [%{x: 0, y: 50}, %{x: 100, y: 0}]
      })

      assert element_id == line.id

      render_hook(editor, "commit_shape", shape)

      for view <- [editor, watcher] do
        assert has_element?(view, line_selector(line.id, {100, 100, 200, 50}, 1))
      end

      render_hook(editor, "commit_shape", %{
        shape
        | "points" => [%{"x" => 0, "y" => 51}, %{"x" => 100, "y" => 0}]
      })

      assert_push_event(editor, "revert", %{element_id: ^element_id})
      assert [%{version: 1, height: 50}] = Canvas.list_elements_for_board!(board.id)
    end

    test "moving a line commits only its position; the points move with it", %{
      conn: conn,
      board: board
    } do
      line =
        Canvas.create_element!(%{
          kind: :line,
          x: 100,
          y: 100,
          width: 0,
          height: 40,
          points: [%{x: 0, y: 40}, %{x: 0, y: 0}],
          board_id: board.id
        })

      {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

      render_hook(view, "commit", %{
        "element_id" => line.id,
        "drag_id" => @drag_id,
        "x" => 4000,
        "y" => 0
      })

      assert has_element?(view, line_selector(line.id, {4000, 40, 4000, 0}, 1))
    end
  end
end
