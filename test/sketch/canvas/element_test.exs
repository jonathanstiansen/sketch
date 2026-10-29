defmodule Sketch.Canvas.ElementTest do
  use Sketch.DataCase

  alias Sketch.Canvas
  alias Sketch.Canvas.{Board, Element}

  setup do
    %{board: Canvas.create_board!()}
  end

  test "Board and Element use AshPostgres (A04)" do
    for resource <- [Board, Element] do
      assert Ash.Resource.Info.data_layer(resource) == AshPostgres.DataLayer
      assert AshPostgres.DataLayer.Info.repo(resource, :read) == Sketch.Repo
    end
  end

  describe "board membership (A05)" do
    test "rejects a missing board", %{board: _board} do
      assert {:error, _} = Canvas.create_element(rectangle(%{x: 1, y: 1}))
    end

    test "rejects an unknown board id through the database foreign key" do
      assert {:error, error} =
               Canvas.create_element(rectangle(%{x: 1, y: 1, board_id: Ash.UUID.generate()}))

      assert Exception.message(error) =~ "board_id"
    end
  end

  describe "box bounds (A08)" do
    test "Ash rejects a box outside the canvas or smaller than 1 x 1", %{board: board} do
      for {x, y, width, height} <- [
            {-1, 0, 120, 80},
            {3881, 0, 120, 80},
            {0, -1, 120, 80},
            {0, 3921, 120, 80},
            {0, 0, 0, 80},
            {0, 0, 120, 0},
            {0, 0, 4001, 80},
            {3999, 0, 2, 1}
          ] do
        attrs = %{kind: :rectangle, x: x, y: y, width: width, height: height, board_id: board.id}
        assert {:error, _} = Canvas.create_element(attrs)
      end

      for {x, y, width, height} <- [{3880, 3920, 120, 80}, {0, 0, 4000, 4000}, {3999, 3999, 1, 1}] do
        attrs = %{kind: :rectangle, x: x, y: y, width: width, height: height, board_id: board.id}
        assert {:ok, _} = Canvas.create_element(attrs)
      end
    end

    test "the database rejects out-of-bounds boxes and negative versions", %{board: board} do
      board_id = Ecto.UUID.dump!(board.id)

      for {x, y, width, height, version, constraint} <- [
            {3881, 0, 120, 80, 0, "x_within_canvas"},
            {-1, 0, 120, 80, 0, "x_within_canvas"},
            {0, 3921, 120, 80, 0, "y_within_canvas"},
            {0, -1, 120, 80, 0, "y_within_canvas"},
            {0, 0, 0, 80, 0, "width_at_least_min"},
            {0, 0, 120, 0, 0, "height_at_least_min"},
            {0, 0, 120, 80, -1, "version_not_negative"}
          ] do
        assert {:error,
                %Postgrex.Error{postgres: %{code: :check_violation, constraint: ^constraint}}} =
                 Sketch.Repo.query(
                   """
                   INSERT INTO elements (kind, x, y, width, height, version, board_id)
                   VALUES ('rectangle', $1, $2, $3, $4, $5, $6)
                   """,
                   [x, y, width, height, version, board_id]
                 )
      end
    end
  end

  describe "kind" do
    test "must be a known kind", %{board: board} do
      for kind <- [nil, :circle, "circle"] do
        assert {:error, _} =
                 Canvas.create_element(rectangle(%{kind: kind, x: 1, y: 1, board_id: board.id}))
      end

      assert {:ok, %{kind: :rectangle}} =
               Canvas.create_element(
                 rectangle(%{kind: "rectangle", x: 1, y: 1, board_id: board.id})
               )
    end

    test "cannot change after create", %{board: board} do
      element = Canvas.create_element!(rectangle(%{x: 1, y: 1, board_id: board.id}))

      assert {:error, _} =
               Canvas.commit_shape(element.id, board.id, %{
                 kind: :rectangle,
                 x: 1,
                 y: 1,
                 width: 5,
                 height: 5
               })

      assert {:error, _} =
               Canvas.commit_position(element.id, board.id, %{kind: :rectangle, x: 2, y: 2})
    end
  end

  describe "commit_shape" do
    test "sets the box, increments the version and broadcasts it", %{board: board} do
      element = Canvas.create_element!(rectangle(%{x: 10, y: 10, board_id: board.id}))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      assert {:ok, %{x: 20, y: 30, width: 300, height: 5, version: 1}} =
               Canvas.commit_shape(element.id, board.id, %{x: 20, y: 30, width: 300, height: 5})

      assert_receive %Phoenix.Socket.Broadcast{
        event: "commit_shape",
        payload: %{x: 20, y: 30, width: 300, height: 5, version: 1, kind: :rectangle}
      }
    end

    test "rejects a box outside the canvas without a notification", %{board: board} do
      element = Canvas.create_element!(rectangle(%{x: 10, y: 10, board_id: board.id}))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      for box <- [%{x: 3000, y: 0, width: 1001, height: 5}, %{x: 0, y: 0, width: 5, height: 0}] do
        assert {:error, _} = Canvas.commit_shape(element.id, board.id, box)
      end

      refute_receive %Phoenix.Socket.Broadcast{}, 100
      assert [%{width: 120, height: 80, version: 0}] = Canvas.list_elements_for_board!(board.id)
    end

    test "commit_position keeps the stored size inside the canvas", %{board: board} do
      element =
        Canvas.create_element!(%{
          kind: :rectangle,
          x: 0,
          y: 0,
          width: 1000,
          height: 10,
          board_id: board.id
        })

      assert {:error, _} = Canvas.commit_position(element.id, board.id, %{x: 3001, y: 0})

      assert {:ok, %{x: 3000, version: 1}} =
               Canvas.commit_position(element.id, board.id, %{x: 3000, y: 0})
    end
  end

  describe "version" do
    test "defaults to 0", %{board: board} do
      assert Canvas.create_element!(rectangle(%{x: 1, y: 2, board_id: board.id})).version == 0
    end

    test "cannot be set through create", %{board: board} do
      assert {:error, _} =
               Canvas.create_element(rectangle(%{x: 1, y: 2, board_id: board.id, version: 5}))
    end
  end

  test "list_for_board returns only that board's elements (A07)", %{board: board} do
    other = Canvas.create_board!()
    mine = Canvas.create_element!(rectangle(%{x: 1, y: 1, board_id: board.id}))
    Canvas.create_element!(rectangle(%{x: 2, y: 2, board_id: other.id}))

    assert [%{id: id}] = Canvas.list_elements_for_board!(board.id)
    assert id == mine.id
  end

  describe "notifications (A11)" do
    test "board_topic matches the Element pub_sub topic", %{board: board} do
      topic = Canvas.board_topic(board.id)

      assert topic ==
               Enum.join(
                 [Ash.Notifier.PubSub.Info.prefix(Element), board.id],
                 Ash.Notifier.PubSub.Info.delimiter(Element)
               )

      SketchWeb.Endpoint.subscribe(topic)
      Canvas.create_element!(rectangle(%{x: 10, y: 20, board_id: board.id}))
      assert_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "create"}
    end

    test "a successful create broadcasts after commit", %{board: board} do
      SketchWeb.Endpoint.subscribe("board:#{board.id}")
      rectangle = Canvas.create_element!(rectangle(%{x: 10, y: 20, board_id: board.id}))

      assert_receive %Phoenix.Socket.Broadcast{
        event: "create",
        payload: %{id: id, board_id: board_id, x: 10, y: 20, version: 0}
      }

      assert id == rectangle.id
      assert board_id == board.id
    end

    test "a failed create broadcasts nothing", %{board: board} do
      SketchWeb.Endpoint.subscribe("board:#{board.id}")
      assert {:error, _} = Canvas.create_element(rectangle(%{x: -5, y: 0, board_id: board.id}))
      refute_receive %Phoenix.Socket.Broadcast{}, 100
    end

    test "a create rolled back with its transaction broadcasts nothing", %{board: board} do
      SketchWeb.Endpoint.subscribe("board:#{board.id}")

      Ash.transact(Element, fn ->
        Canvas.create_element!(rectangle(%{x: 1, y: 1, board_id: board.id}))
        Ash.DataLayer.rollback(Element, :abort)
      end)

      refute_receive %Phoenix.Socket.Broadcast{}, 100
    end
  end
end
