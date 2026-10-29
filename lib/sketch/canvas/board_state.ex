defmodule Sketch.Canvas.BoardState do
  @moduledoc """
  A client's view of a board's elements, merged by the last-write-wins rule of ADR 0001:
  per element, the event with the highest committed version wins, whichever action produced it.
  An erase event (an id without a version) is a tombstone that wins over every event for that id,
  in any delivery order, so an erased element never comes back.
  """

  @type element_event :: %{
          required(:id) => term(),
          required(:version) => integer(),
          optional(atom()) => term()
        }

  @type erase_event :: %{required(:id) => term(), optional(:board_id) => term()}

  @type event :: element_event() | erase_event()

  @type t :: %__MODULE__{
          elements: %{optional(term()) => element_event()},
          erased: MapSet.t(term())
        }

  defstruct elements: %{}, erased: MapSet.new()

  @spec new([event()]) :: t()
  def new(events) do
    Enum.reduce(events, %__MODULE__{}, fn event, state ->
      state |> apply_event(event) |> merged_state()
    end)
  end

  @spec apply_event(t(), event()) ::
          {:changed, t(), element_event()} | {:erased, t(), erase_event()} | {:unchanged, t()}
  def apply_event(%__MODULE__{} = state, %{id: id} = event) do
    if erased?(state, id), do: {:unchanged, state}, else: merge(state, event)
  end

  @spec erased?(t(), term()) :: boolean()
  def erased?(%__MODULE__{erased: erased}, id), do: MapSet.member?(erased, id)

  @spec element_count(t()) :: non_neg_integer()
  def element_count(%__MODULE__{elements: elements}), do: map_size(elements)

  defp merge(%{elements: elements} = state, %{id: id, version: version} = event) do
    case elements do
      %{^id => %{version: known}} when known >= version ->
        {:unchanged, state}

      _newer_or_unknown ->
        {:changed, %{state | elements: Map.put(elements, id, event)}, event}
    end
  end

  defp merge(%{elements: elements, erased: erased} = state, %{id: id} = erase) do
    {:erased, %{state | elements: Map.delete(elements, id), erased: MapSet.put(erased, id)},
     erase}
  end

  defp merged_state({:unchanged, state}), do: state
  defp merged_state({_changed_or_erased, state, _event}), do: state
end
