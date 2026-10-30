defmodule Sketch.Canvas.Style.StrokeStyle do
  @moduledoc "An element's `stroke_style`: one of its tokens in `Sketch.Canvas.Style`."
  alias Sketch.Canvas.Style

  use Ash.Type.Enum, values: Style.tokens(:stroke_style)
end
