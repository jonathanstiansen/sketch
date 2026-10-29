defmodule Sketch.Canvas.Kinds.Rectangle do
  @moduledoc "An axis-aligned box without text."
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :rectangle,
      geometry: :box,
      text: :none,
      default_size: %{width: 120, height: 80}
    }
end
