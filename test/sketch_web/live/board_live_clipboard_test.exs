defmodule SketchWeb.BoardLiveClipboardTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest

  alias Sketch.Canvas

  @drag_id "11111111-2222-4333-8444-555555555555"

  setup %{conn: conn} do
    board = Canvas.create_board!()
    {:ok, actor, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
    %{board: board, actor: actor, watcher: watcher}
  end

  defp stored(board), do: Canvas.list_elements_for_board!(board.id)

  defp pasted(overrides) do
    Map.merge(
      %{
        "kind" => "arrow",
        "drag_id" => @drag_id,
        "x" => 110,
        "y" => 120,
        "width" => 80,
        "height" => 40,
        "points" => [%{"x" => 0, "y" => 0}, %{"x" => 80, "y" => 40}],
        "text" => "",
        "stroke_color" => "red",
        "stroke_width" => "bold",
        "stroke_style" => "dashed",
        "seed" => 123_456
      },
      overrides
    )
  end

  test "a duplicate goes through create_element and keeps kind, points, style and seed", ctx do
    original =
      Canvas.create_element!(%{
        board_id: ctx.board.id,
        kind: :arrow,
        x: 100,
        y: 110,
        width: 80,
        height: 40,
        points: [%{x: 0, y: 0}, %{x: 80, y: 40}],
        stroke_color: :red,
        stroke_width: :bold,
        stroke_style: :dashed,
        seed: 123_456
      })

    render_hook(ctx.actor, "create_element", pasted(%{}))

    assert_reply(ctx.actor, %{element: %{id: copy_id}})
    assert [%{id: original_id}, copy] = Enum.sort_by(stored(ctx.board), & &1.x)
    assert original_id == original.id
    assert copy.id == copy_id
    assert {copy.x, copy.y} == {original.x + 10, original.y + 10}

    for field <- [:kind, :width, :height, :points, :text, :seed] ++ Canvas.style_properties() do
      assert Map.fetch!(copy, field) == Map.fetch!(original, field), "#{field} differs"
    end

    assert has_element?(ctx.watcher, "#element-#{copy.id}[data-x='110'][data-seed='123456']")
  end

  test "a pasted box kind beyond the canvas edge is clamped into the canvas by the server", ctx do
    render_hook(
      ctx.actor,
      "create_element",
      pasted(%{
        "kind" => "rectangle",
        "x" => 3990,
        "y" => 3995,
        "width" => 120,
        "height" => 80,
        "points" => []
      })
    )

    assert [%{x: 3880, y: 3920, width: 120, height: 80}] = stored(ctx.board)
  end

  test "a pasted point kind beyond the canvas edge has its box rebuilt inside the canvas", ctx do
    render_hook(ctx.actor, "create_element", pasted(%{"x" => 3990, "y" => 3990}))

    assert [%{x: x, y: y, width: width, height: height}] = stored(ctx.board)
    assert x + width <= 4000 and y + height <= 4000
  end

  test "Ash rejects a create outside the canvas, so no path stores one", ctx do
    for {x, y} <- [{3990, 0}, {0, 3990}, {-1, 0}, {0, -1}] do
      assert {:error, _error} =
               Canvas.create_element(%{
                 board_id: ctx.board.id,
                 kind: :rectangle,
                 x: x,
                 y: y,
                 width: 120,
                 height: 80
               })
    end

    assert stored(ctx.board) == []
  end

  test "malformed pasted elements create nothing", ctx do
    malformed = [
      %{"kind" => "bogus"},
      %{"kind" => "rectangle", "points" => []} |> Map.put("stroke_color", "magenta"),
      %{"seed" => -1},
      %{"seed" => 2_147_483_648},
      %{"kind" => "rectangle", "points" => [], "text" => "not on a rectangle"},
      %{"points" => [%{"x" => 0, "y" => 0}]},
      %{"x" => "10"}
    ]

    for overrides <- malformed, do: render_hook(ctx.actor, "create_element", pasted(overrides))

    assert stored(ctx.board) == []
  end

  test "pasted text becomes a text element with its text", ctx do
    render_hook(
      ctx.actor,
      "create_element",
      pasted(%{
        "kind" => "text",
        "points" => [],
        "text" => "line one\nline two",
        "stroke_width" => "thin",
        "stroke_style" => "solid",
        "width" => 90,
        "height" => 50
      })
    )

    assert [%{kind: :text, text: "line one\nline two"}] = stored(ctx.board)
  end

  test "the help lists duplicate, copy, cut and paste from the registry", ctx do
    html = render(ctx.actor)

    for action <- ~w(duplicate copy cut paste) do
      assert html =~ ~s(id="shortcut-#{action}")
    end
  end
end
