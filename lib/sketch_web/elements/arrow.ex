defmodule SketchWeb.Elements.Arrow do
  @moduledoc """
  Renders an arrow as a line whose hand-drawn stroke ends in the arrowhead marker of its stroke
  colour.
  """
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{points: points, style: style} = shape) do
    SketchWeb.ElementRenderer.segments(points, SketchWeb.HandDrawn.pen(shape), style, [
      {"marker-end", "url(##{SketchWeb.ElementRenderer.arrowhead_id(style.stroke_color)})"}
    ])
  end
end
