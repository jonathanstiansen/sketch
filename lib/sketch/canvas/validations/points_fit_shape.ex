defmodule Sketch.Canvas.Validations.PointsFitShape do
  @moduledoc """
  Validates an element's points: as many as `Geometry.point_count/1` allows for its kind, each inside
  `[0, width] x [0, height]`. An update that changes the size must also set the points, while the kind
  and size may come from the stored row.
  """
  use Ash.Resource.Validation

  import Ash.Expr

  alias Ash.Error.Changes.InvalidAttribute
  alias Sketch.Canvas.Geometry

  @count_message "has the wrong number of points for its kind"
  @inside_message "must lie inside the element's box"

  @impl true
  def init(opts) do
    if is_list(opts[:kinds]),
      do: {:ok, opts},
      else: {:error, "kinds must be the list of element kinds"}
  end

  @impl true
  def validate(changeset, _opts, _context) do
    kind = Ash.Changeset.get_attribute(changeset, :kind)
    points = Ash.Changeset.get_attribute(changeset, :points)
    width = Ash.Changeset.get_attribute(changeset, :width)
    height = Ash.Changeset.get_attribute(changeset, :height)

    cond do
      not (is_atom(kind) and is_list(points) and is_integer(width) and is_integer(height)) ->
        :ok

      length(points) not in Geometry.point_count(kind) ->
        {:error, error(points, @count_message)}

      not Geometry.points_inside?(points, width, height) ->
        {:error, error(points, @inside_message)}

      true ->
        :ok
    end
  end

  @impl true
  def atomic(changeset, opts, _context) do
    case literal_points(changeset) do
      {:ok, points} ->
        count = length(points)
        allowed_kinds = Enum.filter(opts[:kinds], &(count in Geometry.point_count(&1)))

        [
          {:atomic, [:kind, :points], expr(^atomic_ref(:kind) not in ^allowed_kinds),
           atomic_error(@count_message)},
          {:atomic, [:width, :height, :points],
           expr(
             ^atomic_ref(:width) < ^extent(points, :x) or
               ^atomic_ref(:height) < ^extent(points, :y)
           ), atomic_error(@inside_message)}
        ]

      :unchanged ->
        if Enum.any?([:width, :height], &Ash.Changeset.changing_attribute?(changeset, &1)),
          do: {:error, error(nil, "must be committed with the box")},
          else: :ok

      :expression ->
        {:not_atomic, "points must be literal values"}
    end
  end

  @impl true
  def describe(_opts), do: [message: @inside_message, vars: []]

  defp literal_points(changeset) do
    case Keyword.fetch(changeset.atomics, :points) do
      {:ok, points} when is_list(points) -> {:ok, points}
      {:ok, _expression} -> :expression
      :error -> changeset.attributes |> Map.fetch(:points) |> unchanged_if_missing()
    end
  end

  defp unchanged_if_missing({:ok, points}), do: {:ok, points}
  defp unchanged_if_missing(:error), do: :unchanged

  defp extent(points, axis),
    do: points |> Enum.map(&Map.fetch!(&1, axis)) |> Enum.max(fn -> 0 end)

  defp error(points, message),
    do: InvalidAttribute.exception(field: :points, value: points, message: message)

  defp atomic_error(message) do
    expr(error(^InvalidAttribute, %{field: :points, message: ^message}))
  end
end
