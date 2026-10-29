defmodule Sketch.Canvas.Geometry do
  @moduledoc """
  Canvas and element dimensions (addendum D1, D8). Every bound on an element's box and points
  derives from here: `x >= 0`, `y >= 0`, `x + width <= canvas_width`, `y + height <= canvas_height`,
  a size of at least `min_size(kind)`, and for point kinds a bounded number of points, each relative
  to the box origin and inside `[0, width] x [0, height]`. Text kinds hold non-blank text of at most
  `max_text_length` code points, laid out one line per `line_height` at a fixed `font_size`; every
  other kind holds empty text.
  """

  @canvas_width 4000
  @canvas_height 4000
  @default_width 120
  @default_height 80
  @min_size 1
  @max_freedraw_points 500
  @point_counts %{arrow: 2..2//1, freedraw: 2..@max_freedraw_points//1, line: 2..2//1}
  @max_points @point_counts |> Map.values() |> Enum.map(& &1.last) |> Enum.max()
  @text_kinds [:text]
  @max_text_length 2000
  @font_size 20
  @line_height 25
  @text_baseline 19
  @text_whitespace [?\s, ?\t, ?\n, ?\r]
  @cascade_start 100
  @cascade_step 150
  @cascade_length 20

  @type box :: %{
          x: integer(),
          y: integer(),
          width: integer(),
          height: integer()
        }

  @type point :: %{x: integer(), y: integer()}

  @type t :: %{
          canvas_width: pos_integer(),
          canvas_height: pos_integer(),
          default_width: pos_integer(),
          default_height: pos_integer(),
          min_size: pos_integer(),
          max_points: pos_integer(),
          max_text_length: pos_integer(),
          font_size: pos_integer(),
          line_height: pos_integer(),
          text_baseline: pos_integer()
        }

  @spec canvas_width() :: pos_integer()
  def canvas_width, do: @canvas_width

  @spec canvas_height() :: pos_integer()
  def canvas_height, do: @canvas_height

  @doc "The smallest width and height of a box kind; point kinds may be 0 wide or tall."
  @spec min_size(atom()) :: non_neg_integer()
  def min_size(kind) when is_map_key(@point_counts, kind), do: 0
  def min_size(_box_kind), do: @min_size

  @doc "The kinds whose shape is a list of points inside their box."
  @spec point_kinds() :: [atom()]
  def point_kinds, do: Map.keys(@point_counts)

  @doc "How many points an element of `kind` has; box kinds have none."
  @spec point_count(atom()) :: Range.t()
  def point_count(kind), do: Map.get(@point_counts, kind, 0..0//1)

  @spec max_points() :: pos_integer()
  def max_points, do: @max_points

  @doc "The kinds that hold text."
  @spec text_kinds() :: [atom()]
  def text_kinds, do: @text_kinds

  @spec max_text_length() :: pos_integer()
  def max_text_length, do: @max_text_length

  @doc """
  Whether `text` suits an element of `kind`: a text kind needs at most `max_text_length` code points,
  no NUL (PostgreSQL text cannot hold one) and a character other than a space, tab, CR or LF; any
  other kind needs `""`.
  """
  @spec text_fits_kind?(atom(), String.t()) :: boolean()
  def text_fits_kind?(kind, text) when kind in @text_kinds and is_binary(text) do
    String.valid?(text) and not String.contains?(text, <<0>>) and
      length(String.codepoints(text)) <= @max_text_length and
      text |> String.to_charlist() |> Enum.any?(&(&1 not in @text_whitespace))
  end

  def text_fits_kind?(_kind, text), do: text == ""

  @doc "Whether every point lies inside `[0, width] x [0, height]`."
  @spec points_inside?([point()], non_neg_integer(), non_neg_integer()) :: boolean()
  def points_inside?(points, width, height),
    do: Enum.all?(points, fn %{x: x, y: y} -> x in 0..width//1 and y in 0..height//1 end)

  @doc """
  The box around absolute canvas points, each clamped into the canvas first, with the points made
  relative to the box origin.
  """
  @spec around_points([point(), ...]) :: %{box: box(), points: [point()]}
  def around_points(absolute_points) do
    clamped =
      Enum.map(absolute_points, fn %{x: x, y: y} ->
        %{x: clamp(x, 0, @canvas_width), y: clamp(y, 0, @canvas_height)}
      end)

    {min_x, max_x} = clamped |> Enum.map(& &1.x) |> Enum.min_max()
    {min_y, max_y} = clamped |> Enum.map(& &1.y) |> Enum.min_max()

    %{
      box: %{x: min_x, y: min_y, width: max_x - min_x, height: max_y - min_y},
      points: Enum.map(clamped, &%{x: &1.x - min_x, y: &1.y - min_y})
    }
  end

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

  @doc """
  The stored shape of a finished drawing: a box kind's box is clamped into the canvas, while a point
  kind's box is rebuilt around its points, each clamped into the canvas first.
  """
  @spec fit_shape(atom(), box(), [point()]) :: map()
  def fit_shape(kind, %{x: x, y: y}, [_ | _] = points) when is_map_key(@point_counts, kind) do
    %{box: box, points: points} =
      points |> Enum.map(&%{x: x + &1.x, y: y + &1.y}) |> around_points()

    Map.put(box, :points, points)
  end

  def fit_shape(_kind, box, points), do: box |> clamp_box() |> Map.put(:points, points)

  @spec dimensions() :: t()
  def dimensions do
    %{
      canvas_width: @canvas_width,
      canvas_height: @canvas_height,
      default_width: @default_width,
      default_height: @default_height,
      min_size: @min_size,
      max_points: @max_points,
      max_text_length: @max_text_length,
      font_size: @font_size,
      line_height: @line_height,
      text_baseline: @text_baseline
    }
  end
end
