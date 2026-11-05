defmodule Sketch.Canvas.Kinds.Note do
  @moduledoc """
  A box of possibly empty text, wrapped to the box's width inside `Geometry` padding and clipped to
  the box. Drawing one opens its text editor over the drawn box.
  """
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :note,
      geometry: :box,
      text: :optional,
      draw_gesture: :box,
      default_size: %{width: 200, height: 160},
      style: [:stroke_color, :fill_color, :sloppiness]
    }
end
