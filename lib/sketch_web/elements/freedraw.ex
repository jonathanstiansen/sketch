defmodule SketchWeb.Elements.Freedraw do
  @moduledoc """
  Renders a freehand stroke as a wide transparent `polyline` that takes the pointer and a thin
  visible `polyline` on top, both through the stroke's points in local coordinates.
  """
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{points: points}), do: SketchWeb.ElementRenderer.polylines(points)
end
