defmodule Sketch.Canvas.CommitFailureTest do
  use Sketch.DataCase

  alias Sketch.Canvas
  alias Sketch.Canvas.Element

  setup do
    board = Canvas.create_board!()
    :ok = SketchWeb.Endpoint.subscribe("board:#{board.id}")
    rectangle = Canvas.create_element!(rectangle(%{x: 100, y: 100, board_id: board.id}))
    assert_receive %Phoenix.Socket.Broadcast{event: "create"}
    %{board: board, rectangle: rectangle}
  end

  defp stored_version(board, rectangle) do
    board.id
    |> Canvas.list_elements_for_board!()
    |> Enum.find(&(&1.id == rectangle.id))
    |> Map.take([:x, :y, :version])
  end

  test "an out-of-bounds commit fails without a notification", ctx do
    %{board: board, rectangle: rectangle} = ctx

    assert {:error, _error} = Canvas.commit_position(rectangle.id, board.id, %{x: 9999, y: 0})

    refute_receive %Phoenix.Socket.Broadcast{}, 100
    assert %{x: 100, y: 100, version: 0} = stored_version(board, rectangle)
  end

  test "a commit rolled back with its transaction sends no notification", ctx do
    %{board: board, rectangle: rectangle} = ctx

    Ash.transact(Element, fn ->
      Canvas.commit_position!(rectangle.id, board.id, %{x: 500, y: 500})
      Ash.DataLayer.rollback(Element, :abort)
    end)

    refute_receive %Phoenix.Socket.Broadcast{}, 100
    assert %{x: 100, y: 100, version: 0} = stored_version(board, rectangle)
  end

  test "a commit for a rectangle on another board fails without a notification", ctx do
    %{board: board, rectangle: rectangle} = ctx
    other_board = Canvas.create_board!()

    assert {:error, _error} = Canvas.commit_position(rectangle.id, other_board.id, %{x: 5, y: 5})

    refute_receive %Phoenix.Socket.Broadcast{}, 100
    assert %{x: 100, y: 100, version: 0} = stored_version(board, rectangle)
  end
end
