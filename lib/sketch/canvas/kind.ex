defmodule Sketch.Canvas.Kind do
  @moduledoc """
  The declaration of one element kind (ADR 0004): its `id`, whether its shape is a box or a bounded
  list of points inside its box, whether it holds no, optional or required text, how its tool
  creates it, and the size of a new element drawn with a click. `Sketch.Canvas.Kinds` lists every
  kind; the element attribute, `Sketch.Canvas.Geometry`, the validations, the CHECK constraints and
  the client manifest derive from these specs.

  `draw_gesture` is what a press with the kind's tool does: `:box` drags a box (a click makes one of
  `default_size`), `:two_point` drags from a start to an end point, `:path` records a freehand
  path, and `:click_to_type` opens a text editor at the click, sized to the typed text. A drawn
  kind that holds text opens its editor over the drawn box.

  `style` lists the `Sketch.Canvas.Style` properties that apply to the kind (ADR 0006); every other
  property keeps its default.

  `text: :label` is optional text drawn as a centred label at an offset the user can drag inside
  the box (`Sketch.Canvas.Label`); drawing such a kind does not open its editor, Enter or a double
  click does.
  """

  alias Sketch.Canvas.Style

  @enforce_keys [:id, :geometry, :text, :draw_gesture, :default_size, :style]
  defstruct @enforce_keys

  @type geometry :: :box | {:points, Range.t()}
  @type text :: :none | :optional | :required | :label
  @type draw_gesture :: :box | :two_point | :path | :click_to_type
  @type size :: %{width: pos_integer(), height: pos_integer()}

  @type t :: %__MODULE__{
          id: atom(),
          geometry: geometry(),
          text: text(),
          draw_gesture: draw_gesture(),
          default_size: size(),
          style: [Style.property()]
        }

  @callback spec() :: t()

  @doc """
  Whether a spec's draw gesture can produce its geometry: a box gesture or a typed one makes a box,
  a two-point gesture exactly two points, a path at least two, and typing needs a kind with text.
  """
  @spec consistent?(t()) :: boolean()
  def consistent?(%__MODULE__{draw_gesture: :box, geometry: :box}), do: true

  def consistent?(%__MODULE__{draw_gesture: :click_to_type, geometry: :box, text: text}),
    do: text != :none

  def consistent?(%__MODULE__{draw_gesture: :two_point, geometry: {:points, 2..2//1}}), do: true

  def consistent?(%__MODULE__{draw_gesture: :path, geometry: {:points, first..last//1}}),
    do: first == 2 and last > 2

  def consistent?(%__MODULE__{}), do: false

  @doc "Whether a spec's `style` lists distinct properties that `Sketch.Canvas.Style` declares."
  @spec style_known?(t()) :: boolean()
  def style_known?(%__MODULE__{style: style}) when is_list(style),
    do: Enum.uniq(style) == style and style -- Style.properties() == []

  def style_known?(%__MODULE__{}), do: false
end
