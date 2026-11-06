defmodule Sketch.Canvas.Label do
  @moduledoc """
  The text of a kind with `text: :label` (rectangle, diamond, ellipse) is drawn centred on a label
  point inside the box. The point is an offset in per mille of the box's width and height, so it
  stays inside the box through moves and resizes; it defaults to the centre and every offset a
  client sends is clamped to the box. `assets/js/elements/label.ts` is the client twin, checked by
  the render parity fixture.
  """

  alias Sketch.Canvas.{Binding, Kinds}

  @scale Binding.anchor_scale()
  @default %{x: div(@scale, 2), y: div(@scale, 2)}
  @kinds for %{id: id, text: :label} <- Kinds.all(), do: id

  @type offset :: %{x: 0..1000, y: 0..1000}

  @doc "The kinds whose text is a label."
  @spec kinds() :: [atom()]
  def kinds, do: @kinds

  @spec default() :: offset()
  def default, do: @default

  @spec scale() :: pos_integer()
  def scale, do: @scale

  @doc "An offset clamped into the box: each coordinate into `0..scale`."
  @spec clamp(%{x: integer(), y: integer()}) :: offset()
  def clamp(%{x: x, y: y}), do: %{x: x |> max(0) |> min(@scale), y: y |> max(0) |> min(@scale)}

  @doc """
  Where a text block of `block_width` by `block_height` is centred for an offset in a box of
  `width` by `height`: at the offset's point, moved just far enough that the block stays inside the
  box, or in the middle of the box on an axis where the block is larger than the box.
  """
  @spec placed(
          non_neg_integer(),
          non_neg_integer(),
          offset(),
          non_neg_integer(),
          non_neg_integer()
        ) ::
          %{x: integer(), y: integer()}
  def placed(width, height, offset, block_width, block_height) do
    %{x: x, y: y} = point(width, height, offset)
    %{x: within(x, block_width, width), y: within(y, block_height, height)}
  end

  defp within(_at, block, size) when block >= size, do: div(size, 2)

  defp within(at, block, size) do
    half = div(block + 1, 2)
    at |> max(half) |> min(size - half)
  end

  @doc "The label point of an offset in a box of `width` by `height`, relative to the box origin."
  @spec point(non_neg_integer(), non_neg_integer(), offset()) :: %{x: integer(), y: integer()}
  def point(width, height, offset),
    do: Binding.anchor_point(%{x: 0, y: 0, width: width, height: height}, offset)
end
