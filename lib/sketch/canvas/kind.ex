defmodule Sketch.Canvas.Kind do
  @moduledoc """
  The declaration of one element kind (ADR 0004): its `id`, whether its shape is a box or a bounded
  list of points inside its box, whether it holds no, optional or required text, and the size of a
  new element drawn with a click. `Sketch.Canvas.Kinds` lists every kind; the element attribute,
  `Sketch.Canvas.Geometry`, the validations, the CHECK constraints and the client manifest derive
  from these specs.
  """

  @enforce_keys [:id, :geometry, :text, :default_size]
  defstruct @enforce_keys

  @type geometry :: :box | {:points, Range.t()}
  @type text :: :none | :optional | :required
  @type size :: %{width: pos_integer(), height: pos_integer()}

  @type t :: %__MODULE__{
          id: atom(),
          geometry: geometry(),
          text: text(),
          default_size: size()
        }

  @callback spec() :: t()
end
