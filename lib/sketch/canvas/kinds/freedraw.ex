defmodule Sketch.Canvas.Kinds.Freedraw do
  @moduledoc "A freehand stroke through up to 500 points, without text."
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :freedraw,
      geometry: {:points, 2..500//1},
      text: :none,
      draw_gesture: :path,
      default_size: %{width: 120, height: 80}
    }
end
