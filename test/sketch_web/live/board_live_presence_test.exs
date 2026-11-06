defmodule SketchWeb.BoardLivePresenceTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Sketch.Canvas

  setup %{conn: conn} do
    board = Canvas.create_board!()
    {:ok, alice, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, bob, _html} = live(conn, ~p"/b/#{board.id}")
    %{board: board, conn: conn, alice: alice, bob: bob}
  end

  defp cursor(x, y, seq), do: %{"x" => x, "y" => y, "seq" => seq}

  defp own_id(view) do
    view |> element("#viewer-name") |> render()
    :sys.get_state(view.pid).socket.assigns.viewer.id
  end

  defp avatar(viewer_id), do: "#viewer-roster button[data-viewer='#{viewer_id}']"

  defp assert_eventually(check, attempts \\ 200)
  defp assert_eventually(check, 0), do: assert(check.())

  defp assert_eventually(check, attempts) do
    unless check.() do
      :erlang.yield()
      assert_eventually(check, attempts - 1)
    end
  end

  test "each view lists the others on the board but not itself", %{alice: alice, bob: bob} do
    alice_id = own_id(alice)
    bob_id = own_id(bob)

    assert_eventually(fn -> has_element?(alice, avatar(bob_id)) end)
    assert has_element?(bob, avatar(alice_id))
    refute has_element?(alice, avatar(alice_id))
    refute has_element?(bob, avatar(bob_id))
  end

  test "a viewer's avatar can be jumped to only while its pointer is on the canvas", ctx do
    %{alice: alice, bob: bob} = ctx
    alice_id = own_id(alice)

    assert has_element?(bob, avatar(alice_id) <> "[disabled][data-on-canvas='false']")

    render_hook(alice, "cursor", cursor(500, 600, 1))
    assert_eventually(fn -> has_element?(bob, avatar(alice_id) <> "[data-on-canvas='true']") end)
    refute has_element?(bob, avatar(alice_id) <> "[disabled]")

    render_hook(alice, "cursor_leave", %{"seq" => 2})
    assert_eventually(fn -> has_element?(bob, avatar(alice_id) <> "[disabled]") end)
  end

  test "a viewer that closes the board leaves every list and its cursor is dropped", ctx do
    %{alice: alice, bob: bob} = ctx
    alice_id = own_id(alice)
    render_hook(alice, "cursor", cursor(10, 10, 1))
    assert_push_event(bob, "cursors", %{cursors: [%{viewer_id: ^alice_id}]})

    Process.flag(:trap_exit, true)
    ref = Process.monitor(alice.pid)
    GenServer.stop(alice.pid, :shutdown)
    assert_receive {:DOWN, ^ref, :process, _pid, _reason}

    assert_push_event(bob, "viewer_left", %{viewer_id: ^alice_id})
    refute has_element?(bob, avatar(alice_id))
  end

  test "a viewer who arrives sees a cursor that is already resting on the canvas", ctx do
    %{board: board, conn: conn, alice: alice} = ctx
    alice_id = own_id(alice)
    render_hook(alice, "cursor", cursor(700, 800, 4))

    {:ok, carol, _html} = live(conn, ~p"/b/#{board.id}")

    assert_push_event(carol, "cursors", %{
      cursors: [%{viewer_id: ^alice_id, x: 700, y: 800, seq: 4}]
    })

    assert has_element?(carol, avatar(alice_id) <> "[data-on-canvas='true']")
  end

  test "a view alone on its board says so", %{conn: conn} do
    board = Canvas.create_board!()
    {:ok, solo, _html} = live(conn, ~p"/b/#{board.id}")

    assert has_element?(solo, "#viewer-roster-empty")
    refute has_element?(solo, "#viewer-roster button")
  end

  test "views on another board are not listed", ctx do
    %{conn: conn, alice: alice} = ctx
    other = Canvas.create_board!()
    {:ok, stranger, _html} = live(conn, ~p"/b/#{other.id}")
    stranger_id = own_id(stranger)

    refute has_element?(alice, avatar(stranger_id))
    refute has_element?(stranger, "#viewer-roster button")
  end
end
