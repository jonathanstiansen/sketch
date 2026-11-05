defmodule SketchWeb.Elements.Ellipse do
  @moduledoc "Renders an ellipse as one filled `ellipse` inscribed in its box under its hand-drawn curves."
  @behaviour SketchWeb.ElementRenderer

  import SketchWeb.ElementRenderer, only: [half: 1]

  @impl true
  def render(%{width: width, height: height, style: style} = shape) do
    [
      %{
        tag: "ellipse",
        attrs: [
          {"cx", half(width)},
          {"cy", half(height)},
          {"rx", half(width)},
          {"ry", half(height)},
          {"stroke", "transparent"},
          {"stroke-width", 2},
          {"class", SketchWeb.ElementRenderer.fill_class(style)}
        ]
      },
      SketchWeb.ElementRenderer.sketch(
        SketchWeb.HandDrawn.ellipse(width, height, SketchWeb.HandDrawn.pen(shape)),
        style
      )
    ]
  end
end
