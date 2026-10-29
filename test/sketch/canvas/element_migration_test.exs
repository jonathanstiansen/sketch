defmodule Sketch.Canvas.ElementMigrationTest do
  use Sketch.DataCase, async: false

  alias Sketch.Canvas

  @element_model 20_261_029_045_128
  @migration Sketch.Repo.Migrations.ElementModel

  @migration_file Path.expand(
                    "../../../priv/repo/migrations/20261029045128_element_model.exs",
                    __DIR__
                  )

  @line_points 20_261_029_090_747
  @line_points_migration Sketch.Repo.Migrations.LinePoints
  @line_points_file Path.expand(
                      "../../../priv/repo/migrations/20261029090747_line_points.exs",
                      __DIR__
                    )

  setup_all do
    unless Code.ensure_loaded?(@migration), do: Code.require_file(@migration_file)

    unless Code.ensure_loaded?(@line_points_migration),
      do: Code.require_file(@line_points_file)

    :ok
  end

  @migrator_opts [log: false, migration_lock: false]

  defp migrate(:down), do: Ecto.Migrator.down(Repo, @element_model, @migration, @migrator_opts)
  defp migrate(:up), do: Ecto.Migrator.up(Repo, @element_model, @migration, @migrator_opts)

  defp insert_rectangle(board, x, y, version) do
    Repo.query!(
      "INSERT INTO rectangles (board_id, x, y, version) VALUES ($1, $2, $3, $4) RETURNING id",
      [Ecto.UUID.dump!(board.id), x, y, version]
    ).rows
    |> then(fn [[id]] -> Ecto.UUID.load!(id) end)
  end

  test "renaming rectangles to elements keeps every row as a default-sized rectangle" do
    board = Canvas.create_board!()
    assert :ok = migrate(:down)

    corner = insert_rectangle(board, 3880, 3920, 7)
    origin = insert_rectangle(board, 0, 0, 0)

    assert :ok = migrate(:up)

    stored = Map.new(Canvas.list_elements_for_board!(board.id), &{&1.id, &1})

    assert %{kind: :rectangle, x: 3880, y: 3920, width: 120, height: 80, version: 7} =
             stored[corner]

    assert %{kind: :rectangle, x: 0, y: 0, width: 120, height: 80, version: 0} = stored[origin]
    assert map_size(stored) == 2

    assert {:ok, %{version: 8, width: 1}} =
             Canvas.commit_shape(corner, board.id, %{
               x: 3999,
               y: 3999,
               width: 1,
               height: 1,
               points: []
             })
  end

  test "adding points gives every existing element an empty list and keeps it committable" do
    board = Canvas.create_board!()

    existing =
      Canvas.create_element!(%{
        kind: :rectangle,
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        board_id: board.id
      })

    assert :ok =
             Ecto.Migrator.down(Repo, @line_points, @line_points_migration, @migrator_opts)

    assert :ok = Ecto.Migrator.up(Repo, @line_points, @line_points_migration, @migrator_opts)

    assert [%{id: id, points: [], version: 0}] = Canvas.list_elements_for_board!(board.id)
    assert id == existing.id

    assert {:ok, %{version: 1}} =
             Canvas.commit_shape(id, board.id, %{x: 1, y: 2, width: 5, height: 5, points: []})
  end
end
