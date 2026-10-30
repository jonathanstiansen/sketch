defmodule Sketch.Properties.LwwMergeTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Sketch.Canvas.{BoardState, Geometry}

  @max_runs 500

  defp payload(:create, id), do: element_payload(id, constant(0))

  defp payload(:erase, id), do: constant(%{id: id, board_id: "board"})

  defp payload(_commit, id), do: element_payload(id, integer(1..12))

  defp element_payload(id, version) do
    bind(tuple({integer(0..400), integer(0..400)}), fn {width, height} ->
      point = fixed_map(%{x: integer(0..width), y: integer(0..height)})

      fixed_map(%{
        id: constant(id),
        kind: Sketch.CanvasFixtures.element_kind(),
        version: version,
        x: integer(0..(Geometry.canvas_width() - width)),
        y: integer(0..(Geometry.canvas_height() - height)),
        width: constant(width),
        height: constant(height),
        points: list_of(point, max_length: Geometry.max_points()),
        text: string(:utf8, max_length: 40)
      })
    end)
  end

  defp events do
    {member_of(~w(a b c d)), action()}
    |> tuple()
    |> list_of(max_length: 20)
    |> bind(fn sources ->
      sources |> Enum.map(fn {id, action} -> payload(action, id) end) |> fixed_list()
    end)
    |> map(&Enum.uniq_by(&1, fn event -> {event.id, Map.get(event, :version, :erase)} end))
  end

  defp action,
    do:
      frequency([
        {6, member_of([:create, :commit_position, :commit_shape])},
        {1, constant(:erase)}
      ])

  defp erase?(event), do: not Map.has_key?(event, :version)

  defp erased_ids(events),
    do: for(event <- events, erase?(event), into: MapSet.new(), do: event.id)

  defp permutation(list) do
    bind(list_of(integer(), length: length(list)), fn keys ->
      list |> Enum.zip(keys) |> Enum.sort_by(&elem(&1, 1)) |> Enum.map(&elem(&1, 0)) |> constant()
    end)
  end

  defp highest_version_per_id(events) do
    erased = erased_ids(events)

    events
    |> Enum.reject(&(&1.id in erased))
    |> Enum.group_by(& &1.id)
    |> Map.new(fn {id, same_id} -> {id, Enum.max_by(same_id, & &1.version)} end)
  end

  property "every delivery order of the same events, erases included, yields the same state" do
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

  property "the state per element is its highest-version event, whichever action produced it, unless it was erased" do
    check all events <- events(), max_runs: @max_runs do
      assert BoardState.new(events).elements == highest_version_per_id(events)
    end
  end

  property "every erased id is absent and remembered in every delivery order" do
    check all events <- events(), shuffled <- permutation(events), max_runs: @max_runs do
      state = BoardState.new(shuffled)
      erased = erased_ids(events)

      assert state.erased == erased
      assert Enum.all?(erased, &(not Map.has_key?(state.elements, &1)))
    end
  end

  property "a create or commit delivered after an erase never resurrects the element" do
    check all events <- events(),
              id <- member_of(~w(a b c d)),
              late <-
                list_of(
                  bind(member_of([:create, :commit_position, :commit_shape]), &payload(&1, id)),
                  max_length: 5
                ),
              max_runs: @max_runs do
      erased = BoardState.new(events ++ [%{id: id, board_id: "board"}])

      assert Enum.reduce(late, erased, fn event, state ->
               assert {:unchanged, ^state} = BoardState.apply_event(state, event)
               state
             end) == erased

      refute Map.has_key?(BoardState.new(events ++ [%{id: id}] ++ late).elements, id)
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
      stale = Map.merge(known, %{version: known_version(state, known) - age, x: x})

      assert {:unchanged, ^state} = BoardState.apply_event(state, stale)
    end
  end

  defp known_version(state, %{id: id}) do
    case state.elements do
      %{^id => %{version: version}} -> version
      _erased -> 0
    end
  end

  property "two replicas that saw disjoint halves converge in either merge order, erases included" do
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

  property "an undone erase is a new element: under a new id it appears in every delivery order, under the erased id it never does (ADR 0008)" do
    check all events <- events(),
              id <- member_of(~w(a b c d)),
              recreated <- payload(:create, "#{id}-recreated"),
              reused <- payload(:create, id),
              shuffled <- permutation(events ++ [%{id: id, board_id: "board"}, recreated]),
              max_runs: @max_runs do
      erase = %{id: id, board_id: "board"}
      in_order = BoardState.new(events ++ [erase, recreated])

      assert BoardState.new(shuffled) == in_order
      assert Map.fetch!(in_order.elements, recreated.id) == recreated
      refute Map.has_key?(in_order.elements, id)

      assert {:unchanged, ^in_order} = BoardState.apply_event(in_order, reused)
    end
  end
end
