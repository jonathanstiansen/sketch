defmodule Sketch.Canvas.BoardState do
  @moduledoc """
  A client's view of a board's rectangles, merged by the last-write-wins rule of
  ADR 0001: per rectangle, the event with the highest committed version wins.
  """

  @type event :: %{
          required(:id) => term(),
          required(:version) => integer(),
          optional(atom()) => term()
        }

  @type t :: %__MODULE__{rectangles: %{optional(term()) => event()}}

  defstruct rectangles: %{}

  @spec new([event()]) :: t()
  def new(events) do
    Enum.reduce(events, %__MODULE__{}, fn event, state ->
      state |> apply_event(event) |> merged_state()
    end)
  end

  @spec apply_event(t(), event()) :: {:changed, t(), event()} | {:unchanged, t()}
  def apply_event(
        %__MODULE__{rectangles: rectangles} = state,
        %{id: id, version: version} = event
      ) do
    case rectangles do
      %{^id => %{version: known}} when known >= version ->
        {:unchanged, state}

      _newer_or_unknown ->
        {:changed, %{state | rectangles: Map.put(rectangles, id, event)}, event}
    end
  end

  @spec rectangle_count(t()) :: non_neg_integer()
  def rectangle_count(%__MODULE__{rectangles: rectangles}), do: map_size(rectangles)

  defp merged_state({:changed, state, _event}), do: state
  defp merged_state({:unchanged, state}), do: state
end
