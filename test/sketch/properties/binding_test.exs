defmodule Sketch.Properties.BindingTest do
  use Sketch.DataCase, async: true
  use ExUnitProperties

  import Sketch.CanvasFixtures, only: [element_attrs: 2]

  alias Sketch.Canvas
  alias Sketch.Canvas.Binding

  @scale Binding.anchor_scale()
  @box_fields [:x, :y, :width, :height]

  defp box do
    gen all(
          width <- integer(0..600),
          height <- integer(0..600),
          x <- integer(0..(Canvas.geometry().canvas_width - width)),
          y <- integer(0..(Canvas.geometry().canvas_height - height))
        ) do
      %{x: x, y: y, width: width, height: height}
    end
  end

  defp anchor, do: fixed_map(%{x: integer(0..@scale), y: integer(0..@scale)})

  defp point_in(%{x: x, y: y, width: width, height: height}),
    do: fixed_map(%{x: integer(x..(x + width)), y: integer(y..(y + height))})

  defp arrow_kind, do: member_of(Binding.kinds())

  defp target_kind, do: member_of(Binding.target_kinds())

  defp absolute_ends(%{x: x, y: y, points: points}),
    do: Enum.map(points, &%{x: x + &1.x, y: y + &1.y})

  defp bound(attrs, end_name, target_id, %{x: ax, y: ay}) do
    %{target: target, anchor_x: anchor_x, anchor_y: anchor_y} = Binding.fields(end_name)
    Map.merge(attrs, %{target => target_id, anchor_x => ax, anchor_y => ay})
  end

  defp box_of(elements),
    do: &(elements |> Map.get(&1) |> then(fn e -> e && Map.take(e, @box_fields) end))

  describe "resolution (ADR 0016)" do
    property "a bound end is drawn at its anchor on the target, an unbound end where it was stored" do
      check all(
              start_target <- one_of([constant(nil), box()]),
              end_target <- one_of([constant(nil), box()]),
              start_anchor <- anchor(),
              end_anchor <- anchor(),
              stored <- box(),
              kind <- arrow_kind(),
              max_runs: 500
            ) do
        arrow = %{
          kind: kind,
          x: stored.x,
          y: stored.y,
          width: stored.width,
          height: stored.height,
          points: [%{x: 0, y: 0}, %{x: stored.width, y: stored.height}]
        }

        targets = %{"start" => start_target, "end" => end_target}

        arrow =
          for {end_name, anchor} <- [start: start_anchor, end: end_anchor],
              targets[Atom.to_string(end_name)] != nil,
              reduce: arrow do
            acc -> bound(acc, end_name, Atom.to_string(end_name), anchor)
          end

        resolved = Binding.resolve(arrow, &Map.get(targets, &1))
        [start, finish] = absolute_ends(resolved)
        [stored_start, stored_finish] = absolute_ends(arrow)

        assert start ==
                 if(start_target,
                   do: Binding.anchor_point(start_target, start_anchor),
                   else: stored_start
                 )

        assert finish ==
                 if(end_target,
                   do: Binding.anchor_point(end_target, end_anchor),
                   else: stored_finish
                 )

        assert Enum.all?(
                 resolved.points,
                 &(&1.x in 0..resolved.width and &1.y in 0..resolved.height)
               )

        assert Binding.resolve(resolved, &Map.get(targets, &1)) == resolved
      end
    end

    property "an anchor taken at a point on a box names that point to within one per mille step" do
      check all(target <- box(), point <- bind(constant(target), &point_in/1), max_runs: 500) do
        %{x: x, y: y} = Binding.anchor_point(target, Binding.anchor_for(point, target))
        assert abs(x - point.x) <= div(target.width, @scale) + 1
        assert abs(y - point.y) <= div(target.height, @scale) + 1
      end
    end

    property "an anchor taken anywhere is clamped onto the box" do
      check all(target <- box(), x <- integer(-500..4500), y <- integer(-500..4500)) do
        %{x: ax, y: ay} = Binding.anchor_for(%{x: x, y: y}, target)
        assert ax in 0..@scale and ay in 0..@scale
      end
    end
  end

  describe "the database keeps bindings on the board and on line and arrow ends (ADR 0016)" do
    setup do
      %{board: Canvas.create_board!(), other: Canvas.create_board!()}
    end

    property "an arrow end binds to any element on its own board", %{board: board} do
      check all(
              kind <- arrow_kind(),
              target <- target_kind(),
              end_name <- member_of(Binding.ends()),
              anchor <- anchor(),
              max_runs: 40
            ) do
        shape = Canvas.create_element!(element_attrs(target, %{board_id: board.id}))

        attrs = element_attrs(kind, %{board_id: board.id}) |> bound(end_name, shape.id, anchor)
        arrow = Canvas.create_element!(attrs)

        assert Binding.binding(arrow, end_name) == %{target: shape.id, anchor: anchor}
      end
    end

    property "a binding to another board, from a kind without ends, without an anchor or to itself is refused",
             %{board: board, other: other} do
      check all(
              kind <- arrow_kind(),
              unbindable <- member_of(Canvas.element_kinds() -- Binding.kinds()),
              end_name <- member_of(Binding.ends()),
              anchor <- anchor(),
              max_runs: 30
            ) do
        elsewhere = Canvas.create_element!(element_attrs(:rectangle, %{board_id: other.id}))
        here = Canvas.create_element!(element_attrs(:rectangle, %{board_id: board.id}))
        %{target: target, anchor_x: anchor_x} = Binding.fields(end_name)

        assert {:error, _} =
                 Canvas.create_element(
                   element_attrs(kind, %{board_id: board.id})
                   |> bound(end_name, elsewhere.id, anchor)
                 )

        assert {:error, _} =
                 Canvas.create_element(
                   element_attrs(unbindable, %{board_id: board.id})
                   |> bound(end_name, here.id, anchor)
                 )

        assert {:error, _} =
                 Canvas.create_element(
                   element_attrs(kind, %{board_id: board.id})
                   |> bound(end_name, here.id, anchor)
                   |> Map.put(anchor_x, nil)
                 )

        arrow = Canvas.create_element!(element_attrs(kind, %{board_id: board.id}))

        assert {:error, _} =
                 Canvas.commit_shape(arrow.id, board.id, %{
                   :x => arrow.x,
                   :y => arrow.y,
                   :width => arrow.width,
                   :height => arrow.height,
                   target => arrow.id,
                   anchor_x => anchor.x,
                   Binding.fields(end_name).anchor_y => anchor.y
                 })
      end
    end
  end

  describe "erasing a target freezes the ends bound to it (ADR 0016)" do
    setup do
      %{board: Canvas.create_board!()}
    end

    property "after any moves, an erased target leaves its arrow drawn where it was, unbound at that end",
             %{board: board} do
      check all(
              kind <- arrow_kind(),
              start_anchor <- anchor(),
              end_anchor <- anchor(),
              moves <- list_of(tuple({member_of([:first, :second]), box()}), max_length: 5),
              erased <- member_of([:first, :second]),
              max_runs: 40
            ) do
        first = Canvas.create_element!(element_attrs(:rectangle, %{board_id: board.id}))
        second = Canvas.create_element!(element_attrs(:ellipse, %{board_id: board.id}))
        targets = %{first: first, second: second}

        arrow =
          element_attrs(kind, %{board_id: board.id})
          |> bound(:start, first.id, start_anchor)
          |> bound(:end, second.id, end_anchor)
          |> Canvas.create_element!()

        for {which, %{x: x, y: y}} <- moves do
          target = Map.fetch!(targets, which)
          width = Canvas.geometry().canvas_width - target.width
          height = Canvas.geometry().canvas_height - target.height
          Canvas.commit_position!(target.id, board.id, %{x: min(x, width), y: min(y, height)})
        end

        elements = board.id |> Canvas.list_elements_for_board!() |> Map.new(&{&1.id, &1})
        drawn = Binding.resolve(Map.fetch!(elements, arrow.id), box_of(elements))
        erased_id = Map.fetch!(targets, erased).id

        Canvas.erase_element!(erased_id, board.id)

        frozen =
          board.id |> Canvas.list_elements_for_board!() |> Enum.find(&(&1.id == arrow.id))

        assert absolute_ends(frozen) == absolute_ends(drawn)
        assert erased_id not in Binding.targets(frozen)
        assert length(Binding.targets(frozen)) == 1
        assert frozen.version == arrow.version + 1

        remaining = board.id |> Canvas.list_elements_for_board!() |> Map.new(&{&1.id, &1})
        assert absolute_ends(Binding.resolve(frozen, box_of(remaining))) == absolute_ends(drawn)

        Canvas.erase_element!(arrow.id, board.id)

        Canvas.erase_element!(
          Map.fetch!(targets, Enum.find([:first, :second], &(&1 != erased))).id,
          board.id
        )
      end
    end
  end
end
