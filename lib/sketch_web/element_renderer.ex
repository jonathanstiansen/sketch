defmodule SketchWeb.ElementRenderer do
  @moduledoc """
  Renders the children of one element kind in local coordinates (ADR 0004): the element's box
  spans `[0, width] × [0, height]` and its wrapper, `SketchWeb.Elements.element/1`, translates
  it into place. A renderer returns SVG nodes rather than HEEx so that
  `mix sketch.gen.render_fixtures` can compare it with the kind's client renderer in
  `assets/js/elements/`.

  A renderer draws the element's style (ADR 0006) with the helpers here, which map tokens to
  classes and attributes only: `stroke-palette-<token>` on strokes, `fill-palette-<token>` on
  fills, `ink-palette-<token>` on glyphs, the width's pixels and, for a dashed or dotted style, a
  `stroke-dasharray`. `assets/css/app.css` gives the classes their theme colours.
  """

  @type point :: %{x: integer(), y: integer()}

  @type style :: %{
          stroke_color: atom(),
          fill_color: atom(),
          stroke_width: atom(),
          stroke_style: atom()
        }

  @type local_shape :: %{
          width: non_neg_integer(),
          height: non_neg_integer(),
          points: [point()],
          text: String.t(),
          seed: non_neg_integer(),
          style: style()
        }

  @type attribute_value :: String.t() | number()

  @type svg_node :: %{
          required(:tag) => String.t(),
          required(:attrs) => [{String.t(), attribute_value()}],
          optional(:children) => [svg_node()],
          optional(:text) => String.t()
        }

  @callback render(local_shape()) :: [svg_node()]

  @doc "Half of a size, an integer when the size is even so that it prints like JavaScript's `String(n)`."
  @spec half(non_neg_integer()) :: number()
  def half(value) when rem(value, 2) == 0, do: div(value, 2)
  def half(value), do: value / 2

  @doc "The class that fills a shape with the style's fill colour."
  @spec fill_class(style()) :: String.t()
  def fill_class(%{fill_color: fill_color}), do: "fill-palette-#{fill_color}"

  @doc "The class that colours glyphs with the style's stroke colour, the colour of the kind's ink."
  @spec ink_class(style()) :: String.t()
  def ink_class(%{stroke_color: stroke_color}), do: "ink-palette-#{stroke_color}"

  @doc "The class that colours a stroke with the style's stroke colour."
  @spec stroke_class(style()) :: String.t()
  def stroke_class(%{stroke_color: stroke_color}), do: "stroke-palette-#{stroke_color}"

  @doc "The id of the arrowhead marker drawn in a stroke colour."
  @spec arrowhead_id(atom()) :: String.t()
  def arrowhead_id(stroke_color), do: "arrowhead-#{stroke_color}"

  @doc """
  The width and dash attributes of a stroke in the style: `:sketch` for each of the two passes of a
  hand-drawn outline, `:single` for a stroke drawn once.
  """
  @spec stroke_attrs(style(), :sketch | :single) :: [{String.t(), attribute_value()}]
  def stroke_attrs(%{stroke_width: width, stroke_style: stroke_style}, passes) do
    [{"stroke-width", stroke_width(width, passes)}] ++
      case Sketch.Canvas.style_dash_array(stroke_style, width) do
        nil -> []
        dash_array -> [{"stroke-dasharray", dash_array}]
      end
  end

  defp stroke_width(width, :sketch), do: Sketch.Canvas.style_sketch_px(width)
  defp stroke_width(width, :single), do: Sketch.Canvas.style_stroke_px(width)

  @doc """
  The hand-drawn outline over an exact shape (ADR 0005) in the style's stroke: a `path` of
  `SketchWeb.HandDrawn` strokes that never takes the pointer, so the shape under it keeps the hit
  geometry. `class` replaces the stroke colour class.
  """
  @spec sketch(String.t(), style(), String.t() | nil) :: svg_node()
  def sketch(path_data, style, class \\ nil) do
    %{
      tag: "path",
      attrs:
        [
          {"data-sketch", ""},
          {"d", path_data},
          {"fill", "none"},
          {"stroke-linecap", "round"},
          {"stroke-linejoin", "round"},
          {"pointer-events", "none"},
          {"class", class || stroke_class(style)}
        ] ++ stroke_attrs(style, :sketch)
    }
  end

  @doc """
  The two nodes of a segment kind: a wide transparent `line` that takes the pointer and the
  hand-drawn `path` of the segment in the style's stroke on top, which also carries `extra_attrs`.
  """
  @spec segments([point()], non_neg_integer(), style(), [{String.t(), attribute_value()}]) :: [
          svg_node()
        ]
  def segments([start, finish], seed, style, extra_attrs \\ []) do
    [
      segment(start, finish, [
        {"data-line-hit", ""},
        {"stroke", "transparent"},
        {"stroke-width", 14}
      ]),
      %{
        tag: "path",
        attrs:
          [
            {"data-line-stroke", ""},
            {"d", SketchWeb.HandDrawn.line(start, finish, seed)},
            {"fill", "none"},
            {"stroke-linecap", "round"},
            {"pointer-events", "none"},
            {"class", stroke_class(style)}
          ] ++ stroke_attrs(style, :sketch) ++ extra_attrs
      }
    ]
  end

  defp segment(start, finish, attrs) do
    %{
      tag: "line",
      attrs:
        [
          {"x1", start.x},
          {"y1", start.y},
          {"x2", finish.x},
          {"y2", finish.y},
          {"stroke-linecap", "round"}
        ] ++ attrs
    }
  end

  @doc """
  The two `polyline` nodes of a stroke kind: a wide transparent one that takes the pointer and a
  visible one in the style's stroke on top.
  """
  @spec polylines([point()], style()) :: [svg_node()]
  def polylines(points, _style) when length(points) < 2, do: []

  def polylines(points, style) do
    [
      polyline(points, [
        {"data-freedraw-hit", ""},
        {"stroke", "transparent"},
        {"stroke-width", 14}
      ]),
      polyline(
        points,
        [
          {"data-freedraw-stroke", ""},
          {"pointer-events", "none"},
          {"class", stroke_class(style)}
        ] ++ stroke_attrs(style, :single)
      )
    ]
  end

  defp polyline(points, attrs) do
    %{
      tag: "polyline",
      attrs:
        [
          {"points", Enum.map_join(points, " ", &"#{&1.x},#{&1.y}")},
          {"fill", "none"},
          {"stroke-linecap", "round"},
          {"stroke-linejoin", "round"}
        ] ++ attrs
    }
  end
end
