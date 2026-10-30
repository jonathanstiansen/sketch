defmodule Sketch.Canvas.Kinds.Arrow do
  @moduledoc "A straight segment between a start and an end point, with an arrowhead on the end and no text."
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :arrow,
      geometry: {:points, 2..2//1},
      text: :none,
      draw_gesture: :two_point,
      default_size: %{width: 120, height: 80},
      style: [:stroke_color, :stroke_width, :stroke_style]
    }
end
