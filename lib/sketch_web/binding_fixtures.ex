defmodule SketchWeb.BindingFixtures do
  @moduledoc """
  Renders `assets/test/fixtures/binding_parity.json` (ADR 0016): `Sketch.Canvas.Binding.resolve/2`
  for arrows with either, both or no ends bound, to targets that exist or are gone, in boxes from
  zero-sized to the full canvas, and `Sketch.Canvas.Binding.anchor_for/2` for points on, inside
  and outside a box. The cases come from a fixed random seed plus the edges, so the file only
  changes when the rule does. `assets/test/binding_parity.test.ts` expects the client twin to
  return the same. `mix sketch.gen.render_fixtures` writes it with the other parity fixtures.
  """

  @path "assets/test/fixtures/binding_parity.json"
  @random_cases 300
  @scale Sketch.Canvas.binding_anchor_scale()
  @canvas Sketch.Canvas.geometry().canvas_width
  @edge_boxes [
    %{x: 0, y: 0, width: 0, height: 0},
    %{x: 0, y: 0, width: 1, height: 1},
    %{x: 0, y: 0, width: @canvas, height: @canvas},
    %{x: @canvas, y: @canvas, width: 0, height: 0},
    %{x: 123, y: 456, width: 999, height: 1001}
  ]
  @edge_anchors [%{x: 0, y: 0}, %{x: @scale, y: @scale}, %{x: 1, y: 999}, %{x: 500, y: 500}]

  @spec path() :: Path.t()
  def path, do: @path

  @spec render() :: String.t()
  def render do
    state = :rand.seed_s(:exsss, {16, 0, 2026})

    {random, _state} =
      Enum.map_reduce(1..@random_cases, state, fn _index, state -> random_case(state) end)

    edges = for box <- @edge_boxes, anchor <- @edge_anchors, do: edge_case(box, anchor)

    resolve = Enum.map_join(edges ++ random, ",\n", &"    #{JSON.encode!(&1)}")
    anchors = Enum.map_join(anchor_cases(), ",\n", &"    #{JSON.encode!(&1)}")
    "{\n  \"resolve\": [\n#{resolve}\n  ],\n  \"anchor_for\": [\n#{anchors}\n  ]\n}\n"
  end

  defp random_case(state) do
    {[start_x, start_y, end_x, end_y], state} = integers(state, 4, 0..@canvas)
    {[bound_start, bound_end, gone], state} = integers(state, 3, 0..2)
    {[ax1, ay1, ax2, ay2], state} = integers(state, 4, 0..@scale)
    {target_a, state} = random_box(state)
    {target_b, state} = random_box(state)

    {kind, state} = pick(state, Sketch.Canvas.binding_kinds())

    arrow =
      kind
      |> Sketch.Canvas.fit_shape(%{x: 0, y: 0, width: 0, height: 0}, [
        %{x: start_x, y: start_y},
        %{x: end_x, y: end_y}
      ])
      |> Map.put(:kind, kind)
      |> bind(:start, bound_start > 0 && "a", %{x: ax1, y: ay1})
      |> bind(:end, bound_end > 0 && "b", %{x: ax2, y: ay2})

    targets = %{"a" => target_a, "b" => if(gone == 0, do: nil, else: target_b)}
    {fixture_case(arrow, targets), state}
  end

  defp edge_case(box, anchor) do
    arrow =
      %{
        kind: List.last(Sketch.Canvas.binding_kinds()),
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        points: [%{x: 0, y: 40}, %{x: 30, y: 0}]
      }
      |> bind(:start, "a", anchor)

    fixture_case(arrow, %{"a" => box, "b" => nil})
  end

  defp anchor_cases do
    points = [
      %{x: 0, y: 0},
      %{x: 61, y: 62},
      %{x: 4000, y: 4000},
      %{x: 500, y: 300},
      %{x: 1122, y: 1457}
    ]

    for box <- @edge_boxes, point <- points do
      %{"box" => box, "point" => point, "anchor" => Sketch.Canvas.binding_anchor_for(point, box)}
    end
  end

  defp fixture_case(arrow, targets) do
    resolved = Sketch.Canvas.resolve_binding(arrow, &Map.get(targets, &1))

    %{
      "arrow" => wire(arrow),
      "targets" => targets,
      "resolved" => Map.take(resolved, [:x, :y, :width, :height, :points])
    }
  end

  defp wire(arrow) do
    arrow
    |> Map.update!(:kind, &Atom.to_string/1)
    |> Map.new(fn {key, value} -> {Atom.to_string(key), value} end)
  end

  defp bind(arrow, _end_name, false, _anchor), do: arrow

  defp bind(arrow, end_name, target, %{x: ax, y: ay}) do
    %{target: target_field, anchor_x: anchor_x, anchor_y: anchor_y} =
      Sketch.Canvas.binding_fields(end_name)

    Map.merge(arrow, %{target_field => target, anchor_x => ax, anchor_y => ay})
  end

  defp pick(state, values) do
    {index, state} = :rand.uniform_s(length(values), state)
    {Enum.at(values, index - 1), state}
  end

  defp random_box(state) do
    {[width, height], state} = integers(state, 2, 0..800)
    {[x, y], state} = integers(state, 2, 0..(@canvas - 800))
    {%{x: x, y: y, width: width, height: height}, state}
  end

  defp integers(state, count, first..last//1) do
    Enum.map_reduce(1..count, state, fn _index, state ->
      {value, state} = :rand.uniform_s(last - first + 1, state)
      {first + value - 1, state}
    end)
  end
end
