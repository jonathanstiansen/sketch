defmodule Sketch.Canvas.ViewerTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Sketch.Canvas.Viewer

  property "a viewer's name and colour are determined by its id" do
    check all id <- string(:alphanumeric, min_length: 1) do
      assert Viewer.from_id(id) == Viewer.from_id(id)
    end
  end

  property "the name is an adjective and an animal, the colour a stroke colour token" do
    check all id <- string(:alphanumeric, min_length: 1) do
      viewer = Viewer.from_id(id)
      assert viewer.id == id
      assert viewer.name =~ ~r/^[A-Z][a-z]+ [A-Z][a-z]+$/
      assert viewer.color in Sketch.Canvas.style_tokens(:stroke_color)
    end
  end

  test "new viewers get distinct random ids and use the whole palette" do
    viewers = Enum.map(1..300, fn _ -> Viewer.new() end)

    assert viewers |> Enum.map(& &1.id) |> Enum.uniq() |> length() == 300

    assert viewers |> Enum.map(& &1.color) |> Enum.uniq() |> Enum.sort() ==
             Enum.sort(Sketch.Canvas.style_tokens(:stroke_color))

    assert viewers |> Enum.map(& &1.name) |> Enum.uniq() |> length() > 100
  end

  test "there are enough names that two viewers rarely share one" do
    assert Viewer.name_count() >= 400
  end
end
