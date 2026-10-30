defmodule Sketch.Canvas.Kinds.Text do
  @moduledoc """
  A box of non-blank text, one line per `Geometry` line height, sized by the client to its longest
  measured line.
  """
  @behaviour Sketch.Canvas.Kind

  alias Sketch.Canvas.Kind

  @impl true
  def spec,
    do: %Kind{
      id: :text,
      geometry: :box,
      text: :required,
      draw_gesture: :click_to_type,
      default_size: %{width: 1, height: 25}
    }
end
