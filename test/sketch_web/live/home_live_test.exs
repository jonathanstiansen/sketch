defmodule SketchWeb.HomeLiveTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  test "new board creates a board and navigates to its page", %{conn: conn} do
    boards_before = Ash.count!(Sketch.Canvas.Board)
    {:ok, view, _html} = live(conn, ~p"/")

    {:ok, _board_view, html} =
      view |> element("#new-board") |> render_click() |> follow_redirect(conn)

    assert Ash.count!(Sketch.Canvas.Board) == boards_before + 1
    assert html =~ "board-url"
  end
end
