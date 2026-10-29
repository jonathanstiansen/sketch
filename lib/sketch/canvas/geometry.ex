defmodule Sketch.Canvas.Geometry do
  @moduledoc """
  Canvas and element dimensions (addendum D1, D8). Every bound on an element's box derives from here:
  `x >= 0`, `y >= 0`, `width >= 1`, `height >= 1`, `x + width <= canvas_width` and
  `y + height <= canvas_height`.
  """

  @canvas_width 4000
  @canvas_height 4000
  @default_width 120
  @default_height 80
  @min_size 1
  @cascade_start 100
  @cascade_step 150
  @cascade_length 20

  @type box :: %{
          x: integer(),
          y: integer(),
          width: integer(),
          height: integer()
        }

  @type t :: %{
          canvas_width: pos_integer(),
          canvas_height: pos_integer(),
          default_width: pos_integer(),
          default_height: pos_integer(),
          min_size: pos_integer()
        }

  @spec canvas_width() :: pos_integer()
  def canvas_width, do: @canvas_width

  @spec canvas_height() :: pos_integer()
  def canvas_height, do: @canvas_height

  @spec min_size() :: pos_integer()
  def min_size, do: @min_size

  @doc "The default-sized box of the next new element on a board that already has `count` elements."
  @spec default_box(non_neg_integer()) :: box()
  def default_box(count) do
    offset = @cascade_start + rem(count, @cascade_length) * @cascade_step
    %{x: offset, y: offset, width: @default_width, height: @default_height}
  end

  @doc "The nearest box inside the canvas: the size is capped to the canvas, then the box is shifted in."
  @spec clamp_box(box()) :: box()
  def clamp_box(%{x: x, y: y, width: width, height: height}) do
    width = clamp(width, @min_size, @canvas_width)
    height = clamp(height, @min_size, @canvas_height)

    %{
      x: clamp(x, 0, @canvas_width - width),
      y: clamp(y, 0, @canvas_height - height),
      width: width,
      height: height
    }
  end

  defp clamp(value, min, max), do: value |> max(min) |> min(max)

  @spec dimensions() :: t()
  def dimensions do
    %{
      canvas_width: @canvas_width,
      canvas_height: @canvas_height,
      default_width: @default_width,
      default_height: @default_height,
      min_size: @min_size
    }
  end
end
