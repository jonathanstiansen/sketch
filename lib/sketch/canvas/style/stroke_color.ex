defmodule Sketch.Canvas.Style.StrokeColor do
  @moduledoc "An element's `stroke_color`: one of its tokens in `Sketch.Canvas.Style`."
  alias Sketch.Canvas.Style

  use Ash.Type.Enum, values: Style.tokens(:stroke_color)
end
