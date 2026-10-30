defmodule SketchWeb.BoardLiveStyleTest do
  use SketchWeb.ConnCase

  import Phoenix.LiveViewTest
  import Sketch.CanvasFixtures, only: [element_attrs: 2]

  alias Sketch.Canvas

  @drag_id "11111111-2222-4333-8444-555555555555"

  setup do
    %{board: Canvas.create_board!()}
  end

  defp create_params(kind, style) do
    Map.merge(
      %{
        "kind" => kind,
        "drag_id" => @drag_id,
        "x" => 10,
        "y" => 20,
        "width" => 120,
        "height" => 80
      },
      style
    )
  end

  defp line_params(style) do
    "line"
    |> create_params(style)
    |> Map.put("points", [%{"x" => 0, "y" => 0}, %{"x" => 120, "y" => 80}])
  end

  test "the properties panel lists every property and token of the registry, defaults pressed", %{
    conn: conn,
    board: board
  } do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    assert has_element?(
             view,
             "section#style-panel[aria-label='Element style'] p[data-style-hint]"
           )

    for property <- Canvas.style_properties() do
      group = "#style-panel [role='group'][data-style-property='#{property}']"
      assert has_element?(view, "#{group}[hidden][aria-labelledby='style-#{property}-label']")
      [default | others] = Canvas.style_tokens(property)

      assert has_element?(
               view,
               "#{group} button[data-style-value='#{default}'][aria-pressed='true']" <>
                 "[aria-label='#{Canvas.style_label(default)}']"
             )

      for token <- others do
        assert has_element?(
                 view,
                 "#{group} button[type='button'][data-style-value='#{token}'][aria-pressed='false']"
               )
      end
    end
  end

  test "create_element stores the drawn style and every view and a reload render it from tokens",
       %{conn: conn, board: board} do
    {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

    style = %{
      "stroke_color" => "red",
      "fill_color" => "blue",
      "stroke_width" => "bold",
      "stroke_style" => "dashed"
    }

    render_hook(creator, "create_element", create_params("rectangle", style))

    assert [%{id: id} = element] = Canvas.list_elements_for_board!(board.id)

    assert %{stroke_color: :red, fill_color: :blue, stroke_width: :bold, stroke_style: :dashed} =
             element

    {:ok, reloaded, _html} = live(conn, ~p"/b/#{board.id}")

    for view <- [creator, watcher, reloaded] do
      wrapper =
        "g#element-#{id}[data-stroke-color='red'][data-fill-color='blue']" <>
          "[data-stroke-width='bold'][data-stroke-style='dashed']"

      assert has_element?(view, "#{wrapper} > rect.fill-palette-blue")

      assert has_element?(
               view,
               "#{wrapper} > path[data-sketch].stroke-palette-red[stroke-width='3'][stroke-dasharray='12 9']"
             )
    end
  end

  test "create_element without a style uses the defaults, and with an unknown token creates nothing",
       %{conn: conn, board: board} do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    for {property, value} <- [
          {"stroke_color", "purple"},
          {"fill_color", "#ff0000"},
          {"stroke_width", 3},
          {"stroke_style", nil}
        ] do
      render_hook(view, "create_element", create_params("rectangle", %{property => value}))
    end

    assert Canvas.list_elements_for_board!(board.id) == []

    render_hook(view, "create_element", create_params("ellipse", %{}))
    assert [element] = Canvas.list_elements_for_board!(board.id)
    assert Map.take(element, Canvas.style_properties()) == Canvas.style_defaults()
  end

  test "a style that does not apply to the kind creates nothing and says so", %{
    conn: conn,
    board: board
  } do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    render_hook(view, "create_element", line_params(%{"fill_color" => "red"}))

    assert render(view) =~ "Could not add element"
    assert Canvas.list_elements_for_board!(board.id) == []

    render_hook(view, "create_element", line_params(%{"stroke_style" => "dotted"}))
    assert [%{kind: :line, stroke_style: :dotted}] = Canvas.list_elements_for_board!(board.id)
  end

  test "commit_style restyles the element in every view and a reload, and increments its version",
       %{conn: conn, board: board} do
    element = Canvas.create_element!(element_attrs(:arrow, %{board_id: board.id}))
    {:ok, styler, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")

    render_hook(styler, "commit_style", %{
      "element_id" => element.id,
      "stroke_color" => "green",
      "stroke_width" => "extra_bold"
    })

    assert [%{stroke_color: :green, stroke_width: :extra_bold, version: 1}] =
             Canvas.list_elements_for_board!(board.id)

    {:ok, reloaded, _html} = live(conn, ~p"/b/#{board.id}")

    for view <- [styler, watcher, reloaded] do
      assert has_element?(
               view,
               "g#element-#{element.id}[data-version='1'][data-stroke-color='green'] > " <>
                 "path[data-line-stroke].stroke-palette-green[stroke-width='4.5']" <>
                 "[marker-end='url(#arrowhead-green)']"
             )

      assert has_element?(view, "#canvas defs marker#arrowhead-green > path.ink-palette-green")
    end
  end

  test "commit_style with no, unknown or inapplicable tokens changes nothing", %{
    conn: conn,
    board: board
  } do
    element = Canvas.create_element!(element_attrs(:text, %{board_id: board.id}))
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    for params <- [
          %{},
          %{"stroke_color" => "purple"},
          %{"stroke_color" => "red", "fill_color" => "plaid"},
          %{"element_id" => "not-a-uuid", "stroke_color" => "red"}
        ] do
      render_hook(view, "commit_style", Map.merge(%{"element_id" => element.id}, params))
    end

    refute render(view) =~ "Could not restyle element"

    render_hook(view, "commit_style", %{"element_id" => element.id, "fill_color" => "red"})
    assert render(view) =~ "Could not restyle element"

    assert [%{version: 0, stroke_color: :ink, fill_color: :auto}] =
             Canvas.list_elements_for_board!(board.id)
  end

  test "commit_style for an element on another board or one already erased changes nothing", %{
    conn: conn,
    board: board
  } do
    other = Canvas.create_board!()
    elsewhere = Canvas.create_element!(element_attrs(:rectangle, %{board_id: other.id}))
    erased = Canvas.create_element!(element_attrs(:rectangle, %{board_id: board.id}))
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    render_hook(view, "erase", %{"element_ids" => [erased.id]})

    for id <- [elsewhere.id, erased.id] do
      render_hook(view, "commit_style", %{"element_id" => id, "stroke_color" => "red"})
    end

    assert [%{version: 0, stroke_color: :ink}] = Canvas.list_elements_for_board!(other.id)
    assert Canvas.list_elements_for_board!(board.id) == []
  end

  test "a draw preview relays its style, and one with an unknown token is dropped", %{
    conn: conn,
    board: board
  } do
    {:ok, creator, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
    preview = Map.merge(create_params("ellipse", %{}), %{"points" => [], "seed" => 3})

    render_hook(
      creator,
      "draw_preview",
      Map.merge(preview, %{"seq" => 1, "fill_color" => "yellow", "stroke_style" => "dotted"})
    )

    assert_push_event(watcher, "draw_preview", %{
      seq: 1,
      fill_color: :yellow,
      stroke_style: :dotted
    })

    render_hook(creator, "draw_preview", Map.merge(preview, %{"seq" => 2, "fill_color" => "x"}))
    refute_push_event(watcher, "draw_preview", %{seq: 2})

    render_hook(creator, "draw_preview", Map.put(preview, "seq", 3))
    assert_push_event(watcher, "draw_preview", %{seq: 3} = unstyled)
    refute Map.has_key?(unstyled, :fill_color)
  end
end
