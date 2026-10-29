defmodule SketchWeb.RenderFixtures do
  @moduledoc """
  Renders `assets/test/fixtures/render_parity.json` (ADR 0004): the children each server renderer
  in `SketchWeb.Elements` draws for a fixed set of shapes, as SVG node trees whose attribute values
  are the strings HEEx writes into the page. Every map has string keys, so the JSON key order is
  the same on every run. `assets/test/render_parity.test.ts` feeds the same
  shapes to the client renderers and expects the same trees.
  `mix sketch.gen.render_fixtures --check` fails when the file is stale.
  """

  alias Phoenix.HTML.Safe
  alias SketchWeb.Elements

  @path "assets/test/fixtures/render_parity.json"

  @sizes [0, 1, 2, 119, 120, 3999, 4000]
  @texts ["", "a", "two\nlines", "  padded  ", "ünïcødé & <tags>"]

  @spec path() :: Path.t()
  def path, do: @path

  @spec render() :: String.t()
  def render do
    kinds =
      Enum.map_join(Elements.kinds(), ",\n", fn kind ->
        cases = Enum.map_join(cases(kind), ",\n", &"    #{JSON.encode!(&1)}")
        "  #{JSON.encode!(Atom.to_string(kind))}: [\n#{cases}\n  ]"
      end)

    "{\n#{kinds}\n}\n"
  end

  @doc "The shapes the parity fixture renders for a kind, derived from its spec."
  @spec shapes(atom()) :: [SketchWeb.ElementRenderer.local_shape()]
  def shapes(kind) do
    %{geometry: geometry, text: text} =
      Enum.find(Sketch.Canvas.kind_specs(), &(&1.id == kind))

    for width <- @sizes,
        height <- @sizes,
        points <- point_sets(geometry, width, height),
        text <- texts(text) do
      %{width: width, height: height, points: points, text: text}
    end
  end

  @doc "A server renderer's children as a normalized node tree."
  @spec normalize([SketchWeb.ElementRenderer.svg_node()]) :: [map()]
  def normalize(nodes), do: Enum.map(nodes, &normalize_node/1)

  defp cases(kind) do
    for shape <- shapes(kind) do
      %{
        "shape" => %{
          "width" => shape.width,
          "height" => shape.height,
          "points" => Enum.map(shape.points, &%{"x" => &1.x, "y" => &1.y}),
          "text" => shape.text
        },
        "children" => kind |> Elements.render_children(shape) |> normalize()
      }
    end
  end

  defp normalize_node(node) do
    attrs = Map.new(node.attrs, fn {name, value} -> {name, attribute_string(value)} end)

    %{"tag" => node.tag, "attrs" => attrs}
    |> put_present("children", node |> Map.get(:children, []) |> normalize())
    |> put_present("text", Map.get(node, :text))
  end

  defp put_present(map, _key, value) when value in [nil, []], do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  defp attribute_string(value) when is_binary(value), do: value

  defp attribute_string(value) when is_number(value),
    do: value |> Safe.to_iodata() |> IO.iodata_to_binary()

  defp point_sets(:box, _width, _height), do: [[]]

  defp point_sets({:points, range}, width, height) do
    corners = [%{x: 0, y: 0}, %{x: width, y: height}, %{x: width, y: 0}, %{x: 0, y: height}]

    [range.first, min(range.last, length(corners))]
    |> Enum.uniq()
    |> Enum.map(&Enum.take(Stream.cycle(corners), &1))
  end

  defp texts(:none), do: [""]
  defp texts(_text), do: @texts
end
