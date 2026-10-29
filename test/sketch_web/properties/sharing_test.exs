defmodule SketchWeb.Properties.SharingTest do
  use SketchWeb.ConnCase
  use ExUnitProperties

  import Phoenix.LiveViewTest

  alias Sketch.Canvas
  alias Sketch.Canvas.Board

  defp seed_board(rectangle_count) do
    board = Canvas.create_board!()

    generate_rectangles(board.id, rectangle_count)

    board
  end

  defp unknown_uuid, do: map(binary(length: 16), &Ecto.UUID.load!/1)

  defp malformed_id do
    one_of([
      string(:alphanumeric, min_length: 1, max_length: 40),
      map(unknown_uuid(), &String.slice(&1, 0..34)),
      map(unknown_uuid(), &String.replace(&1, "-", "", global: false))
    ])
  end

  defp visit(board_count) do
    one_of([
      tuple({constant(:board), integer(0..(board_count - 1))}),
      tuple({constant(:unknown), unknown_uuid()}),
      tuple({constant(:malformed), malformed_id()})
    ])
  end

  defp scenario do
    bind(list_of(integer(0..3), min_length: 1, max_length: 4), fn counts ->
      tuple({constant(counts), list_of(visit(length(counts)), min_length: 1, max_length: 8)})
    end)
  end

  defp rendered_rectangle_ids(view) do
    view
    |> render()
    |> LazyHTML.from_fragment()
    |> LazyHTML.query("[data-element]")
    |> LazyHTML.attribute("data-element")
    |> Enum.sort()
  end

  defp stored_rectangle_ids(board) do
    board.id |> Canvas.list_elements_for_board!() |> Enum.map(& &1.id) |> Enum.sort()
  end

  defp assert_shared_board(conn, board) do
    {:ok, view, _html} = live(conn, ~p"/b/#{board.id}")

    assert rendered_rectangle_ids(view) == stored_rectangle_ids(board)
    assert has_element?(view, "#board-url[href='/b/#{board.id}']")
  end

  defp assert_not_found(conn, id) do
    assert {:error, {:redirect, %{to: "/", flash: %{"error" => "Board not found"}}}} =
             live(conn, "/b/#{URI.encode_www_form(id)}")
  end

  property "a shared link shows exactly that board, and a bad link creates nothing", %{
    conn: conn
  } do
    check all {counts, visits} <- scenario(), max_runs: 50 do
      boards = Enum.map(counts, &seed_board/1)
      board_count = Ash.count!(Board)

      for visit <- visits do
        case visit do
          {:board, index} -> assert_shared_board(conn, Enum.at(boards, index))
          {_unknown_or_malformed, id} -> assert_not_found(conn, id)
        end
      end

      assert Ash.count!(Board) == board_count
    end
  end
end
