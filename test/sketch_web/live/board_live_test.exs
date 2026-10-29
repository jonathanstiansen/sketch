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

  test "create_at creates a clamped rectangle that another view on the board receives", %{
    conn: conn,
    board: board
  } do
    {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
    %{max_x: max_x, max_y: max_y} = Canvas.geometry()

    for {sent, stored} <- [
          {{640, 320}, {640, 320}},
          {{0, max_y}, {0, max_y}},
          {{-50, 99_999}, {0, max_y}},
          {{max_x + 1, -1}, {max_x, 0}}
        ] do
      {x, y} = sent
      render_hook(creator, "create_at", %{"x" => x, "y" => y})

      rectangle =
        board.id
        |> Canvas.list_rectangles_for_board!()
        |> Enum.find(&({&1.x, &1.y} == stored))

      assert rectangle, "no rectangle stored at #{inspect(stored)} for #{inspect(sent)}"
      {stored_x, stored_y} = stored

      assert has_element?(
               watcher,
               "#rect-#{rectangle.id}[data-x='#{stored_x}'][data-y='#{stored_y}']"
             )
    end

    assert length(Canvas.list_rectangles_for_board!(board.id)) == 4
  end

  test "create_at with non-integer coordinates creates nothing", %{conn: conn, board: board} do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    for params <- [%{"x" => "10", "y" => 10}, %{"x" => 1.5, "y" => 2}, %{}] do
      render_hook(view, "create_at", params)
    end

    assert Canvas.list_rectangles_for_board!(board.id) == []
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
