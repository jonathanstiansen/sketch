defmodule SketchWeb.Elements.Ellipse do
  @moduledoc "Renders an ellipse as one filled `ellipse` inscribed in its box."
  @behaviour SketchWeb.ElementRenderer

  import SketchWeb.ElementRenderer, only: [half: 1]

  @impl true
  def render(%{width: width, height: height}) do
    [
      %{
        tag: "ellipse",
        attrs: [
          {"cx", half(width)},
          {"cy", half(height)},
          {"rx", half(width)},
          {"ry", half(height)},
          {"stroke-width", 2},
          {"class", "fill-primary stroke-base-content"}
        ]
      }
    ]
  end
end
