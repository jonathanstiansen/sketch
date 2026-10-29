defmodule SketchWeb.ElementRenderer do
  @moduledoc """
  Renders the children of one element kind in local coordinates (ADR 0004): the element's box
  spans `[0, width] × [0, height]` and its wrapper, `SketchWeb.Elements.element/1`, translates
  it into place. A renderer returns SVG nodes rather than HEEx so that
  `mix sketch.gen.render_fixtures` can compare it with the kind's client renderer in
  `assets/js/elements/`.
  """

  @type point :: %{x: integer(), y: integer()}

  @type local_shape :: %{
          width: non_neg_integer(),
          height: non_neg_integer(),
          points: [point()],
          text: String.t()
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

  @doc """
  The two `line` nodes of a segment kind: a wide transparent one that takes the pointer and a thin
  visible one on top, which also carries `stroke_attrs`.
  """
  @spec segments([point()], [{String.t(), attribute_value()}]) :: [svg_node()]
  def segments([start, finish], stroke_attrs \\ []) do
    [
      segment(start, finish, [
        {"data-line-hit", ""},
        {"stroke", "transparent"},
        {"stroke-width", 14}
      ]),
      segment(
        start,
        finish,
        [
          {"data-line-stroke", ""},
          {"stroke-width", 2},
          {"pointer-events", "none"},
          {"class", "stroke-base-content"}
        ] ++ stroke_attrs
      )
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
end
