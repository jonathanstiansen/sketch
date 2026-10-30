defmodule SketchWeb.BoardLiveExportTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Sketch.Canvas
  alias SketchWeb.{ExportActions, Shortcuts}

  setup do
    %{board: Canvas.create_board!()}
  end

  test "the export button and menu render from the action registry", %{conn: conn, board: board} do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    assert has_element?(view, "#export-button[aria-controls=export-menu][aria-expanded=false]")
    assert has_element?(view, "#export-root[phx-hook=ExportMenu][data-board-id='#{board.id}']")

    for action <- ExportActions.menu() do
      assert has_element?(view, "#export-menu button[data-export-action=#{action.id}]")
    end

    assert has_element?(view, "#export-menu input[data-export-option=selection][disabled]")
    assert has_element?(view, "#export-menu input[data-export-option=background][checked]")
  end

  test "the shortcuts help lists every export action that has a shortcut", %{
    conn: conn,
    board: board
  } do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")
    help = view |> element("#shortcuts-help") |> render()

    for %{chords: [_ | _]} = action <- ExportActions.all() do
      assert help =~ action.label
    end
  end

  test "the aggregate gives each export chord an aria-keyshortcuts value" do
    assert Shortcuts.aria_keyshortcuts("open_menu") == "Control+Shift+E Meta+Shift+E"
    assert Shortcuts.aria_keyshortcuts("copy_png") == "Shift+Alt+C"
    assert Shortcuts.aria_keyshortcuts("download_png") == nil
  end
end
