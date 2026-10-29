defmodule Sketch.Canvas.Geometry do
  @moduledoc """
  Canvas and rectangle dimensions (addendum D1). Every bound on a rectangle position derives from here.
  """

  @canvas_width 4000
  @canvas_height 4000
  @rectangle_width 120
  @rectangle_height 80
  @cascade_start 100
  @cascade_step 150
  @cascade_length 20

  @type t :: %{
          canvas_width: pos_integer(),
          canvas_height: pos_integer(),
          rectangle_width: pos_integer(),
          rectangle_height: pos_integer(),
          max_x: non_neg_integer(),
          max_y: non_neg_integer()
        }

  @spec max_x() :: non_neg_integer()
  def max_x, do: @canvas_width - @rectangle_width

  @spec max_y() :: non_neg_integer()
  def max_y, do: @canvas_height - @rectangle_height

  @doc "Where the next new rectangle goes on a board that already has `count` rectangles."
  @spec default_position(non_neg_integer()) :: {non_neg_integer(), non_neg_integer()}
  def default_position(count) do
    offset = rem(count, @cascade_length) * @cascade_step
    {@cascade_start + offset, @cascade_start + offset}
  end

  @spec dimensions() :: t()
  def dimensions do
    %{
      canvas_width: @canvas_width,
      canvas_height: @canvas_height,
      rectangle_width: @rectangle_width,
      rectangle_height: @rectangle_height,
      max_x: max_x(),
      max_y: max_y()
    }
  end
end
