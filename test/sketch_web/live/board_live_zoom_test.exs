defmodule SketchWeb.BoardLiveZoomTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Sketch.Canvas
  alias SketchWeb.{Shortcuts, ZoomActions}

  setup %{conn: conn} do
    board = Canvas.create_board!()
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
    %{view: view}
  end

  test "the canvas svg keeps its viewBox in canvas units and starts at 100%", %{view: view} do
    geometry = Canvas.geometry()
    size = "#{geometry.canvas_width} #{geometry.canvas_height}"

    assert has_element?(view, "#canvas[viewBox='0 0 #{size}']")
    assert has_element?(view, "#canvas[width='#{geometry.canvas_width}']")
    assert has_element?(view, "#zoom-level", "100%")
  end

  test "the zoom control and the shortcuts help render from the zoom registry", %{view: view} do
    help = view |> element("#shortcuts-help") |> render()

    for action <- ZoomActions.all() do
      assert help =~ action.label

      for chord <- action.chords, key <- chord.keys do
        assert help =~ key
      end
    end

    for id <- ["zoom_out", "zoom_in", "zoom_reset"] do
      assert has_element?(view, "#zoom-controls button[data-zoom-action=#{id}]")
    end
  end

  test "the aggregate gives each zoom action its aria-keyshortcuts and title" do
    assert Shortcuts.aria_keyshortcuts("zoom_in") == "Control+= Meta+="
    assert Shortcuts.aria_keyshortcuts("zoom_reset") == "Control+0 Meta+0"
    assert Shortcuts.aria_keyshortcuts("zoom_fit") == "Shift+1"
    assert Shortcuts.title("zoom_out") == "Zoom out (Ctrl/⌘+-)"
  end
end
