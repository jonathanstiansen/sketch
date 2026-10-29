defmodule Sketch.Canvas.SessionsTest do
  use Sketch.DataCase

  alias Sketch.Canvas

  setup do
    board_a = Canvas.create_board!()
    board_b = Canvas.create_board!()

    %{
      board_a: board_a,
      board_b: board_b,
      rectangle_a: Canvas.create_element!(rectangle(%{x: 10, y: 10, board_id: board_a.id})),
      rectangle_b: Canvas.create_element!(rectangle(%{x: 20, y: 20, board_id: board_b.id}))
    }
  end

  describe "commit_position versions" do
    test "increments the version and broadcasts it", %{board_a: board, rectangle_a: rectangle} do
      SketchWeb.Endpoint.subscribe("board:#{board.id}")

      first = Canvas.commit_position!(rectangle.id, board.id, %{x: 30, y: 40})
      assert {first.x, first.y, first.version} == {30, 40, 1}
      assert_receive %Phoenix.Socket.Broadcast{event: "commit_position", payload: %{version: 1}}

      second = Canvas.commit_position!(rectangle.id, board.id, %{x: 50, y: 60})
      assert second.version == 2
      assert_receive %Phoenix.Socket.Broadcast{event: "commit_position", payload: %{version: 2}}
    end

    test "out-of-bounds commits are rejected and leave the version unchanged", %{
      board_a: board,
      rectangle_a: rectangle
    } do
      for {x, y} <- [{-1, 0}, {3881, 0}, {0, -1}, {0, 3921}] do
        assert {:error, _} = Canvas.commit_position(rectangle.id, board.id, %{x: x, y: y})
      end

      assert [%{version: 0, x: 10, y: 10}] = Canvas.list_elements_for_board!(board.id)
    end
  end

  describe "board membership is immutable (A06)" do
    test "commit_position rejects board_id input", %{
      board_a: board_a,
      board_b: board_b,
      rectangle_a: rectangle
    } do
      assert {:error, _} =
               Canvas.commit_position(rectangle.id, board_a.id, %{
                 x: 1,
                 y: 1,
                 board_id: board_b.id
               })

      assert [%{id: id, version: 0}] = Canvas.list_elements_for_board!(board_a.id)
      assert id == rectangle.id
      assert Canvas.list_elements_for_board!(board_b.id) |> Enum.all?(&(&1.id != rectangle.id))
    end
  end

  describe "board scoping (A07)" do
    test "a subscriber receives nothing about another board", %{
      board_a: board_a,
      board_b: board_b,
      rectangle_b: rectangle_b
    } do
      SketchWeb.Endpoint.subscribe("board:#{board_a.id}")

      Canvas.create_element!(rectangle(%{x: 1, y: 1, board_id: board_b.id}))
      Canvas.commit_position!(rectangle_b.id, board_b.id, %{x: 2, y: 2})

      refute_receive %Phoenix.Socket.Broadcast{}
    end

    test "list_elements_for_board never returns other boards' rectangles", %{
      board_a: board_a,
      rectangle_a: rectangle_a,
      rectangle_b: rectangle_b
    } do
      assert [%{id: id}] = Canvas.list_elements_for_board!(board_a.id)
      assert id == rectangle_a.id
      refute id == rectangle_b.id
    end

    test "committing another board's rectangle fails and broadcasts nothing", %{
      board_a: board_a,
      board_b: board_b,
      rectangle_b: rectangle_b
    } do
      SketchWeb.Endpoint.subscribe("board:#{board_a.id}")
      SketchWeb.Endpoint.subscribe("board:#{board_b.id}")

      assert {:error, _} = Canvas.commit_position(rectangle_b.id, board_a.id, %{x: 99, y: 99})

      refute_receive %Phoenix.Socket.Broadcast{}
      assert [%{x: 20, y: 20, version: 0}] = Canvas.list_elements_for_board!(board_b.id)
    end
  end
end
