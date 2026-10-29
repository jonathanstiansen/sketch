defmodule Sketch.Canvas.Kinds.Legacy do
  @moduledoc """
  The specs of the kinds that have not moved into their own module yet (ADR 0004). Each later PR
  moves one kind out and removes its old code paths from A22's `legacy_kind_files`; the last one
  deletes this module.
  """

  alias Sketch.Canvas.Kind

  @spec specs() :: [Kind.t()]
  def specs do
    [
      %Kind{id: :text, geometry: :box, text: :required, default_size: %{width: 1, height: 25}},
      %Kind{id: :note, geometry: :box, text: :optional, default_size: %{width: 200, height: 160}}
    ]
  end
end
