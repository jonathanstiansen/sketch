defmodule Sketch.Canvas.Validations.FitsCanvas do
  @moduledoc """
  Validates `position + size <= limit` for one axis of an element's box, also inside atomic updates,
  where the unchanged side of the sum is the stored value.
  """
  use Ash.Resource.Validation

  import Ash.Expr

  alias Ash.Error.Changes.InvalidAttribute

  @impl true
  def init(opts) do
    if is_atom(opts[:position]) and is_atom(opts[:size]) and is_integer(opts[:limit]),
      do: {:ok, opts},
      else: {:error, "position and size must be attributes and limit an integer"}
  end

  @impl true
  def validate(changeset, opts, _context) do
    position = Ash.Changeset.get_attribute(changeset, opts[:position])
    size = Ash.Changeset.get_attribute(changeset, opts[:size])

    if is_integer(position) and is_integer(size) and position + size > opts[:limit],
      do: {:error, error(opts, position)},
      else: :ok
  end

  @impl true
  def atomic(_changeset, opts, _context) do
    position = opts[:position]
    size = opts[:size]

    {:atomic, [position, size], expr(^atomic_ref(position) + ^atomic_ref(size) > ^opts[:limit]),
     expr(
       error(^InvalidAttribute, %{
         field: ^position,
         value: ^atomic_ref(position),
         message: ^message(opts)
       })
     )}
  end

  @impl true
  def describe(opts), do: [message: message(opts), vars: []]

  defp error(opts, value),
    do: InvalidAttribute.exception(field: opts[:position], value: value, message: message(opts))

  defp message(opts), do: "#{opts[:position]} + #{opts[:size]} must be at most #{opts[:limit]}"
end
