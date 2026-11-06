defmodule SketchWeb.RenderFixtures do
  @moduledoc """
  Renders `assets/test/fixtures/render_parity.json` (ADR 0004): the children each server renderer
  in `SketchWeb.Elements` draws for a fixed set of shapes, as SVG node trees whose attribute values
  are the strings HEEx writes into the page. A point kind is rendered along three paths inside
  each box (corner to corner, zigzag between the top and bottom edges, and strictly inside), with
  its minimum point count and its maximum capped at 12 to keep the file small. A kind with text is
  rendered with every fixture text in boxes 0 or 4000 tall and 0, 1, 4000 or a wrapping boundary
  wide: twice the note padding plus 0 to 3 and 14 character widths, each also one pixel narrower
  and wider, so a note's lines break around every boundary, including widths narrower than both
  paddings together. A box kind without text renders every shape with each fixture seed, including
  0 and the largest; point and text kinds, which already have many shapes per box, take the seed
  their shape hashes to, so adding a shape leaves the other shapes' seeds alone (ADR 0005). Every shape is drawn in the default style, and three shapes spread over the
  kind's shapes are also drawn in a sample of styles (ADR 0006): each token of each property that
  applies to the kind on its own, and a few combinations that change every applicable property at
  once; the full product would make the file several times larger for little more coverage.
  A case lists only the style tokens that differ from the registry defaults, so adding a
  property whose default draws as before leaves every existing case unchanged.
  Every map has string keys, so the JSON key order is the same on every run.
  `assets/test/render_parity.test.ts` feeds the same shapes to the client renderers and expects
  the same trees. A node's text is the unescaped
  string a browser shows as its `textContent`, and is left out when empty, as an empty element has
  no text node.
  `mix sketch.gen.render_fixtures --check` fails when the file is stale. `SketchWeb.WrapFixtures`
  covers the wrapping itself in more depth.
  """

  alias Phoenix.HTML.Safe
  alias SketchWeb.Elements

  @path "assets/test/fixtures/render_parity.json"

  @sizes [0, 1, 2, 119, 120, 3999, 4000]
  @texts [
    "",
    "a",
    "two\nlines",
    "three\n\nlines",
    "trailing newline\n",
    "  padded  \n \t \n\tend",
    "crlf\r\nand\rcr",
    "ünïcødé ñ 中文 😀 𝄞 👩‍💻",
    "<b>bold</b> & \"quoted\" 'single' &amp; &lt;",
    "the quick brown fox jumps over the lazy dog",
    "supercalifragilisticexpialidocious",
    "a  b   c    d",
    "   ",
    "no\u00A0break\u00A0space and\u3000ideographic\u2028separator",
    "😀😀😀😀😀😀😀😀😀😀 𝄞𝄞𝄞𝄞𝄞𝄞 👩‍💻👩‍💻",
    "short\nand a second line that wraps\n\n\tindented"
  ]
  @text_sizes [0, 1, 4000]
  @label_texts [
    "a",
    "two\nlines",
    "the quick brown fox jumps over the lazy dog",
    "ünïcødé ñ 中文 😀 𝄞 👩‍💻",
    "<b>bold</b> & \"quoted\" 'single' &amp; &lt;"
  ]
  @label_widths [0, 1, 80, 4000] ++
                  for(
                    offset <- [-1, 0, 1],
                    do:
                      2 * Sketch.Canvas.geometry().note_padding +
                        14 * Sketch.Canvas.geometry().char_width + offset
                  )
  @label_heights [0, 80, 4000]
  @text_heights [0, 4000]
  @point_paths [:diagonal, :zigzag, :interior]
  @seeds [
    0,
    1,
    7,
    1_234_567_890,
    Sketch.Canvas.geometry().max_seed - 1,
    Sketch.Canvas.geometry().max_seed
  ]
  @max_fixture_points 12
  @styled_shapes 3
  @label_offsets [%{x: 0, y: 0}, %{x: 1000, y: 1000}, %{x: 250, y: 750}, %{x: 999, y: 1}]
  @style_combinations 6

  @spec path() :: Path.t()
  def path, do: @path

  @spec render() :: String.t()
  def render do
    kinds =
      Enum.map_join(Sketch.Canvas.element_kinds(), ",\n", fn kind ->
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

    geometry
    |> laid_out(text)
    |> Enum.map(
      &Map.merge(&1, %{
        style: Sketch.Canvas.style_defaults(),
        label: Sketch.Canvas.label_default()
      })
    )
  end

  defp laid_out(geometry, :label) do
    labels =
      for width <- @label_widths, height <- @label_heights, text <- @label_texts do
        %{width: width, height: height, points: [], text: text}
      end

    laid_out(geometry, :none) ++ with_seeds(labels, geometry, :label)
  end

  defp laid_out(geometry, text) do
    shapes =
      for width <- widths(text),
          height <- heights(text),
          points <- point_sets(geometry, width, height),
          text <- texts(text) do
        %{width: width, height: height, points: points, text: text}
      end

    with_seeds(shapes, geometry, text)
  end

  @doc "The shapes of a labelled kind drawn again with the label moved to the box's corners and off centre."
  @spec labelled_shapes(atom()) :: [SketchWeb.ElementRenderer.local_shape()]
  def labelled_shapes(kind) do
    if kind in Sketch.Canvas.label_kinds() do
      shapes = kind |> shapes() |> Enum.filter(&(&1.text != ""))
      spread = Enum.take_every(shapes, max(1, div(length(shapes), @styled_shapes)))

      for shape <- Enum.take(spread, @styled_shapes),
          label <- @label_offsets,
          do: %{shape | label: label}
    else
      []
    end
  end

  @doc "The shapes and styles the parity fixture also renders in other styles than the default."
  @spec styled_shapes(atom()) :: [SketchWeb.ElementRenderer.local_shape()]
  def styled_shapes(kind) do
    %{style: properties} = Enum.find(Sketch.Canvas.kind_specs(), &(&1.id == kind))
    shapes = shapes(kind)

    spread =
      shapes
      |> Enum.take_every(max(1, div(length(shapes), @styled_shapes)))
      |> Enum.take(@styled_shapes)

    for shape <- spread, style <- style_samples(properties), do: %{shape | style: style}
  end

  defp style_samples(properties) do
    defaults = Sketch.Canvas.style_defaults()

    singles =
      for property <- properties,
          token <- tl(Sketch.Canvas.style_tokens(property)),
          do: Map.put(defaults, property, token)

    combinations =
      for index <- 1..@style_combinations//1 do
        Map.new(Sketch.Canvas.style_properties(), fn property ->
          {property, combination_token(property, properties, index)}
        end)
      end

    Enum.uniq(singles ++ combinations)
  end

  defp combination_token(property, properties, index) do
    tokens = Sketch.Canvas.style_tokens(property)

    case Enum.find_index(properties, &(&1 == property)) do
      nil -> hd(tokens)
      position -> Enum.at(tokens, rem(index + position, length(tokens)))
    end
  end

  defp with_seeds(shapes, :box, :none) do
    for shape <- shapes, seed <- @seeds, do: Map.put(shape, :seed, seed)
  end

  defp with_seeds(shapes, _geometry, _text) do
    Enum.map(shapes, &Map.put(&1, :seed, Enum.at(@seeds, :erlang.phash2(&1, length(@seeds)))))
  end

  defp widths(:none), do: @sizes

  defp widths(_text) do
    %{char_width: char_width, note_padding: padding} = Sketch.Canvas.geometry()

    wrap_widths =
      for chars <- [0, 1, 2, 3, 14],
          offset <- [-1, 0, 1],
          do: 2 * padding + chars * char_width + offset

    (@text_sizes ++ wrap_widths) |> Enum.uniq() |> Enum.sort()
  end

  defp heights(:none), do: @sizes
  defp heights(_text), do: @text_heights

  @doc "A server renderer's children as a normalized node tree."
  @spec normalize([SketchWeb.ElementRenderer.svg_node()]) :: [map()]
  def normalize(nodes), do: Enum.map(nodes, &normalize_node/1)

  defp cases(kind) do
    for shape <- shapes(kind) ++ styled_shapes(kind) ++ labelled_shapes(kind) do
      %{
        "shape" =>
          %{
            "width" => shape.width,
            "height" => shape.height,
            "points" => Enum.map(shape.points, &%{"x" => &1.x, "y" => &1.y}),
            "text" => shape.text,
            "seed" => shape.seed,
            "style" => style_overrides(shape.style)
          }
          |> put_label(shape.label),
        "children" => kind |> Elements.render_children(shape) |> normalize()
      }
    end
  end

  defp put_label(shape, label) do
    if label == Sketch.Canvas.label_default(),
      do: shape,
      else: Map.put(shape, "label", %{"x" => label.x, "y" => label.y})
  end

  defp style_overrides(style) do
    defaults = Sketch.Canvas.style_defaults()

    for {property, token} <- style, token != defaults[property], into: %{} do
      {Atom.to_string(property), Atom.to_string(token)}
    end
  end

  defp normalize_node(node) do
    attrs = Map.new(node.attrs, fn {name, value} -> {name, attribute_string(value)} end)

    %{"tag" => node.tag, "attrs" => attrs}
    |> put_present("children", node |> Map.get(:children, []) |> normalize())
    |> put_present("text", Map.get(node, :text))
  end

  defp put_present(map, _key, value) when value in [nil, [], ""], do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  defp attribute_string(value) when is_binary(value), do: value

  defp attribute_string(value) when is_number(value),
    do: value |> Safe.to_iodata() |> IO.iodata_to_binary()

  defp point_sets(:box, _width, _height), do: [[]]

  defp point_sets({:points, range}, width, height) do
    for count <- Enum.uniq([range.first, min(range.last, @max_fixture_points)]),
        path <- @point_paths do
      Enum.map(0..(count - 1)//1, &point_on(path, &1, count, width, height))
    end
  end

  defp point_on(:diagonal, index, count, width, height),
    do: %{x: step(index, count - 1, width), y: step(index, count - 1, height)}

  defp point_on(:zigzag, index, count, width, height),
    do: %{x: width - step(index, count - 1, width), y: rem(index, 2) * height}

  defp point_on(:interior, index, count, width, height),
    do: %{x: step(index + 1, count + 1, width), y: height - step(index + 1, count + 1, height)}

  defp step(index, steps, length), do: div(index * length, steps)

  defp texts(:none), do: [""]
  defp texts(_text), do: @texts
end
