defmodule Sketch.Canvas.Point do
  @moduledoc """
  A point of a line, relative to its element's box origin (ADR 0003), so moving the element moves
  its points.
  """
  use Ash.Resource, data_layer: :embedded

  alias Sketch.Canvas.Geometry

  attributes do
    attribute :x, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: Geometry.canvas_width()]

    attribute :y, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: Geometry.canvas_height()]
  end
end
