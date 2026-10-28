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

    assert [rectangle] = Canvas.list_rectangles_for_board!(board.id)
    assert has_element?(view, "#rect-#{rectangle.id}[data-version='0']")
  end

  test "a rectangle created elsewhere appears", %{conn: conn, board: board} do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    rectangle = Canvas.create_rectangle!(%{x: 300, y: 400, board_id: board.id})

    assert render(view) =~ "rect-#{rectangle.id}"
    assert has_element?(view, "#rect-#{rectangle.id}[data-x='300'][data-y='400']")
  end

  test "existing rectangles render on mount", %{conn: conn, board: board} do
    rectangle = Canvas.create_rectangle!(%{x: 5, y: 6, board_id: board.id})
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
    assert has_element?(view, "#rect-#{rectangle.id}")
  end

  test "a create broadcast for an already loaded rectangle is not counted twice", %{
    conn: conn,
    board: board
  } do
    existing = Canvas.create_rectangle!(%{x: 100, y: 100, board_id: board.id})
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    send(view.pid, %Phoenix.Socket.Broadcast{
      event: "create",
      payload: Canvas.rectangle_event(existing)
    })

    view |> element("#add-rectangle") |> render_click()

    assert [_existing, added] = Canvas.list_rectangles_for_board!(board.id)
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
    rectangle = Canvas.create_rectangle!(%{x: 5, y: 6, board_id: board.id})
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    Canvas.commit_position!(rectangle.id, board.id, %{x: 70, y: 80})
    assert render(view) =~ "data-version=\"1\""
    assert has_element?(view, "#rect-#{rectangle.id}[data-x='70'][data-version='1']")

    send(view.pid, %Phoenix.Socket.Broadcast{
      event: "commit_position",
      payload: %{id: rectangle.id, board_id: board.id, x: 1, y: 1, version: 0}
    })

    assert has_element?(view, "#rect-#{rectangle.id}[data-x='70'][data-version='1']")
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
        payload: %{id: id, board_id: board.id, x: x, y: x, version: version}
      })
    end

    assert has_element?(view, "#rect-#{id}[data-x='70'][data-version='1']")
  end
end
