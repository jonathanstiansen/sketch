defmodule Sketch.Properties.LabelTest do
  use SketchWeb.ConnCase, async: true
  use ExUnitProperties

  import Phoenix.LiveViewTest
  import Sketch.CanvasFixtures, only: [element_attrs: 2]

  alias Sketch.Canvas

  @scale Canvas.binding_anchor_scale()
  @drag_id "11111111-2222-4333-8444-555555555555"

  defp any_offset, do: fixed_map(%{x: integer(-5000..5000), y: integer(-5000..5000)})

  property "a clamped label offset is inside the box, and an offset inside the box is kept" do
    check all(offset <- any_offset(), max_runs: 1000) do
      %{x: x, y: y} = clamped = Canvas.label_clamp(offset)
      assert x in 0..@scale and y in 0..@scale
      assert Canvas.label_clamp(clamped) == clamped
      if offset.x in 0..@scale and offset.y in 0..@scale, do: assert(clamped == offset)
    end
  end

  property "the label point of any clamped offset lies inside the box" do
    check all(
            width <- integer(0..4000),
            height <- integer(0..4000),
            offset <- any_offset(),
            max_runs: 1000
          ) do
      %{x: x, y: y} = Canvas.label_point(width, height, Canvas.label_clamp(offset))
      assert x in 0..width and y in 0..height
    end
  end

  property "a label's text block stays inside the shape whenever it fits, wherever its offset is" do
    check all(
            width <- integer(0..4000),
            height <- integer(0..4000),
            block_width <- integer(0..4000),
            block_height <- integer(0..4000),
            offset <- any_offset(),
            max_runs: 1000
          ) do
      %{x: x, y: y} =
        Canvas.label_placed(width, height, Canvas.label_clamp(offset), block_width, block_height)

      for {at, block, size} <- [{x, block_width, width}, {y, block_height, height}] do
        half = div(block + 1, 2)

        if block < size,
          do: assert(at - half >= 0 and at + half <= size),
          else: assert(at == div(size, 2))
      end
    end
  end

  describe "the label boundary" do
    setup do
      %{board: Canvas.create_board!()}
    end

    property "whatever offset a client sends, the shape stores it clamped into its box", %{
      board: board
    } do
      conn = Phoenix.ConnTest.build_conn()
      {:ok, view, _html} = live(conn, "/b/#{board.id}")

      check all(
              kind <- member_of(Canvas.label_kinds()),
              offset <- any_offset(),
              max_runs: 40
            ) do
        shape = Canvas.create_element!(element_attrs(kind, %{board_id: board.id, text: "hi"}))

        render_hook(view, "commit_shape", %{
          "element_id" => shape.id,
          "drag_id" => @drag_id,
          "x" => shape.x,
          "y" => shape.y,
          "width" => shape.width,
          "height" => shape.height,
          "label" => %{"x" => offset.x, "y" => offset.y}
        })

        stored = board.id |> Canvas.list_elements_for_board!() |> Enum.find(&(&1.id == shape.id))
        assert %{x: stored.label_x, y: stored.label_y} == Canvas.label_clamp(offset)
        assert has_element?(view, "#element-#{shape.id}[data-label-x='#{stored.label_x}']")
      end
    end

    property "only a labelled shape takes a label offset, and never one outside its box", %{
      board: board
    } do
      check all(
              kind <- member_of(Canvas.element_kinds() -- Canvas.label_kinds()),
              labelled <- member_of(Canvas.label_kinds()),
              outside <- one_of([integer(-500..-1), integer((@scale + 1)..5000)]),
              max_runs: 30
            ) do
        assert {:error, _} =
                 Canvas.create_element(element_attrs(kind, %{board_id: board.id, label_x: 0}))

        assert {:error, _} =
                 Canvas.create_element(
                   element_attrs(labelled, %{board_id: board.id, label_y: outside})
                 )

        assert {:ok, _} =
                 Canvas.create_element(
                   element_attrs(labelled, %{board_id: board.id, label_x: 0, label_y: @scale})
                 )
      end
    end
  end
end
