defmodule Sketch.Canvas.Kinds.Legacy do
  @moduledoc """
  The specs of the kinds that have not moved into their own module yet (ADR 0004). Each later PR
  moves one kind out and removes its old code paths from A22's `legacy_kind_files`; the last one
  deletes this module.
  """

  alias Sketch.Canvas.Kind

  @default_size %{width: 120, height: 80}

  @spec specs() :: [Kind.t()]
  def specs do
    [
      %Kind{id: :ellipse, geometry: :box, text: :none, default_size: @default_size},
      %Kind{id: :arrow, geometry: {:points, 2..2//1}, text: :none, default_size: @default_size},
      %Kind{
        id: :freedraw,
        geometry: {:points, 2..500//1},
        text: :none,
        default_size: @default_size
      },
      %Kind{id: :line, geometry: {:points, 2..2//1}, text: :none, default_size: @default_size},
      %Kind{id: :text, geometry: :box, text: :required, default_size: %{width: 1, height: 25}},
      %Kind{id: :note, geometry: :box, text: :optional, default_size: %{width: 200, height: 160}}
    ]
  end
end
