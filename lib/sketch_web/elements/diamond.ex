defmodule SketchWeb.Elements.Diamond do
  @moduledoc """
  Renders a diamond as one filled `polygon` through the midpoints of its box's sides under its
  hand-drawn edges.
  """
  @behaviour SketchWeb.ElementRenderer

  import SketchWeb.ElementRenderer, only: [half: 1]

  @impl true
  def render(%{width: width, height: height, seed: seed}) do
    mid_x = half(width)
    mid_y = half(height)

    [
      %{
        tag: "polygon",
        attrs: [
          {"points", "#{mid_x},0 #{width},#{mid_y} #{mid_x},#{height} 0,#{mid_y}"},
          {"stroke", "transparent"},
          {"stroke-width", 2},
          {"class", "fill-primary"}
        ]
      },
      SketchWeb.ElementRenderer.sketch(SketchWeb.HandDrawn.diamond(width, height, seed))
    ]
  end
end
