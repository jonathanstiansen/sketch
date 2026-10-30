defmodule Sketch.Canvas.Style.StrokeWidth do
  @moduledoc "An element's `stroke_width`: one of its tokens in `Sketch.Canvas.Style`."
  alias Sketch.Canvas.Style

  use Ash.Type.Enum, values: Style.tokens(:stroke_width)
end
