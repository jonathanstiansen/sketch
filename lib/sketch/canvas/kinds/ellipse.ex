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
      default_size: %{width: 120, height: 80}
    }
end
