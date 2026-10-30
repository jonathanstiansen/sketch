defmodule Sketch.Canvas.Style.FillColor do
  @moduledoc "An element's `fill_color`: one of its tokens in `Sketch.Canvas.Style`."
  alias Sketch.Canvas.Style

  use Ash.Type.Enum, values: Style.tokens(:fill_color)
end
