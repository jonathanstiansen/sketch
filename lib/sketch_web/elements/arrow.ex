defmodule SketchWeb.Elements.Arrow do
  @moduledoc """
  Renders an arrow as a line whose hand-drawn stroke ends in the `arrowhead` marker.
  """
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{points: points, seed: seed}),
    do: SketchWeb.ElementRenderer.segments(points, seed, [{"marker-end", "url(#arrowhead)"}])
end
