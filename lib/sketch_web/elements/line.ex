defmodule SketchWeb.Elements.Line do
  @moduledoc """
  Renders a line as a wide transparent `line` that takes the pointer and its hand-drawn stroke on
  top, both from the start to the end point in local coordinates.
  """
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{points: points, seed: seed}), do: SketchWeb.ElementRenderer.segments(points, seed)
end
