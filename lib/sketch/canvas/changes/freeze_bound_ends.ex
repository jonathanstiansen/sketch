defmodule Sketch.Canvas.Changes.FreezeBoundEnds do
  @moduledoc """
  Before an element is erased, every arrow or line end bound to it is frozen where it is drawn and
  unbound, in the same transaction, so the arrow does not jump back to the point it was drawn
  at (ADR 0016). Each frozen arrow is a `freeze_ends` update with its own notification.
  """
  use Ash.Resource.Change

  alias Sketch.Canvas.{Binding, Element}

  @impl true
  def change(changeset, _opts, _context) do
    Ash.Changeset.before_action(changeset, fn changeset ->
      erased = changeset.data
      notifications = Enum.flat_map(bound_to(erased), &freeze(&1, erased))
      {changeset, %{notifications: notifications}}
    end)
  end

  defp bound_to(erased) do
    Element
    |> Ash.Query.for_read(:bound_to, %{board_id: erased.board_id, target_id: erased.id})
    |> Ash.read!()
  end

  defp freeze(arrow, erased) do
    boxes = arrow |> Binding.targets() |> Map.new(&{&1, box_of(&1, erased)})
    resolved = Binding.resolve(arrow, &Map.get(boxes, &1))

    erased_id = erased.id

    unbound =
      for end_name <- Binding.ends(),
          match?(%{target: ^erased_id}, Binding.binding(arrow, end_name)),
          field <- end_name |> Binding.fields() |> Map.values(),
          into: %{},
          do: {field, nil}

    params =
      resolved
      |> Map.take([:x, :y, :width, :height])
      |> Map.put(:points, Enum.map(resolved.points, &Map.take(&1, [:x, :y])))
      |> Map.merge(unbound)

    {_arrow, notifications} =
      arrow
      |> Ash.Changeset.for_update(:freeze_ends, params)
      |> Ash.update!(return_notifications?: true)

    notifications
  end

  defp box_of(id, %{id: id} = erased), do: Map.take(erased, [:x, :y, :width, :height])

  defp box_of(id, _erased) do
    case Ash.get(Element, id) do
      {:ok, target} -> Map.take(target, [:x, :y, :width, :height])
      {:error, _missing} -> nil
    end
  end
end
