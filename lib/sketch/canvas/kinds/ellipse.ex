defmodule Sketch.Canvas.Kinds.Ellipse do
  @moduledoc "A box-shaped ellipse with an optional label."
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :ellipse,
      geometry: :box,
      text: :label,
      draw_gesture: :box,
      default_size: %{width: 120, height: 80},
      style: [:stroke_color, :fill_color, :stroke_width, :stroke_style, :sloppiness]
    }
end
