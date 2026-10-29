defmodule SketchWeb.ElementsTest do
  use ExUnit.Case, async: true

  import Phoenix.LiveViewTest

  alias SketchWeb.{Elements, RenderFixtures}

  test "the committed render parity fixture is the generated one (ADR 0004)" do
    assert File.read!(RenderFixtures.path()) == RenderFixtures.render(),
           "#{RenderFixtures.path()} is stale; run mix sketch.gen.render_fixtures"
  end

  test "the renderers cover exactly the kinds that left Sketch.Canvas.Kinds.Legacy" do
    assert Enum.sort(Elements.kinds() ++ Sketch.Canvas.legacy_kinds()) ==
             Enum.sort(Sketch.Canvas.element_kinds())

    assert Elements.kinds() -- Sketch.Canvas.legacy_kinds() == Elements.kinds()
  end

  for kind <- Elements.kinds() do
    @kind kind

    test "#{kind} renders the fixture's node tree inside a wrapper translated to its box" do
      for {shape, index} <- Enum.with_index(RenderFixtures.shapes(@kind)) do
        id = "element-#{index}"
        element = Map.merge(shape, %{id: id, kind: @kind, x: 7, y: 9, version: 3})

        html = render_component(&Elements.element/1, dom_id: id, element: element)
        assert [{"g", attrs, children}] = html |> LazyHTML.from_fragment() |> LazyHTML.to_tree()

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

        assert tree(children) ==
                 @kind |> Elements.render_children(shape) |> RenderFixtures.normalize(),
               inspect(shape)
      end
    end
  end

  defp tree(nodes) do
    for {tag, attrs, children} <- nodes do
      %{"tag" => tag, "attrs" => Map.new(attrs)}
      |> put_content(Enum.reject(children, &whitespace?/1))
    end
  end

  defp put_content(node, []), do: node
  defp put_content(node, [text]) when is_binary(text), do: Map.put(node, "text", text)
  defp put_content(node, children), do: Map.put(node, "children", tree(children))

  defp whitespace?(child), do: is_binary(child) and String.trim(child) == ""
end
