defmodule Sketch.Canvas.ElementTest do
  use Sketch.DataCase

  alias Sketch.Canvas
  alias Sketch.Canvas.{Board, Element, Geometry}

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
                 height: 5,
                 points: []
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
               Canvas.commit_shape(element.id, board.id, %{
                 x: 20,
                 y: 30,
                 width: 300,
                 height: 5,
                 points: []
               })

      assert_receive %Phoenix.Socket.Broadcast{
        event: "commit_shape",
        payload: %{x: 20, y: 30, width: 300, height: 5, version: 1, kind: :rectangle}
      }
    end

    test "rejects a box outside the canvas without a notification", %{board: board} do
      element = Canvas.create_element!(rectangle(%{x: 10, y: 10, board_id: board.id}))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      for box <- [%{x: 3000, y: 0, width: 1001, height: 5}, %{x: 0, y: 0, width: 5, height: 0}] do
        assert {:error, _} = Canvas.commit_shape(element.id, board.id, Map.put(box, :points, []))
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

  describe "line points (A08)" do
    defp line(attrs) do
      Map.merge(
        %{
          kind: :line,
          x: 10,
          y: 20,
          width: 100,
          height: 0,
          points: [%{x: 0, y: 0}, %{x: 100, y: 0}]
        },
        attrs
      )
    end

    test "a line has two points inside its box and may be 0 wide or tall", %{board: board} do
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      assert {:ok, %{width: 100, height: 0} = line} =
               Canvas.create_element(line(%{board_id: board.id}))

      assert [%Sketch.Canvas.Point{x: 0, y: 0}, %Sketch.Canvas.Point{x: 100, y: 0}] = line.points

      assert_receive %Phoenix.Socket.Broadcast{
        event: "create",
        payload: %{kind: :line, points: [%{x: 0, y: 0}, %{x: 100, y: 0}]}
      }

      vertical = line(%{width: 0, height: 50, points: [%{x: 0, y: 50}, %{x: 0, y: 0}]})
      assert {:ok, _} = Canvas.create_element(Map.put(vertical, :board_id, board.id))
    end

    test "an arrow is stored like a line, with its points in drawing order", %{board: board} do
      attrs = line(%{board_id: board.id, kind: :arrow, points: [%{x: 100, y: 0}, %{x: 0, y: 0}]})

      assert {:ok, %{kind: :arrow, points: [%{x: 100, y: 0}, %{x: 0, y: 0}]}} =
               Canvas.create_element(attrs)

      assert {:error, _} = Canvas.create_element(%{attrs | points: [%{x: 0, y: 0}]})
    end

    test "a freehand stroke has 2 to 500 points inside its box", %{board: board} do
      stroke = fn count, attrs ->
        points = for index <- 0..(count - 1), do: %{x: rem(index, 101), y: 0}
        line(%{board_id: board.id, kind: :freedraw, points: points}) |> Map.merge(attrs)
      end

      for count <- [2, 3, 500] do
        assert {:ok, %{kind: :freedraw, points: points}} =
                 Canvas.create_element(stroke.(count, %{}))

        assert length(points) == count
      end

      for attrs <- [stroke.(1, %{}), stroke.(501, %{}), stroke.(2, %{width: 0})] do
        assert {:error, _} = Canvas.create_element(attrs)
      end
    end

    test "Ash rejects a wrong number of points, points outside the box and boxes of size 0", %{
      board: board
    } do
      for attrs <- [
            line(%{points: []}),
            line(%{points: [%{x: 0, y: 0}]}),
            line(%{points: [%{x: 0, y: 0}, %{x: 1, y: 0}, %{x: 2, y: 0}]}),
            line(%{points: [%{x: 0, y: 0}, %{x: 101, y: 0}]}),
            line(%{points: [%{x: -1, y: 0}, %{x: 100, y: 0}]}),
            line(%{points: [%{x: 0, y: 1}, %{x: 100, y: 0}]}),
            line(%{points: [%{x: 0, y: 0}, %{x: 1.5, y: 0}]}),
            line(%{points: [%{x: 0}, %{x: 100, y: 0}]}),
            line(%{width: -1}),
            rectangle(%{x: 1, y: 1, points: [%{x: 0, y: 0}, %{x: 1, y: 1}]}),
            rectangle(%{x: 1, y: 1, width: 0}),
            rectangle(%{x: 1, y: 1, height: 0})
          ] do
        assert {:error, _} = Canvas.create_element(Map.put(attrs, :board_id, board.id)),
               inspect(attrs)
      end
    end

    test "commit_position moves the box and the relative points with it", %{board: board} do
      element = Canvas.create_element!(line(%{board_id: board.id}))

      assert {:ok, %{x: 3900, y: 4000, version: 1, points: [%{x: 0, y: 0}, %{x: 100, y: 0}]}} =
               Canvas.commit_position(element.id, board.id, %{x: 3900, y: 4000})

      assert {:error, _} = Canvas.commit_position(element.id, board.id, %{x: 3901, y: 0})
    end

    test "commit_shape sets the box and points together and broadcasts both", %{board: board} do
      element = Canvas.create_element!(line(%{board_id: board.id}))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))
      shape = %{x: 5, y: 6, width: 30, height: 40, points: [%{x: 30, y: 0}, %{x: 0, y: 40}]}

      assert {:ok, %{version: 1, width: 30}} = Canvas.commit_shape(element.id, board.id, shape)

      assert_receive %Phoenix.Socket.Broadcast{
        event: "commit_shape",
        payload: %{version: 1, points: [%{x: 30, y: 0}, %{x: 0, y: 40}]}
      }

      for invalid <- [
            Map.delete(shape, :points),
            %{shape | points: [%{x: 31, y: 0}, %{x: 0, y: 40}]},
            %{shape | points: [%{x: 0, y: 0}]}
          ] do
        assert {:error, _} = Canvas.commit_shape(element.id, board.id, invalid), inspect(invalid)
      end

      assert [%{version: 1, points: [%{x: 30, y: 0}, %{x: 0, y: 40}]}] =
               Canvas.list_elements_for_board!(board.id)
    end

    test "the database rejects malformed or misplaced points", %{board: board} do
      board_id = Ecto.UUID.dump!(board.id)

      for {kind, width, height, points, constraint} <- [
            {"line", 100, 0, [%{x: 0, y: 0}], "points_match_kind"},
            {"rectangle", 100, 10, [%{x: 0, y: 0}, %{x: 1, y: 1}], "points_match_kind"},
            {"line", 100, 0, [%{x: 0, y: 0}, %{x: 101, y: 0}], "points_within_box"},
            {"line", 100, 0, [%{x: 0, y: 0}, %{x: 50, y: 1}], "points_within_box"},
            {"line", 100, 0, [%{x: 0, y: 0}, %{x: 0.5, y: 0}], "points_within_box"},
            {"line", 100, 0, [%{x: 0, y: 0}, %{x: "1", y: 0}], "points_within_box"},
            {"line", 100, 0, [%{x: 0, y: 0}, %{x: 1}], "points_within_box"},
            {"rectangle", 0, 10, [], "width_at_least_min"},
            {"rectangle", 10, 0, [], "height_at_least_min"}
          ] do
        assert {:error,
                %Postgrex.Error{postgres: %{code: :check_violation, constraint: ^constraint}}} =
                 Sketch.Repo.query(
                   """
                   INSERT INTO elements (kind, x, y, width, height, points, board_id)
                   VALUES ($1, 0, 0, $2, $3, $4, $5)
                   """,
                   [kind, width, height, points, board_id]
                 ),
               inspect({kind, points})
      end
    end
  end

  describe "text (A08)" do
    defp text(attrs) do
      Map.merge(%{kind: :text, x: 10, y: 20, width: 90, height: 50, text: "hello\nworld"}, attrs)
    end

    test "a text element stores its text, defaulting other kinds to empty", %{board: board} do
      assert {:ok, %{text: "hello\nworld", version: 0}} =
               Canvas.create_element(text(%{board_id: board.id}))

      assert {:ok, %{text: ""}} =
               Canvas.create_element(rectangle(%{x: 0, y: 0, board_id: board.id}))
    end

    test "text keeps its whitespace and markup verbatim", %{board: board} do
      verbatim = "  <b>x</b>\n\t&amp; "

      assert {:ok, %{text: ^verbatim}} =
               Canvas.create_element(text(%{text: verbatim, board_id: board.id}))
    end

    test "Ash rejects blank, overlong or misplaced text", %{board: board} do
      max = Geometry.max_text_length()

      for attrs <- [
            text(%{text: ""}),
            text(%{text: " \n\t\r"}),
            text(%{text: String.duplicate("a", max + 1)}),
            text(%{text: String.duplicate("e\u0301", div(max, 2) + 1)}),
            text(%{text: "a\u0000"}),
            rectangle(%{x: 0, y: 0, text: "x"})
          ] do
        assert {:error, _} = Canvas.create_element(Map.put(attrs, :board_id, board.id)),
               inspect(String.slice(attrs.text, 0..10))
      end

      assert {:ok, _} =
               Canvas.create_element(
                 text(%{text: String.duplicate("😀", max), board_id: board.id})
               )
    end

    test "commit_shape sets the box and text together and broadcasts both", %{board: board} do
      element = Canvas.create_element!(text(%{board_id: board.id}))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))
      edit = %{x: 30, y: 40, width: 120, height: 75, points: [], text: "a\nb\nc"}

      assert {:ok, %{text: "a\nb\nc", version: 1}} =
               Canvas.commit_shape(element.id, board.id, edit)

      assert_receive %Phoenix.Socket.Broadcast{
        event: "commit_shape",
        payload: %{text: "a\nb\nc", x: 30, height: 75, version: 1, kind: :text}
      }
    end

    test "commit_shape rejects blank text for a text element and any text for other kinds", %{
      board: board
    } do
      element = Canvas.create_element!(text(%{board_id: board.id}))
      shape = Canvas.create_element!(rectangle(%{x: 0, y: 0, board_id: board.id}))
      box = %{x: 30, y: 40, width: 120, height: 75, points: []}

      assert {:error, _} = Canvas.commit_shape(element.id, board.id, Map.put(box, :text, " "))
      assert {:error, _} = Canvas.commit_shape(shape.id, board.id, Map.put(box, :text, "x"))

      assert {:ok, %{text: "hello\nworld", version: 1}} =
               Canvas.commit_position(element.id, board.id, %{x: 0, y: 0})
    end

    test "the database rejects blank, overlong or misplaced text", %{board: board} do
      board_id = Ecto.UUID.dump!(board.id)
      max = Geometry.max_text_length()

      for {kind, text, constraint} <- [
            {"text", "", "text_matches_kind"},
            {"text", " \n\t\r", "text_matches_kind"},
            {"rectangle", "x", "text_matches_kind"},
            {"text", String.duplicate("a", max + 1), "text_length"}
          ] do
        assert {:error,
                %Postgrex.Error{postgres: %{code: :check_violation, constraint: ^constraint}}} =
                 Sketch.Repo.query(
                   """
                   INSERT INTO elements (kind, x, y, width, height, text, board_id)
                   VALUES ($1, 0, 0, 10, 10, $2, $3)
                   """,
                   [kind, text, board_id]
                 ),
               inspect({kind, String.slice(text, 0..10)})
      end
    end
  end

  describe "note text (A08)" do
    defp note(attrs) do
      Map.merge(%{kind: :note, x: 10, y: 20, width: 200, height: 160, text: "sticky"}, attrs)
    end

    test "a note may be empty, whitespace or up to the maximum length", %{board: board} do
      max = Geometry.max_text_length()

      for text <- ["", " \n ", "<b>x</b>", String.duplicate("a", max)] do
        assert {:ok, %{kind: :note, text: ^text}} =
                 Canvas.create_element(note(%{text: text, board_id: board.id}))
      end
    end

    test "a note needs a box of at least 1 by 1 and text within the maximum", %{board: board} do
      max = Geometry.max_text_length()

      for attrs <- [
            note(%{width: 0}),
            note(%{height: 0}),
            note(%{text: String.duplicate("a", max + 1)}),
            note(%{text: "a\u0000"})
          ] do
        assert {:error, _} = Canvas.create_element(Map.put(attrs, :board_id, board.id))
      end
    end

    test "commit_shape resizes a note and may clear its text", %{board: board} do
      element = Canvas.create_element!(note(%{board_id: board.id}))
      box = %{x: 10, y: 20, width: 90, height: 60, points: []}

      assert {:ok, %{width: 90, text: "sticky", version: 1}} =
               Canvas.commit_shape(element.id, board.id, box)

      assert {:ok, %{text: "", version: 2}} =
               Canvas.commit_shape(element.id, board.id, Map.put(box, :text, ""))
    end

    test "the database accepts empty notes and rejects overlong ones", %{board: board} do
      insert = fn text ->
        Sketch.Repo.query(
          "INSERT INTO elements (kind, x, y, width, height, text, board_id) VALUES ('note', 0, 0, 10, 10, $1, $2)",
          [text, Ecto.UUID.dump!(board.id)],
          mode: :savepoint
        )
      end

      assert {:ok, _} = insert.("")

      assert {:error, %Postgrex.Error{postgres: %{constraint: "text_length"}}} =
               insert.(String.duplicate("a", Geometry.max_text_length() + 1))
    end
  end

  describe "seed (A08, ADR 0005)" do
    test "create stores a chosen seed and its event carries it", %{board: board} do
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      for seed <- [0, 7, Geometry.max_seed()] do
        element = Canvas.create_element!(rectangle(%{x: 1, y: 1, board_id: board.id, seed: seed}))
        assert element.seed == seed
        assert Canvas.element_event(element).seed == seed
        assert_receive %Phoenix.Socket.Broadcast{event: "create", payload: %{seed: ^seed}}
      end
    end

    test "a create without a seed gets a random one in range", %{board: board} do
      seeds =
        for _create <- 1..20 do
          Canvas.create_element!(rectangle(%{x: 1, y: 1, board_id: board.id})).seed
        end

      assert Enum.all?(seeds, &(&1 in 0..Geometry.max_seed()))
      assert length(Enum.uniq(seeds)) > 1
    end

    test "Ash rejects a seed outside 0..max_seed", %{board: board} do
      for seed <- [-1, Geometry.max_seed() + 1, nil, "seven", 1.5] do
        assert {:error, _} =
                 Canvas.create_element(rectangle(%{x: 1, y: 1, board_id: board.id, seed: seed})),
               inspect(seed)
      end
    end

    test "cannot change after create", %{board: board} do
      element = Canvas.create_element!(rectangle(%{x: 1, y: 1, board_id: board.id, seed: 5}))
      shape = %{x: 1, y: 1, width: 5, height: 5, points: []}

      assert {:error, _} = Canvas.commit_shape(element.id, board.id, Map.put(shape, :seed, 6))
      assert {:error, _} = Canvas.commit_position(element.id, board.id, %{x: 2, y: 2, seed: 6})

      assert {:ok, %{seed: 5}} = Canvas.commit_shape(element.id, board.id, shape)
      assert {:ok, %{seed: 5}} = Canvas.commit_position(element.id, board.id, %{x: 3, y: 3})
    end

    test "the database defaults a missing seed and rejects one out of range", %{board: board} do
      insert = fn columns, values, params ->
        Sketch.Repo.query(
          "INSERT INTO elements (kind, x, y, width, height, board_id#{columns}) " <>
            "VALUES ('rectangle', 0, 0, 10, 10, $1#{values}) RETURNING seed",
          [Ecto.UUID.dump!(board.id) | params]
        )
      end

      assert {:ok, %{rows: [[seed]]}} = insert.("", "", [])
      assert seed in 0..Geometry.max_seed()

      for seed <- [0, Geometry.max_seed()] do
        assert {:ok, %{rows: [[^seed]]}} = insert.(", seed", ", $2", [seed])
      end

      for seed <- [-1, Geometry.max_seed() + 1] do
        assert {:error,
                %Postgrex.Error{postgres: %{code: :check_violation, constraint: "seed_in_range"}}} =
                 insert.(", seed", ", $2", [seed])
      end

      assert {:error, %Postgrex.Error{postgres: %{code: :not_null_violation}}} =
               insert.(", seed", ", $2", [nil])
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

  describe "erase (A07, A11)" do
    test "hard-deletes the element and broadcasts its id and board after commit", %{board: board} do
      element = Canvas.create_element!(rectangle(%{x: 10, y: 20, board_id: board.id}))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      assert :ok = Canvas.erase_element(element.id, board.id)

      assert_receive %Phoenix.Socket.Broadcast{event: "erase", payload: payload}
      assert payload == %{id: element.id, board_id: board.id}
      assert Canvas.list_elements_for_board!(board.id) == []
    end

    test "an erase from another board fails, keeps the element and broadcasts nothing", %{
      board: board
    } do
      other = Canvas.create_board!()
      element = Canvas.create_element!(rectangle(%{x: 10, y: 20, board_id: board.id}))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(other.id))

      assert {:error, _not_found} = Canvas.erase_element(element.id, other.id)

      refute_receive %Phoenix.Socket.Broadcast{}, 100
      assert [%{id: id}] = Canvas.list_elements_for_board!(board.id)
      assert id == element.id
    end

    test "an erase rolled back with its transaction keeps the element and broadcasts nothing", %{
      board: board
    } do
      element = Canvas.create_element!(rectangle(%{x: 10, y: 20, board_id: board.id}))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      Ash.transact(Element, fn ->
        :ok = Canvas.erase_element(element.id, board.id)
        Ash.DataLayer.rollback(Element, :abort)
      end)

      refute_receive %Phoenix.Socket.Broadcast{}, 100
      assert [%{id: id}] = Canvas.list_elements_for_board!(board.id)
      assert id == element.id
    end
  end
end
