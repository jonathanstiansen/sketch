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

  describe "freehand strokes" do
    defp stroke_params(box, points) do
      %{
        "kind" => "freedraw",
        "drag_id" => @drag_id,
        "points" => Enum.map(points, fn {x, y} -> %{"x" => x, "y" => y} end)
      }
      |> Map.merge(Map.new(box, fn {key, value} -> {to_string(key), value} end))
    end

    defp stroke_selector(id, version) do
      "g#element-#{id}[data-kind='freedraw'][data-version='#{version}'] " <>
        "polyline[data-freedraw-stroke][stroke-linejoin='round'][stroke-linecap='round']"
    end

    test "a drawn stroke is stored with its relative points and rendered in every view", %{
      conn: conn,
      board: board
    } do
      {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 100, y: 200, width: 40, height: 30}

      render_hook(creator, "create_element", stroke_params(box, [{0, 0}, {20, 30}, {40, 10}]))

      assert [%{kind: :freedraw, id: id, x: 100, y: 200, width: 40, height: 30} = stroke] =
               Canvas.list_elements_for_board!(board.id)

      assert Enum.map(stroke.points, &{&1.x, &1.y}) == [{0, 0}, {20, 30}, {40, 10}]

      for view <- [creator, watcher] do
        assert has_element?(view, stroke_selector(id, 0) <> "[points='100,200 120,230 140,210']")

        assert has_element?(
                 view,
                 "#element-#{id}[data-points='0,0 20,30 40,10'] polyline[data-freedraw-hit]"
               )
      end
    end

    test "a stroke with too few, too many or malformed points creates nothing", %{
      conn: conn,
      board: board
    } do
      {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 0, y: 0, width: 600, height: 10}
      too_many = for x <- 0..500, do: {x, 0}

      for params <- [
            stroke_params(box, [{0, 0}]),
            stroke_params(box, too_many),
            stroke_params(box, [{0, 0}, {5.5, 5}])
          ] do
        render_hook(view, "create_element", params)
      end

      assert Canvas.list_elements_for_board!(board.id) == []
    end

    test "a stroke preview grows in other views and is never persisted", %{
      conn: conn,
      board: board
    } do
      {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 10, y: 20, width: 30, height: 10}

      render_hook(
        creator,
        "draw_preview",
        stroke_params(box, [{0, 0}, {10, 10}]) |> Map.put("seq", 1)
      )

      assert_push_event(watcher, "draw_preview", %{
        kind: "freedraw",
        seq: 1,
        points: [%{x: 0, y: 0}, %{x: 10, y: 10}]
      })

      render_hook(
        creator,
        "draw_preview",
        stroke_params(box, [{0, 0}, {10, 10}, {30, 0}]) |> Map.put("seq", 2)
      )

      assert_push_event(watcher, "draw_preview", %{seq: 2, points: [_, _, %{x: 30, y: 0}]})
      assert Canvas.list_elements_for_board!(board.id) == []
    end

    test "resizing a stroke commits the scaled points and every view renders them", %{
      conn: conn,
      board: board
    } do
      stroke =
        Canvas.create_element!(%{
          kind: :freedraw,
          x: 100,
          y: 100,
          width: 40,
          height: 20,
          points: [%{x: 0, y: 0}, %{x: 20, y: 20}, %{x: 40, y: 0}],
          board_id: board.id
        })

      {:ok, editor, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

      render_hook(editor, "commit_shape", %{
        "element_id" => stroke.id,
        "drag_id" => @drag_id,
        "x" => 100,
        "y" => 100,
        "width" => 80,
        "height" => 40,
        "points" => [
          %{"x" => 0, "y" => 0},
          %{"x" => 40, "y" => 40},
          %{"x" => 80, "y" => 0}
        ]
      })

      for view <- [editor, watcher] do
        assert has_element?(
                 view,
                 stroke_selector(stroke.id, 1) <> "[points='100,100 140,140 180,100']"
               )
      end

      assert [%{version: 1, width: 80, height: 40}] = Canvas.list_elements_for_board!(board.id)
    end
  end

  describe "text" do
    @edit_id "22222222-3333-4444-8555-666666666666"

    defp text_params(box, text) do
      %{"kind" => "text", "drag_id" => @drag_id, "text" => text}
      |> Map.merge(Map.new(box, fn {key, value} -> {to_string(key), value} end))
    end

    defp data_text(view, id) do
      view
      |> render()
      |> LazyHTML.from_fragment()
      |> LazyHTML.query("#element-#{id}")
      |> LazyHTML.attribute("data-text")
    end

    defp text_lines(view, id) do
      view
      |> render()
      |> LazyHTML.from_fragment()
      |> LazyHTML.query("#element-#{id} text[data-text-body] tspan")
      |> Enum.map(&LazyHTML.text/1)
    end

    test "typed text is stored and rendered one tspan per line in every view", %{
      conn: conn,
      board: board
    } do
      {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 300, y: 200, width: 90, height: 50}

      render_hook(creator, "create_element", text_params(box, "hello\n  world"))

      assert [%{kind: :text, id: id, text: "hello\n  world", x: 300, height: 50}] =
               Canvas.list_elements_for_board!(board.id)

      for view <- [creator, watcher] do
        assert has_element?(
                 view,
                 "g#element-#{id}[data-kind='text'][data-version='0'] rect[data-text-hit][width='90']"
               )

        assert has_element?(view, "#element-#{id} text[transform='translate(300 200)']")
        assert text_lines(view, id) == ["hello", "  world"]
      end
    end

    test "markup in text renders as literal text, never as elements", %{
      conn: conn,
      board: board
    } do
      {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      markup = "<script>alert(1)</script>\n<b>x</b>"

      render_hook(
        creator,
        "create_element",
        text_params(%{x: 0, y: 0, width: 9, height: 9}, markup)
      )

      assert [%{id: id}] = Canvas.list_elements_for_board!(board.id)

      for view <- [creator, watcher] do
        assert text_lines(view, id) == ["<script>alert(1)</script>", "<b>x</b>"]

        assert data_text(view, id) == [markup]

        refute has_element?(view, "#elements script")
        refute has_element?(view, "#elements b")
        assert render(view) =~ "&lt;script&gt;alert(1)&lt;/script&gt;"
      end
    end

    test "blank or overlong text creates nothing", %{conn: conn, board: board} do
      {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 0, y: 0, width: 10, height: 25}
      overlong = String.duplicate("a", Sketch.Canvas.geometry().max_text_length + 1)

      for text <- ["", " \n ", overlong] do
        render_hook(view, "create_element", text_params(box, text))
      end

      render_hook(view, "create_element", text_params(box, 42))
      assert Canvas.list_elements_for_board!(board.id) == []
    end

    test "editing commits the text and box together and every view renders the new text", %{
      conn: conn,
      board: board
    } do
      {:ok, editor, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

      element =
        Canvas.create_element!(%{
          kind: :text,
          x: 10,
          y: 20,
          width: 50,
          height: 25,
          text: "draft",
          board_id: board.id
        })

      render_hook(editor, "commit_shape", %{
        "element_id" => element.id,
        "drag_id" => @edit_id,
        "x" => 10,
        "y" => 20,
        "width" => 80,
        "height" => 50,
        "points" => [],
        "text" => "final\ncopy"
      })

      assert [%{text: "final\ncopy", width: 80, version: 1}] =
               Canvas.list_elements_for_board!(board.id)

      for view <- [editor, watcher] do
        assert has_element?(view, "#element-#{element.id}[data-version='1']")
        assert data_text(view, element.id) == ["final\ncopy"]

        assert text_lines(view, element.id) == ["final", "copy"]
      end

      render_hook(editor, "commit_shape", %{
        "element_id" => element.id,
        "drag_id" => @edit_id,
        "x" => 10,
        "y" => 20,
        "width" => 80,
        "height" => 50,
        "points" => [],
        "text" => "  "
      })

      element_id = element.id
      assert_push_event(editor, "revert", %{element_id: ^element_id})
      assert [%{text: "final\ncopy", version: 1}] = Canvas.list_elements_for_board!(board.id)
    end

    test "typing previews reach other views with their text and are never persisted", %{
      conn: conn,
      board: board
    } do
      {:ok, typist, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 40, y: 50, width: 30, height: 25}

      render_hook(
        typist,
        "draw_preview",
        text_params(box, "<b>hi") |> Map.merge(%{"seq" => 1, "points" => []})
      )

      assert_push_event(watcher, "draw_preview", %{kind: "text", seq: 1, text: "<b>hi"})

      element =
        Canvas.create_element!(%{
          kind: :text,
          x: 0,
          y: 0,
          width: 50,
          height: 25,
          text: "old",
          board_id: board.id
        })

      render_hook(typist, "preview", %{
        "element_id" => element.id,
        "drag_id" => @edit_id,
        "seq" => 1,
        "base_version" => 0,
        "x" => 0,
        "y" => 0,
        "width" => 60,
        "height" => 25,
        "points" => [],
        "text" => "older"
      })

      element_id = element.id
      assert_push_event(watcher, "preview", %{text: "older", element_id: ^element_id})

      assert [%{text: "old", version: 0}] = Canvas.list_elements_for_board!(board.id)
    end
  end

  describe "note" do
    @note_edit_id "33333333-4444-4555-8666-777777777777"

    defp note_params(box, text) do
      %{"kind" => "note", "drag_id" => @drag_id, "text" => text}
      |> Map.merge(Map.new(box, fn {key, value} -> {to_string(key), value} end))
    end

    defp note_element(view, id) do
      view |> render() |> LazyHTML.from_fragment() |> LazyHTML.query("#element-#{id}")
    end

    test "a note is created with its text and renders as a rounded body with a clipped text in every view",
         %{conn: conn, board: board} do
      {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 300, y: 200, width: 200, height: 160}

      render_hook(creator, "create_element", note_params(box, "<b>buy</b> milk\nand eggs"))

      assert [%{kind: :note, id: id, text: "<b>buy</b> milk\nand eggs", width: 200}] =
               Canvas.list_elements_for_board!(board.id)

      for view <- [creator, watcher] do
        assert has_element?(
                 view,
                 "g#element-#{id}[data-kind='note'][data-version='0'] rect[data-note-body][width='200'][height='160']"
               )

        assert has_element?(view, "#element-#{id} svg[data-note-clip][x='300'][y='200']")

        assert note_element(view, id) |> LazyHTML.attribute("data-text") == [
                 "<b>buy</b> milk\nand eggs"
               ]

        refute has_element?(view, "#elements b")
      end
    end

    test "an empty note is still created, and overlong text creates nothing", %{
      conn: conn,
      board: board
    } do
      {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
      box = %{x: 0, y: 0, width: 200, height: 160}

      render_hook(view, "create_element", note_params(box, ""))
      assert [%{kind: :note, text: ""}] = Canvas.list_elements_for_board!(board.id)

      overlong = String.duplicate("a", Sketch.Canvas.geometry().max_text_length + 1)
      render_hook(view, "create_element", note_params(box, overlong))
      assert [_only_one] = Canvas.list_elements_for_board!(board.id)
    end

    test "editing commits the text with the same box, and clearing it keeps an empty note", %{
      conn: conn,
      board: board
    } do
      {:ok, editor, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

      element =
        Canvas.create_element!(%{
          kind: :note,
          x: 10,
          y: 20,
          width: 200,
          height: 160,
          text: "draft",
          board_id: board.id
        })

      commit = fn text ->
        render_hook(editor, "commit_shape", %{
          "element_id" => element.id,
          "drag_id" => @note_edit_id,
          "x" => 10,
          "y" => 20,
          "width" => 200,
          "height" => 160,
          "points" => [],
          "text" => text
        })
      end

      commit.("final words")
      assert [%{text: "final words", version: 1}] = Canvas.list_elements_for_board!(board.id)

      for view <- [editor, watcher] do
        assert note_element(view, element.id) |> LazyHTML.attribute("data-text") == [
                 "final words"
               ]
      end

      commit.("")
      assert [%{text: "", version: 2}] = Canvas.list_elements_for_board!(board.id)
    end

    test "resizing commits the new box without touching the text", %{conn: conn, board: board} do
      {:ok, resizer, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

      element =
        Canvas.create_element!(%{
          kind: :note,
          x: 10,
          y: 20,
          width: 200,
          height: 160,
          text: "keep me",
          board_id: board.id
        })

      render_hook(resizer, "commit_shape", %{
        "element_id" => element.id,
        "drag_id" => @note_edit_id,
        "x" => 10,
        "y" => 20,
        "width" => 90,
        "height" => 60,
        "points" => []
      })

      assert [%{text: "keep me", width: 90, height: 60, version: 1}] =
               Canvas.list_elements_for_board!(board.id)

      for view <- [resizer, watcher] do
        assert has_element?(
                 view,
                 "g#element-#{element.id}[data-version='1'] rect[data-note-body][width='90'][height='60']"
               )
      end
    end

    test "typing previews of a new note reach other views as note previews", %{
      conn: conn,
      board: board
    } do
      {:ok, typist, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

      render_hook(
        typist,
        "draw_preview",
        note_params(%{x: 40, y: 50, width: 200, height: 160}, "hi there")
        |> Map.merge(%{"seq" => 1, "points" => []})
      )

      assert_push_event(watcher, "draw_preview", %{kind: "note", seq: 1, text: "hi there"})
      assert Canvas.list_elements_for_board!(board.id) == []
    end
  end
end
