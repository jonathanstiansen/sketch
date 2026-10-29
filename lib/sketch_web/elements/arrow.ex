defmodule SketchWeb.Elements.Arrow do
  @moduledoc """
  Renders an arrow as a line whose visible `line` ends in the `arrowhead` marker.
  """
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{points: points}),
    do: SketchWeb.ElementRenderer.segments(points, [{"marker-end", "url(#arrowhead)"}])
end
