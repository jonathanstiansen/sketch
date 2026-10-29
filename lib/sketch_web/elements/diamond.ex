defmodule SketchWeb.Elements.Diamond do
  @moduledoc "Renders a diamond as one filled `polygon` through the midpoints of its box's sides."
  @behaviour SketchWeb.ElementRenderer

  import SketchWeb.ElementRenderer, only: [half: 1]

  @impl true
  def render(%{width: width, height: height}) do
    mid_x = half(width)
    mid_y = half(height)

    [
      %{
        tag: "polygon",
        attrs: [
          {"points", "#{mid_x},0 #{width},#{mid_y} #{mid_x},#{height} 0,#{mid_y}"},
          {"stroke-width", 2},
          {"class", "fill-primary stroke-base-content"}
        ]
      }
    ]
  end
end
