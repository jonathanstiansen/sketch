defmodule Sketch.Canvas.BoardState do
  @moduledoc """
  A client's view of a board's elements, merged by the last-write-wins rule of ADR 0001:
  per element, the event with the highest committed version wins, whichever action produced it.
  """

  @type event :: %{
          required(:id) => term(),
          required(:version) => integer(),
          optional(atom()) => term()
        }

  @type t :: %__MODULE__{elements: %{optional(term()) => event()}}

  defstruct elements: %{}

  @spec new([event()]) :: t()
  def new(events) do
    Enum.reduce(events, %__MODULE__{}, fn event, state ->
      state |> apply_event(event) |> merged_state()
    end)
  end

  @spec apply_event(t(), event()) :: {:changed, t(), event()} | {:unchanged, t()}
  def apply_event(%__MODULE__{elements: elements} = state, %{id: id, version: version} = event) do
    case elements do
      %{^id => %{version: known}} when known >= version ->
        {:unchanged, state}

      _newer_or_unknown ->
        {:changed, %{state | elements: Map.put(elements, id, event)}, event}
    end
  end

  @spec element_count(t()) :: non_neg_integer()
  def element_count(%__MODULE__{elements: elements}), do: map_size(elements)

  defp merged_state({:changed, state, _event}), do: state
  defp merged_state({:unchanged, state}), do: state
end
