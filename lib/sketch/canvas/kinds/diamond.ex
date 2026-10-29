defmodule Sketch.Canvas.Kinds.Diamond do
  @moduledoc "A box-shaped rhombus without text."
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :diamond,
      geometry: :box,
      text: :none,
      default_size: %{width: 120, height: 80}
    }
end
