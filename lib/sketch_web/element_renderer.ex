defmodule SketchWeb.ElementRenderer do
  @moduledoc """
  Renders the children of one element kind in local coordinates (ADR 0004): the element's box
  spans `[0, width] × [0, height]` and its wrapper, `SketchWeb.Elements.element/1`, translates
  it into place. A renderer returns SVG nodes rather than HEEx so that
  `mix sketch.gen.render_fixtures` can compare it with the kind's client renderer in
  `assets/js/elements/`.
  """

  @type local_shape :: %{
          width: non_neg_integer(),
          height: non_neg_integer(),
          points: [%{x: integer(), y: integer()}],
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
end
