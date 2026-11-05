defmodule Sketch.Canvas.ElementStyleTest do
  use Sketch.DataCase

  import Sketch.CanvasFixtures, only: [element_attrs: 2]

  alias Phoenix.Socket.Broadcast
  alias Sketch.Canvas
  alias Sketch.Canvas.{Element, Kinds}

  @properties Canvas.style_properties()

  setup do
    %{board: Canvas.create_board!()}
  end

  defp create!(board, kind, attrs \\ %{}),
    do: Canvas.create_element!(element_attrs(kind, Map.put(attrs, :board_id, board.id)))

  defp applicable(kind), do: Kinds.fetch!(kind).style

  defp inapplicable(kind), do: @properties -- applicable(kind)

  defp non_default(property), do: List.last(Canvas.style_tokens(property))

  defp style(element), do: Map.take(element, @properties)

  defp field_errors(changeset),
    do: for(%{field: field} <- changeset.errors, do: field)

  describe "style attributes (A08, ADR 0006)" do
    test "every kind defaults to the look it had before styling", %{board: board} do
      for kind <- Canvas.element_kinds() do
        element = create!(board, kind)
        assert style(element) == Canvas.style_defaults()
        assert Map.take(Canvas.element_event(element), @properties) == Canvas.style_defaults()
      end
    end

    test "create stores every applicable token and its event carries it", %{board: board} do
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      for kind <- Canvas.element_kinds(),
          property <- applicable(kind),
          token <- Canvas.style_tokens(property) do
        element = create!(board, kind, %{property => token})
        assert Map.fetch!(element, property) == token
        assert_receive %Broadcast{event: "create", payload: %{^property => ^token}}
      end
    end

    test "Ash accepts tokens as strings and rejects unknown tokens", %{board: board} do
      assert %{stroke_color: :red} = create!(board, :rectangle, %{stroke_color: "red"})

      for property <- @properties, value <- [:purple, "purple", nil, 1] do
        assert {:error, _} =
                 Canvas.create_element(
                   element_attrs(:rectangle, %{:board_id => board.id, property => value})
                 ),
               inspect({property, value})
      end
    end

    test "Ash rejects a non-default value for a property that does not apply to the kind, before the database",
         %{board: board} do
      assert :fill_color in inapplicable(:line)

      for kind <- Canvas.element_kinds(),
          property <- inapplicable(kind),
          token <- Canvas.style_tokens(property) -- [Canvas.style_defaults()[property]] do
        attrs = element_attrs(kind, %{:board_id => board.id, property => token})
        changeset = Ash.Changeset.for_create(Element, :create, attrs)

        refute changeset.valid?, inspect({kind, property, token})
        assert property in field_errors(changeset)
        assert {:error, _} = Canvas.create_element(attrs)
      end

      for kind <- Canvas.element_kinds(), property <- inapplicable(kind) do
        default = Canvas.style_defaults()[property]
        assert %{^property => ^default} = create!(board, kind, %{property => default})
      end
    end

    test "commit_style rejects a property that does not apply to the stored kind", %{board: board} do
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      for kind <- Canvas.element_kinds(), property <- inapplicable(kind) do
        element = create!(board, kind)
        _created = assert_receive %Broadcast{event: "create"}

        assert {:error, error} =
                 Canvas.commit_style(element.id, board.id, %{property => non_default(property)})

        assert Exception.message(error) =~ "does not apply to the element's kind"
      end

      refute_receive %Broadcast{}, 50
      assert Enum.all?(Canvas.list_elements_for_board!(board.id), &(&1.version == 0))
    end

    test "the database rejects unknown tokens and inapplicable values", %{board: board} do
      insert = fn kind, column, value ->
        points =
          if kind == "line", do: ~s|ARRAY['{"x":0,"y":0}','{"x":1,"y":1}']::jsonb[]|, else: "'{}'"

        Sketch.Repo.query(
          "INSERT INTO elements (kind, x, y, width, height, points, board_id, #{column}) " <>
            "VALUES ($1, 0, 0, 1, 1, #{points}, $2, $3)",
          [kind, Ecto.UUID.dump!(board.id), value]
        )
      end

      for {kind, column, value, constraint} <- [
            {"rectangle", "stroke_color", "purple", "stroke_color_known"},
            {"rectangle", "fill_color", "#ff0000", "fill_color_known"},
            {"rectangle", "stroke_width", "huge", "stroke_width_known"},
            {"rectangle", "stroke_style", "wavy", "stroke_style_known"},
            {"line", "fill_color", "red", "fill_color_fits_kind"},
            {"note", "stroke_width", "bold", "stroke_width_fits_kind"},
            {"note", "stroke_style", "dashed", "stroke_style_fits_kind"}
          ] do
        assert {:error,
                %Postgrex.Error{postgres: %{code: :check_violation, constraint: ^constraint}}} =
                 insert.(kind, column, value),
               inspect({kind, column, value})
      end

      assert {:ok, _} = insert.("line", "fill_color", "auto")
      assert {:ok, _} = insert.("line", "stroke_style", "dotted")
      assert {:ok, _} = insert.("note", "fill_color", "blue")
      assert {:ok, _} = insert.("rectangle", "fill_color", "none")
    end

    test "the database defaults a missing style to today's look", %{board: board} do
      assert {:ok, %{rows: [row]}} =
               Sketch.Repo.query(
                 "INSERT INTO elements (kind, x, y, width, height, board_id) " <>
                   "VALUES ('note', 0, 0, 10, 10, $1) " <>
                   "RETURNING #{Enum.join(@properties, ", ")}",
                 [Ecto.UUID.dump!(board.id)]
               )

      assert row == Enum.map(@properties, &Atom.to_string(Canvas.style_defaults()[&1]))
    end
  end

  describe "commit_style (A09, ADR 0006)" do
    test "sets only the style, increments the version and broadcasts the whole element", %{
      board: board
    } do
      element = create!(board, :rectangle, %{x: 10, y: 20})
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))

      assert {:ok, styled} =
               Canvas.commit_style(element.id, board.id, %{
                 stroke_color: :red,
                 stroke_style: :dashed,
                 fill_color: :blue
               })

      assert %{stroke_color: :red, stroke_style: :dashed, fill_color: :blue} = styled
      assert %{stroke_width: :thin, x: 10, y: 20, width: 120, height: 80, version: 1} = styled
      assert styled.seed == element.seed

      payload = Canvas.element_event(styled)
      assert_receive %Broadcast{event: "commit_style", payload: ^payload}
    end

    test "on another board fails and broadcasts nothing", %{board: board} do
      element = create!(board, :rectangle)
      other = Canvas.create_board!()
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(board.id))
      SketchWeb.Endpoint.subscribe(Canvas.board_topic(other.id))

      assert {:error, _} = Canvas.commit_style(element.id, other.id, %{stroke_color: :red})
      refute_receive %Broadcast{}, 50
      assert [%{stroke_color: :ink, version: 0}] = Canvas.list_elements_for_board!(board.id)
    end

    test "accepts only style, and the other commits cannot change the style", %{board: board} do
      element = create!(board, :rectangle)
      box = %{x: 1, y: 1, width: 5, height: 5, points: []}

      assert {:error, _} = Canvas.commit_style(element.id, board.id, %{x: 5})
      assert {:error, _} = Canvas.commit_style(element.id, board.id, %{seed: 5})

      assert {:error, _} =
               Canvas.commit_shape(element.id, board.id, Map.put(box, :fill_color, :red))

      assert {:error, _} =
               Canvas.commit_position(element.id, board.id, %{x: 2, y: 2, stroke_color: :red})

      assert [%{fill_color: :auto, stroke_color: :ink, version: 0}] =
               Canvas.list_elements_for_board!(board.id)
    end

    test "a later shape commit keeps the style and a later style commit keeps the shape", %{
      board: board
    } do
      element = create!(board, :ellipse)

      assert {:ok, %{version: 1}} =
               Canvas.commit_style(element.id, board.id, %{fill_color: :green})

      assert {:ok, %{version: 2, fill_color: :green, width: 300}} =
               Canvas.commit_shape(element.id, board.id, %{
                 x: 0,
                 y: 0,
                 width: 300,
                 height: 40,
                 points: []
               })

      assert {:ok, %{version: 3, fill_color: :green, stroke_width: :bold, width: 300}} =
               Canvas.commit_style(element.id, board.id, %{stroke_width: :bold})
    end
  end
end
