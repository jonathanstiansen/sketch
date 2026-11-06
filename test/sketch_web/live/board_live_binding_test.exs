defmodule SketchWeb.BoardLiveBindingTest do
  use SketchWeb.ConnCase
  use ExUnitProperties

  import Phoenix.LiveViewTest
  import Sketch.CanvasFixtures, only: [element_attrs: 2]

  alias Sketch.Canvas

  @drag_id "11111111-2222-4333-8444-555555555555"
  @arrow_kind Canvas.binding_kinds() |> hd() |> Atom.to_string()

  setup %{conn: conn} do
    board = Canvas.create_board!()

    target =
      Canvas.create_element!(element_attrs(:rectangle, %{board_id: board.id, x: 400, y: 400}))

    {:ok, actor, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
    %{board: board, target: target, actor: actor, watcher: watcher}
  end

  defp arrow_params(bindings) do
    Map.merge(
      %{
        "kind" => @arrow_kind,
        "drag_id" => @drag_id,
        "x" => 100,
        "y" => 100,
        "width" => 300,
        "height" => 300,
        "points" => [%{"x" => 0, "y" => 0}, %{"x" => 300, "y" => 300}]
      },
      bindings
    )
  end

  defp binding(target_id, x, y), do: %{"target_id" => target_id, "anchor_x" => x, "anchor_y" => y}

  defp arrow(board),
    do:
      board.id
      |> Canvas.list_elements_for_board!()
      |> Enum.find(&(&1.kind == String.to_existing_atom(@arrow_kind)))

  defp drawn_selector(arrow, x, y),
    do: "#element-#{arrow.id}[data-x='#{x}'][data-y='#{y}']"

  test "an arrow end binds to a shape and is drawn on the shape's anchor in every view", ctx do
    render_hook(
      ctx.actor,
      "create_element",
      arrow_params(%{"end_binding" => binding(ctx.target.id, 500, 500)})
    )

    arrow = arrow(ctx.board)
    assert arrow.end_target_id == ctx.target.id
    end_point = Canvas.binding_anchor_for(%{x: 460, y: 440}, ctx.target)
    assert end_point == %{x: 500, y: 500}

    for view <- [ctx.actor, ctx.watcher] do
      assert has_element?(
               view,
               "#element-#{arrow.id}[data-end-target='#{ctx.target.id}'][data-end-anchor='500,500']"
             )

      assert has_element?(
               view,
               drawn_selector(arrow, 100, 100) <> "[data-width='360'][data-height='340']"
             )
    end
  end

  test "moving the target redraws the arrow in every view without writing the arrow", ctx do
    render_hook(
      ctx.actor,
      "create_element",
      arrow_params(%{"end_binding" => binding(ctx.target.id, 500, 500)})
    )

    arrow = arrow(ctx.board)

    render_hook(ctx.actor, "commit", %{
      "element_id" => ctx.target.id,
      "drag_id" => @drag_id,
      "x" => 1000,
      "y" => 900
    })

    for view <- [ctx.actor, ctx.watcher] do
      assert has_element?(
               view,
               drawn_selector(arrow, 100, 100) <> "[data-width='960'][data-height='840']"
             )
    end

    assert arrow(ctx.board).version == arrow.version
  end

  test "a binding to an element that is gone or not a shape is dropped, and the arrow is created unbound",
       ctx do
    line =
      Canvas.create_element!(
        element_attrs(String.to_existing_atom(@arrow_kind), %{board_id: ctx.board.id})
      )

    for target_id <- [Ecto.UUID.generate(), line.id] do
      render_hook(
        ctx.actor,
        "create_element",
        arrow_params(%{"start_binding" => binding(target_id, 0, 0)})
      )
    end

    unbound =
      ctx.board.id
      |> Canvas.list_elements_for_board!()
      |> Enum.reject(&(&1.id in [line.id, ctx.target.id]))

    assert length(unbound) == 2
    assert Enum.all?(unbound, &is_nil(&1.start_target_id))
  end

  property "a malformed binding creates nothing", ctx do
    check all(
            malformed <-
              one_of([
                constant(%{"target_id" => "not-a-uuid", "anchor_x" => 0, "anchor_y" => 0}),
                map(integer(1001..5000), &binding(ctx.target.id, &1, 0)),
                map(integer(-5000..-1), &binding(ctx.target.id, 0, &1)),
                constant(%{"target_id" => ctx.target.id}),
                constant("start")
              ]),
            end_name <- member_of(["start_binding", "end_binding"]),
            max_runs: 25
          ) do
      before = length(Canvas.list_elements_for_board!(ctx.board.id))
      render_hook(ctx.actor, "create_element", arrow_params(%{end_name => malformed}))
      assert length(Canvas.list_elements_for_board!(ctx.board.id)) == before
    end
  end

  test "erasing the target leaves the arrow where it was drawn, unbound, in every view", ctx do
    render_hook(
      ctx.actor,
      "create_element",
      arrow_params(%{"end_binding" => binding(ctx.target.id, 500, 500)})
    )

    arrow = arrow(ctx.board)

    render_hook(ctx.actor, "commit", %{
      "element_id" => ctx.target.id,
      "drag_id" => @drag_id,
      "x" => 1000,
      "y" => 900
    })

    render_hook(ctx.actor, "erase", %{"element_ids" => [ctx.target.id]})

    frozen = arrow(ctx.board)
    assert is_nil(frozen.end_target_id)
    assert {frozen.x, frozen.y, frozen.width, frozen.height} == {100, 100, 960, 840}

    for view <- [ctx.actor, ctx.watcher] do
      refute has_element?(view, "#element-#{arrow.id}[data-end-target]")

      assert has_element?(
               view,
               drawn_selector(arrow, 100, 100) <> "[data-width='960'][data-height='840']"
             )
    end
  end

  test "commit_shape binds and unbinds an end in every view", ctx do
    render_hook(ctx.actor, "create_element", arrow_params(%{}))
    arrow = arrow(ctx.board)

    shape = %{
      "element_id" => arrow.id,
      "drag_id" => @drag_id,
      "x" => 100,
      "y" => 100,
      "width" => 300,
      "height" => 300,
      "points" => [%{"x" => 0, "y" => 0}, %{"x" => 300, "y" => 300}]
    }

    render_hook(
      ctx.actor,
      "commit_shape",
      Map.put(shape, "start_binding", binding(ctx.target.id, 0, 0))
    )

    assert arrow(ctx.board).start_target_id == ctx.target.id

    render_hook(ctx.actor, "commit_shape", Map.put(shape, "start_binding", nil))
    assert is_nil(arrow(ctx.board).start_target_id)
    refute has_element?(ctx.watcher, "#element-#{arrow.id}[data-start-target]")
  end
end
