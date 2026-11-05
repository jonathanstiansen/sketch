defmodule Sketch.Properties.StyleRegistryTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  import Sketch.CanvasFixtures, only: [element_attrs: 2, element_kind: 0]

  alias Sketch.Canvas
  alias Sketch.Canvas.Kinds

  @properties Canvas.style_properties()

  defp applicable(kind), do: Kinds.fetch!(kind).style

  defp registry_style(kind) do
    kind
    |> applicable()
    |> Map.new(&{&1, member_of(Canvas.style_tokens(&1))})
    |> fixed_map()
    |> map(&Map.merge(Canvas.style_defaults(), &1))
  end

  defp kind_and_style, do: bind(element_kind(), &tuple({constant(&1), registry_style(&1)}))

  defp unknown_token(property) do
    known = Enum.map(Canvas.style_tokens(property), &Atom.to_string/1)
    filter(string(:alphanumeric, min_length: 1), &(&1 not in known))
  end

  defp style(element), do: Map.take(element, @properties)

  setup do
    %{board: Canvas.create_board!()}
  end

  property "any registry style a kind takes is stored and read back as given (A24)", %{
    board: board
  } do
    check all({kind, style} <- kind_and_style(), max_runs: 60) do
      element =
        Canvas.create_element!(element_attrs(kind, Map.merge(style, %{board_id: board.id})))

      stored = board.id |> Canvas.list_elements_for_board!() |> Enum.find(&(&1.id == element.id))

      assert style(element) == style
      assert style(stored) == style
    end
  end

  property "commit_style stores any registry token of a property the kind takes (A24)", %{
    board: board
  } do
    check all(
            kind <- element_kind(),
            property <- member_of(applicable(kind)),
            token <- member_of(Canvas.style_tokens(property)),
            max_runs: 60
          ) do
      element = Canvas.create_element!(element_attrs(kind, %{board_id: board.id}))

      assert {:ok, committed} =
               Canvas.commit_style(element.id, board.id, %{property => token})

      assert Map.fetch!(committed, property) == token
      assert committed.version == element.version + 1
    end
  end

  property "a value outside the registry is refused at the client boundary and by the action (A24)",
           %{board: board} do
    check all(
            kind <- element_kind(),
            property <- member_of(applicable(kind)),
            value <- unknown_token(property),
            max_runs: 60
          ) do
      assert Canvas.style_token(property, value) == :error

      assert {:error, _invalid} =
               Canvas.create_element(
                 element_attrs(kind, %{:board_id => board.id, property => value})
               )
    end
  end

  property "every registry token is the token its name casts to (A24)" do
    check all(
            property <- member_of(@properties),
            token <- member_of(Canvas.style_tokens(property))
          ) do
      assert Canvas.style_token(property, Atom.to_string(token)) == {:ok, token}
      assert Canvas.style_token(property, token) == :error
    end
  end
end
