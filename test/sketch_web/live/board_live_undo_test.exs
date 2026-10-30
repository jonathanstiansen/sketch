defmodule SketchWeb.BoardLiveUndoTest do
  use SketchWeb.ConnCase
  use ExUnitProperties

  import Phoenix.LiveViewTest

  alias Phoenix.Socket.Broadcast
  alias Sketch.Canvas
  alias Sketch.Canvas.Kinds
  alias SketchWeb.{HistoryActions, Shortcuts}

  @drag_id "11111111-2222-4333-8444-555555555555"
  @undo_drag_id "66666666-7777-4888-9999-000000000000"
  @content_fields [:kind, :x, :y, :width, :height, :points, :text, :seed] ++
                    Canvas.style_properties()

  setup %{conn: conn} do
    board = Canvas.create_board!()
    {:ok, actor, _html} = live(conn, ~p"/b/#{board.id}")
    {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
    %{board: board, actor: actor, watcher: watcher}
  end

  defp create!(board, attrs \\ %{}) do
    Canvas.default_box(0)
    |> Map.merge(attrs)
    |> Map.put(:board_id, board.id)
    |> rectangle()
    |> Canvas.create_element!()
  end

  defp over_the_wire(map), do: map |> JSON.encode!() |> JSON.decode!()

  defp recreate_params(snapshot) do
    snapshot
    |> Map.take(@content_fields)
    |> over_the_wire()
    |> Map.put("drag_id", @undo_drag_id)
  end

  defp stored(board), do: Canvas.list_elements_for_board!(board.id)

  defp shown_at?(view, element_id, x, version) do
    has_element?(view, "#element-#{element_id}[data-x='#{x}'][data-version='#{version}']")
  end

  test "a create replies to its view with the created element", ctx do
    params = %{
      "kind" => "rectangle",
      "drag_id" => @drag_id,
      "x" => 10,
      "y" => 20,
      "width" => 30,
      "height" => 40,
      "seed" => 7
    }

    render_hook(ctx.actor, "create_element", params)

    assert_reply(ctx.actor, %{element: element})
    assert [stored_element] = stored(ctx.board)
    assert element == Canvas.element_event(stored_element)
    assert %{kind: :rectangle, x: 10, y: 20, seed: 7, version: 0} = element
  end

  test "Add rectangle pushes the created element to the clicking view only", ctx do
    ctx.actor |> element("#add-rectangle") |> render_click()

    assert_push_event(ctx.actor, "created", %{element: element})
    assert [stored_element] = stored(ctx.board)
    assert element == Canvas.element_event(stored_element)
    assert has_element?(ctx.watcher, "#element-#{element.id}")
    refute_push_event(ctx.watcher, "created", _payload, 100)
  end

  test "an erase replies with every element it erased, as it was", ctx do
    first = create!(ctx.board, %{x: 1})
    second = create!(ctx.board, %{x: 2})
    {:ok, moved} = Canvas.commit_position(second.id, ctx.board.id, %{x: 5, y: 6})

    render_hook(ctx.actor, "erase", %{"element_ids" => [first.id, second.id, first.id]})

    assert_reply(ctx.actor, %{erased: erased})
    assert erased == [Canvas.element_event(first), Canvas.element_event(moved)]
    assert stored(ctx.board) == []
  end

  test "an erase of nothing erasable replies with no elements", ctx do
    render_hook(ctx.actor, "erase", %{"element_ids" => [@drag_id]})
    assert_reply(ctx.actor, %{erased: []})

    render_hook(ctx.actor, "erase", %{"element_ids" => ["not-a-uuid"]})
    assert_reply(ctx.actor, %{erased: []})
  end

  property "undoing an erase creates the same element under a new id, seen by every view, and the erased id stays erased" do
    check all kind <- member_of(Canvas.element_kinds()),
              seed <- integer(0..Canvas.geometry().max_seed),
              tokens <- fixed_map(Map.new(Canvas.style_properties(), &{&1, style_token(&1)})),
              x <- integer(0..500),
              max_runs: 25 do
      conn = Phoenix.ConnTest.build_conn()
      board = Canvas.create_board!()
      {:ok, actor, _html} = live(conn, ~p"/b/#{board.id}")
      {:ok, watcher, _html} = live(conn, ~p"/b/#{board.id}")
      style = Map.filter(tokens, fn {property, _token} -> kind in Kinds.styled_by(property) end)

      original =
        kind
        |> element_attrs(Map.merge(style, %{x: x, seed: seed, board_id: board.id}))
        |> Canvas.create_element!()

      render_hook(actor, "erase", %{"element_ids" => [original.id]})
      assert_reply(actor, %{erased: [snapshot]})

      render_hook(actor, "create_element", recreate_params(snapshot))
      assert_reply(actor, %{element: recreated})

      assert recreated.id != original.id
      assert Map.take(recreated, @content_fields) == Map.take(snapshot, @content_fields)

      for view <- [actor, watcher] do
        assert has_element?(view, "#element-#{recreated.id}")
        refute has_element?(view, "#element-#{original.id}")
      end

      render_hook(actor, "commit", %{
        "element_id" => original.id,
        "drag_id" => @drag_id,
        "x" => 0,
        "y" => 0
      })

      assert_reply(actor, %{ok: false})
      assert [stored_element] = stored(board)
      assert stored_element.id == recreated.id
    end
  end

  defp style_token(property), do: member_of(Canvas.style_tokens(property))

  test "an undone move is a new commit with the next version, so every view accepts it (A09)",
       ctx do
    element = create!(ctx.board, %{x: 10, y: 20})
    move = %{"element_id" => element.id, "drag_id" => @drag_id}

    render_hook(ctx.actor, "commit", Map.merge(move, %{"x" => 300, "y" => 400}))
    assert_reply(ctx.actor, %{ok: true})
    assert shown_at?(ctx.watcher, element.id, 300, 1)

    undo = %{"element_id" => element.id, "drag_id" => @undo_drag_id, "x" => 10, "y" => 20}
    render_hook(ctx.actor, "commit", undo)
    assert_reply(ctx.actor, %{ok: true})

    for view <- [ctx.actor, ctx.watcher] do
      assert shown_at?(view, element.id, 10, 2)
    end

    assert [%{x: 10, y: 20, version: 2}] = stored(ctx.board)
  end

  test "undone resizes, text edits and style changes are new versions too", ctx do
    element = create!(ctx.board, %{x: 10, y: 20})
    box = %{"x" => 10, "y" => 20, "width" => 120, "height" => 80, "points" => []}
    ref = %{"element_id" => element.id, "drag_id" => @drag_id}

    render_hook(ctx.actor, "commit_shape", Map.merge(ref, %{box | "width" => 200}))
    assert_reply(ctx.actor, %{ok: true})
    render_hook(ctx.actor, "commit_shape", Map.merge(ref, box))
    assert_reply(ctx.actor, %{ok: true})

    render_hook(ctx.actor, "commit_style", %{"element_id" => element.id, "stroke_color" => "red"})
    assert_reply(ctx.actor, %{ok: true})
    render_hook(ctx.actor, "commit_style", %{"element_id" => element.id, "stroke_color" => "ink"})
    assert_reply(ctx.actor, %{ok: true})

    assert [%{width: 120, stroke_color: :ink, version: 4}] = stored(ctx.board)
    assert has_element?(ctx.watcher, "#element-#{element.id}[data-version='4'][data-width='120']")
  end

  test "a commit for an element someone else erased replies ok: false and publishes nothing",
       ctx do
    element = create!(ctx.board)
    render_hook(ctx.watcher, "erase", %{"element_ids" => [element.id]})
    :ok = SketchWeb.Endpoint.subscribe(Canvas.board_topic(ctx.board.id))

    render_hook(ctx.actor, "commit", %{
      "element_id" => element.id,
      "drag_id" => @drag_id,
      "x" => 1,
      "y" => 1
    })

    assert_reply(ctx.actor, %{ok: false})

    render_hook(ctx.actor, "commit_style", %{"element_id" => element.id, "fill_color" => "red"})
    assert_reply(ctx.actor, %{ok: false})

    refute_receive %Broadcast{}, 100
    refute render(ctx.actor) =~ "Could not"
  end

  test "a commit the server rejects replies ok: false", ctx do
    element = create!(ctx.board)

    render_hook(ctx.actor, "commit", %{
      "element_id" => element.id,
      "drag_id" => @drag_id,
      "x" => 3990,
      "y" => 0
    })

    assert_reply(ctx.actor, %{ok: false})
    assert [%{version: 0}] = stored(ctx.board)
  end

  test "the undo and redo buttons and the shortcuts help render from the history registry", ctx do
    help = ctx.actor |> element("#shortcuts-help") |> render()

    for action <- HistoryActions.all() do
      assert has_element?(
               ctx.actor,
               "#history-controls button#history-#{action.id}[data-history-action=#{action.id}][disabled]"
             )

      assert help =~ action.label

      for chord <- action.chords, key <- chord.keys do
        assert help =~ key
      end
    end
  end

  test "the aggregate gives undo and redo their aria-keyshortcuts and title" do
    assert Shortcuts.aria_keyshortcuts("undo") == "Control+Z Meta+Z"
    assert Shortcuts.aria_keyshortcuts("redo") == "Control+Shift+Z Meta+Shift+Z Control+Y"
    assert Shortcuts.title("undo") == "Undo (Ctrl/⌘+Z)"
  end
end
