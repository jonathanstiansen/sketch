defmodule Sketch.Canvas.RectangleTest do
  use Sketch.DataCase

  alias Sketch.Canvas
  alias Sketch.Canvas.{Board, Rectangle}

  setup do
    %{board: Canvas.create_board!()}
  end

  test "Board and Rectangle use AshPostgres (A04)" do
    for resource <- [Board, Rectangle] do
      assert Ash.Resource.Info.data_layer(resource) == AshPostgres.DataLayer
      assert AshPostgres.DataLayer.Info.repo(resource, :read) == Sketch.Repo
    end
  end

  describe "board membership (A05)" do
    test "rejects a missing board", %{board: _board} do
      assert {:error, _} = Canvas.create_rectangle(%{x: 1, y: 1})
    end

    test "rejects an unknown board id through the database foreign key" do
      assert {:error, error} =
               Canvas.create_rectangle(%{x: 1, y: 1, board_id: Ash.UUID.generate()})

      assert Exception.message(error) =~ "board_id"
    end
  end

  describe "coordinate bounds (A08)" do
    test "Ash rejects out-of-bounds values", %{board: board} do
      for {x, y} <- [{-1, 0}, {3881, 0}, {0, -1}, {0, 3921}] do
        assert {:error, _} = Canvas.create_rectangle(%{x: x, y: y, board_id: board.id})
      end

      assert {:ok, _} = Canvas.create_rectangle(%{x: 3880, y: 3920, board_id: board.id})
      assert {:ok, _} = Canvas.create_rectangle(%{x: 0, y: 0, board_id: board.id})
    end

    test "the database rejects out-of-bounds and negative-version rows", %{board: board} do
      board_id = Ecto.UUID.dump!(board.id)

      for {x, y, version, constraint} <- [
            {3881, 0, 0, "x_within_canvas"},
            {-1, 0, 0, "x_within_canvas"},
            {0, 3921, 0, "y_within_canvas"},
            {0, -1, 0, "y_within_canvas"},
            {0, 0, -1, "version_not_negative"}
          ] do
        assert {:error,
                %Postgrex.Error{postgres: %{code: :check_violation, constraint: ^constraint}}} =
                 Sketch.Repo.query(
                   "INSERT INTO rectangles (x, y, version, board_id) VALUES ($1, $2, $3, $4)",
                   [x, y, version, board_id]
                 )
      end
    end
  end

  describe "version" do
    test "defaults to 0", %{board: board} do
      assert Canvas.create_rectangle!(%{x: 1, y: 2, board_id: board.id}).version == 0
    end

    test "cannot be set through create", %{board: board} do
      assert {:error, _} = Canvas.create_rectangle(%{x: 1, y: 2, board_id: board.id, version: 5})
    end
  end

  test "list_for_board returns only that board's rectangles (A07)", %{board: board} do
    other = Canvas.create_board!()
    mine = Canvas.create_rectangle!(%{x: 1, y: 1, board_id: board.id})
    Canvas.create_rectangle!(%{x: 2, y: 2, board_id: other.id})

    assert [%{id: id}] = Canvas.list_rectangles_for_board!(board.id)
    assert id == mine.id
  end

  describe "notifications (A11)" do
    test "a successful create broadcasts after commit", %{board: board} do
      SketchWeb.Endpoint.subscribe("board:#{board.id}")
      rectangle = Canvas.create_rectangle!(%{x: 10, y: 20, board_id: board.id})

      assert_receive %Phoenix.Socket.Broadcast{
        event: "create",
        payload: %{id: id, board_id: board_id, x: 10, y: 20, version: 0}
      }

      assert id == rectangle.id
      assert board_id == board.id
    end

    test "a failed create broadcasts nothing", %{board: board} do
      SketchWeb.Endpoint.subscribe("board:#{board.id}")
      assert {:error, _} = Canvas.create_rectangle(%{x: -5, y: 0, board_id: board.id})
      refute_receive %Phoenix.Socket.Broadcast{}, 100
    end

    test "a create rolled back with its transaction broadcasts nothing", %{board: board} do
      SketchWeb.Endpoint.subscribe("board:#{board.id}")

      Ash.transact(Rectangle, fn ->
        Canvas.create_rectangle!(%{x: 1, y: 1, board_id: board.id})
        Ash.DataLayer.rollback(Rectangle, :abort)
      end)

      refute_receive %Phoenix.Socket.Broadcast{}, 100
    end
  end
end
