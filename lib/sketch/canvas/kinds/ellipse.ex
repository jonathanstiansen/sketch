defmodule Sketch.Canvas.Kinds.Ellipse do
  @moduledoc "A box-shaped ellipse without text."
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :ellipse,
      geometry: :box,
      text: :none,
      draw_gesture: :box,
      default_size: %{width: 120, height: 80},
      style: [:stroke_color, :fill_color, :stroke_width, :stroke_style, :sloppiness]
    }
end
