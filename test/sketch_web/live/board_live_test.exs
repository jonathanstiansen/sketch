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
end
