defmodule Sketch.Properties.LwwMergeTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Sketch.Canvas.{BoardState, Geometry}

  @max_runs 500

  defp payload(:create, id), do: element_payload(id, constant(0))

  defp payload(_commit, id), do: element_payload(id, integer(1..12))

  defp element_payload(id, version) do
    bind(tuple({integer(1..400), integer(1..400)}), fn {width, height} ->
      fixed_map(%{
        id: constant(id),
        kind: constant(:rectangle),
        version: version,
        x: integer(0..(Geometry.canvas_width() - width)),
        y: integer(0..(Geometry.canvas_height() - height)),
        width: constant(width),
        height: constant(height)
      })
    end)
  end

  defp events do
    {member_of(~w(a b c d)), member_of([:create, :commit_position, :commit_shape])}
    |> tuple()
    |> list_of(max_length: 20)
    |> bind(fn sources ->
      sources |> Enum.map(fn {id, action} -> payload(action, id) end) |> fixed_list()
    end)
    |> map(&Enum.uniq_by(&1, fn event -> {event.id, event.version} end))
  end

  defp permutation(list) do
    bind(list_of(integer(), length: length(list)), fn keys ->
      list |> Enum.zip(keys) |> Enum.sort_by(&elem(&1, 1)) |> Enum.map(&elem(&1, 0)) |> constant()
    end)
  end

  defp highest_version_per_id(events) do
    events
    |> Enum.group_by(& &1.id)
    |> Map.new(fn {id, same_id} -> {id, Enum.max_by(same_id, & &1.version)} end)
  end

  property "every delivery order of the same events yields the same state" do
    check all events <- events(), shuffled <- permutation(events), max_runs: @max_runs do
      assert BoardState.new(shuffled) == BoardState.new(events)
    end
  end

  property "applying an event twice equals applying it once" do
    check all events <- events(), events != [], event <- member_of(events), max_runs: @max_runs do
      state = BoardState.new(events)

      assert {:unchanged, ^state} = BoardState.apply_event(state, event)
      assert BoardState.new(events ++ events) == state
    end
  end

  property "the state per element is its highest-version event, whichever action produced it" do
    check all events <- events(), max_runs: @max_runs do
      assert BoardState.new(events).elements == highest_version_per_id(events)
    end
  end

  property "an event older than the known version never changes the state" do
    check all events <- events(),
              events != [],
              known <- member_of(events),
              age <- positive_integer(),
              x <- integer(0..(Geometry.canvas_width() - 1)),
              max_runs: @max_runs do
      state = BoardState.new(events)
      known_version = state.elements[known.id].version
      stale = %{known | version: known_version - age, x: x}

      assert {:unchanged, ^state} = BoardState.apply_event(state, stale)
    end
  end

  property "two replicas that saw disjoint halves converge in either merge order" do
    check all events <- events(),
              sides <- list_of(boolean(), length: length(events)),
              max_runs: @max_runs do
      {a, b} = events |> Enum.zip(sides) |> Enum.split_with(&elem(&1, 1))
      a = Enum.map(a, &elem(&1, 0))
      b = Enum.map(b, &elem(&1, 0))

      assert BoardState.new(a ++ b) == BoardState.new(b ++ a)
      assert BoardState.new(a ++ b) == BoardState.new(events)
    end
  end
end
