defmodule Sketch.Canvas.Kinds.Diamond do
  @moduledoc "A box-shaped rhombus with an optional label."
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :diamond,
      geometry: :box,
      text: :label,
      draw_gesture: :box,
      default_size: %{width: 120, height: 80},
      style: [:stroke_color, :fill_color, :stroke_width, :stroke_style, :sloppiness]
    }
end
