defmodule Sketch.ArchitectureFixtures.TwoProperties do
  @moduledoc "Names two style properties for a reason, which A24 allows."
  def edge(style), do: {style.stroke_color, style.stroke_width}
end
