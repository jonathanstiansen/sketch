defmodule SketchWeb.BoardLiveEraseTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Phoenix.Socket.Broadcast
  alias Sketch.Canvas

  @drag_id "11111111-2222-4333-8444-555555555555"

  setup %{conn: conn} do
    board = Canvas.create_board!()

    elements =
      for index <- 0..2 do
        index
        |> Canvas.default_box()
        |> Map.put(:board_id, board.id)
        |> rectangle()
        |> Canvas.create_element!()
      end

    {:ok, eraser, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
    %{board: board, elements: elements, eraser: eraser, watcher: watcher}
  end

  defp shown?(view, element), do: has_element?(view, "#element-#{element.id}")

  defp stored_ids(board), do: board.id |> Canvas.list_elements_for_board!() |> Enum.map(& &1.id)

  test "the eraser erases every element it passed over, in every view and the database", ctx do
    [first, second, third] = ctx.elements

    render_hook(ctx.eraser, "erase", %{"element_ids" => [first.id, second.id]})

    for view <- [ctx.eraser, ctx.watcher] do
      refute shown?(view, first)
      refute shown?(view, second)
      assert shown?(view, third)
      assert_push_event(view, "erased", %{id: id})
      assert id == first.id
      assert_push_event(view, "erased", %{id: id})
      assert id == second.id
    end

    assert stored_ids(ctx.board) == [third.id]
  end

  test "Delete erases the one selected element and a second view sees it go", ctx do
    [first, second, third] = ctx.elements

    render_hook(ctx.eraser, "erase", %{"element_ids" => [second.id]})

    refute shown?(ctx.watcher, second)
    assert shown?(ctx.watcher, first) and shown?(ctx.watcher, third)
    assert stored_ids(ctx.board) == [first.id, third.id]
  end

  test "erasing the same element twice or from two views erases it once", ctx do
    [first | _rest] = ctx.elements
    :ok = SketchWeb.Endpoint.subscribe(Canvas.board_topic(ctx.board.id))

    render_hook(ctx.eraser, "erase", %{"element_ids" => [first.id, first.id]})
    render_hook(ctx.watcher, "erase", %{"element_ids" => [first.id]})

    assert_receive %Broadcast{event: "erase", payload: %{id: id}}
    assert id == first.id
    refute_receive %Broadcast{event: "erase"}, 100
    refute render(ctx.watcher) =~ "Could not"
  end

  test "an element of another board cannot be erased and nobody is told about it", ctx do
    other = Canvas.create_board!()

    foreign =
      Canvas.default_box(0)
      |> Map.put(:board_id, other.id)
      |> rectangle()
      |> Canvas.create_element!()

    {:ok, other_view, _html} = live(ctx.conn, ~p"/b/#{other.id}")
    :ok = SketchWeb.Endpoint.subscribe(Canvas.board_topic(other.id))

    render_hook(ctx.eraser, "erase", %{"element_ids" => [foreign.id]})

    refute_receive %Broadcast{}, 100
    refute_push_event(ctx.eraser, "erased", %{})
    assert shown?(other_view, foreign)
    assert stored_ids(other) == [foreign.id]
  end

  test "malformed erase params change nothing", ctx do
    [first | _rest] = ctx.elements

    for params <- [%{}, %{"element_ids" => first.id}, %{"element_ids" => [first.id, 1]}] do
      render_hook(ctx.eraser, "erase", params)
    end

    assert shown?(ctx.watcher, first)
    assert length(stored_ids(ctx.board)) == 3
  end

  test "a commit for an erased element is dropped without a flash, a revert or a broadcast",
       ctx do
    [first | _rest] = ctx.elements
    render_hook(ctx.watcher, "erase", %{"element_ids" => [first.id]})
    render(ctx.eraser)
    :ok = SketchWeb.Endpoint.subscribe(Canvas.board_topic(ctx.board.id))

    ref = %{"element_id" => first.id, "drag_id" => @drag_id}
    render_hook(ctx.eraser, "commit", Map.merge(ref, %{"x" => 500, "y" => 500}))

    render_hook(
      ctx.eraser,
      "commit_shape",
      Map.merge(ref, %{"x" => 1, "y" => 1, "width" => 50, "height" => 50})
    )

    refute_receive %Broadcast{}, 100
    refute_push_event(ctx.eraser, "revert", %{})
    refute render(ctx.eraser) =~ "Could not"
    refute shown?(ctx.eraser, first)
    refute first.id in stored_ids(ctx.board)
  end

  test "a create or commit delivered after the erase never brings the element back", ctx do
    [first | _rest] = ctx.elements
    render_hook(ctx.eraser, "erase", %{"element_ids" => [first.id]})
    topic = Canvas.board_topic(ctx.board.id)
    late = Canvas.element_event(%{first | x: 900, version: 7})

    for event <- ~w(create commit_position commit_shape) do
      send(ctx.watcher.pid, %Broadcast{topic: topic, event: event, payload: late})
    end

    refute shown?(ctx.watcher, first)
  end
end
