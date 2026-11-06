defmodule Sketch.Canvas.Binding do
  @moduledoc """
  Arrow and line ends bound to shapes (ADR 0016). An end of a kind whose draw gesture is
  `:two_point` may name a target element and an anchor on the target's box, in per mille of its
  width and height. `resolve/2` computes where a bound end is drawn from the target's current box,
  so moving a shape never writes the arrows bound to it. `assets/js/hooks/binding_logic.ts` is the
  client twin, checked against `binding_parity.json` (`mix sketch.gen.render_fixtures`).
  """

  alias Sketch.Canvas.{Geometry, Kinds}

  @anchor_scale 1000
  @ends [:start, :end]
  @kinds for %{id: id, draw_gesture: :two_point} <- Kinds.all(), do: id
  @target_kinds for %{id: id, geometry: :box} <- Kinds.all(), do: id
  @fields Map.new(@ends, fn end_name ->
            {end_name,
             %{
               target: :"#{end_name}_target_id",
               anchor_x: :"#{end_name}_anchor_x",
               anchor_y: :"#{end_name}_anchor_y"
             }}
          end)
  @attributes Enum.flat_map(@ends, &(@fields |> Map.fetch!(&1) |> Map.values() |> Enum.sort()))

  @type end_name :: :start | :end
  @type box :: Geometry.box()
  @type point :: Geometry.point()
  @type anchor :: %{x: 0..1000, y: 0..1000}

  @doc "The largest anchor coordinate: an anchor is in per mille of the target's box."
  @spec anchor_scale() :: pos_integer()
  def anchor_scale, do: @anchor_scale

  @spec ends() :: [end_name()]
  def ends, do: @ends

  @doc "The kinds whose ends may be bound: those drawn from a start to an end point."
  @spec kinds() :: [atom()]
  def kinds, do: @kinds

  @doc "The kinds the client binds an end to: those with box geometry."
  @spec target_kinds() :: [atom()]
  def target_kinds, do: @target_kinds

  @doc "The attributes that store an end's binding: its target id and anchor coordinates."
  @spec fields(end_name()) :: %{target: atom(), anchor_x: atom(), anchor_y: atom()}
  def fields(end_name), do: Map.fetch!(@fields, end_name)

  @doc "Every binding attribute."
  @spec attributes() :: [atom()]
  def attributes, do: @attributes

  @doc "The point an anchor names on a box."
  @spec anchor_point(box(), anchor()) :: point()
  def anchor_point(%{x: x, y: y, width: width, height: height}, %{x: anchor_x, y: anchor_y}) do
    %{x: x + div(width * anchor_x, @anchor_scale), y: y + div(height * anchor_y, @anchor_scale)}
  end

  @doc "The anchor of a point on a box, clamped onto the box."
  @spec anchor_for(point(), box()) :: anchor()
  def anchor_for(%{x: px, y: py}, %{x: x, y: y, width: width, height: height}) do
    %{x: per_mille(px - x, width), y: per_mille(py - y, height)}
  end

  @doc "An end's target id and anchor, or `nil` when it is not bound."
  @spec binding(map(), end_name()) :: %{target: String.t(), anchor: anchor()} | nil
  def binding(element, end_name) do
    %{target: target, anchor_x: anchor_x, anchor_y: anchor_y} = fields(end_name)

    case element do
      %{^target => id, ^anchor_x => ax, ^anchor_y => ay}
      when is_binary(id) and is_integer(ax) and is_integer(ay) ->
        %{target: id, anchor: %{x: ax, y: ay}}

      _unbound ->
        nil
    end
  end

  @doc "The ids an element's ends are bound to."
  @spec targets(map()) :: [String.t()]
  def targets(element) do
    for end_name <- @ends, %{target: id} <- [binding(element, end_name)], do: id
  end

  @doc """
  The element as drawn: each bound end of a two-point element moved onto its target's anchor, and
  the box and points rebuilt around the two ends. `box_of` returns a target's current box or
  `nil` when it is gone, which leaves that end at its stored point.
  """
  @spec resolve(map(), (String.t() -> box() | nil)) :: map()
  def resolve(%{kind: kind, points: [_start, _finish] = points} = element, box_of)
      when kind in @kinds do
    ends =
      @ends
      |> Enum.zip(points)
      |> Enum.map(fn {end_name, point} ->
        stored = %{x: element.x + point.x, y: element.y + point.y}
        end_point(binding(element, end_name), stored, box_of)
      end)

    %{box: box, points: resolved} = Geometry.around_points(ends)
    element |> Map.merge(box) |> Map.put(:points, resolved)
  end

  def resolve(element, _box_of), do: element

  defp end_point(nil, stored, _box_of), do: stored

  defp end_point(%{target: target, anchor: anchor}, stored, box_of) do
    case box_of.(target) do
      %{} = box -> anchor_point(box, anchor)
      nil -> stored
    end
  end

  defp per_mille(_offset, 0), do: 0

  defp per_mille(offset, length),
    do: offset |> Kernel.*(@anchor_scale) |> div(length) |> max(0) |> min(@anchor_scale)
end
