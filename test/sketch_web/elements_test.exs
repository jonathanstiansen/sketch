defmodule SketchWeb.ElementsTest do
  use ExUnit.Case, async: true

  import Phoenix.LiveViewTest

  alias SketchWeb.{Elements, RenderFixtures, WrapFixtures}

  test "the committed render parity fixture is the generated one (ADR 0004)" do
    assert File.read!(RenderFixtures.path()) == RenderFixtures.render(),
           "#{RenderFixtures.path()} is stale; run mix sketch.gen.render_fixtures"
  end

  test "the committed wrap parity fixture is the generated one (ADR 0004)" do
    assert File.read!(WrapFixtures.path()) == WrapFixtures.render(),
           "#{WrapFixtures.path()} is stale; run mix sketch.gen.render_fixtures"
  end

  for kind <- Sketch.Canvas.element_kinds() do
    @kind kind

    test "#{kind} renders the fixture's node tree inside a wrapper translated to its box" do
      for {shape, index} <- Enum.with_index(RenderFixtures.shapes(@kind)) do
        id = "element-#{index}"
        element = Map.merge(shape, %{id: id, kind: @kind, x: 7, y: 9, version: 3})

        html = render_component(&Elements.element/1, dom_id: id, element: element)
        # Outside <svg> the HTML parser ignores "/>" on <line>, so sibling lines would nest.
        assert [{"svg", _svg, [{"g", attrs, children}]}] =
                 "<svg>#{html}</svg>" |> LazyHTML.from_fragment() |> LazyHTML.to_tree()

        attrs = Map.new(attrs)

        assert %{
                 "data-element" => ^id,
                 "data-kind" => _kind,
                 "data-x" => "7",
                 "data-y" => "9",
                 "data-version" => "3",
                 "transform" => "translate(7 9)",
                 "x" => "7",
                 "y" => "9"
               } = attrs

        assert attrs["data-width"] == attrs["width"] and attrs["width"] == "#{shape.width}"
        assert attrs["data-height"] == attrs["height"] and attrs["height"] == "#{shape.height}"
        assert attrs["data-points"] == attrs["live-points"]
        assert attrs["live-points"] == points_attribute(shape.points)

        assert tree(children) ==
                 @kind |> Elements.render_children(shape) |> RenderFixtures.normalize(),
               inspect(shape)
      end
    end
  end

  defp points_attribute([]), do: nil
  defp points_attribute(points), do: Enum.map_join(points, " ", &"#{&1.x},#{&1.y}")

  defp tree(nodes) do
    for {tag, attrs, children} <- nodes do
      %{"tag" => tag, "attrs" => Map.new(attrs)}
      |> put_content(children)
    end
  end

  defp put_content(node, children) do
    if Enum.all?(children, &is_binary/1),
      do: put_text(node, Enum.join(children)),
      else: Map.put(node, "children", children |> Enum.reject(&whitespace?/1) |> tree())
  end

  defp put_text(node, ""), do: node
  defp put_text(node, text), do: Map.put(node, "text", text)

  defp whitespace?(child), do: is_binary(child) and String.trim(child) == ""
end
