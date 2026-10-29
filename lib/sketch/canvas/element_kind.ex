defmodule Sketch.Canvas.ElementKind do
  @moduledoc "The `kind` of an element: one of the ids in `Sketch.Canvas.Kinds`."
  alias Sketch.Canvas.Kinds

  use Ash.Type.Enum, values: Kinds.ids()
end
