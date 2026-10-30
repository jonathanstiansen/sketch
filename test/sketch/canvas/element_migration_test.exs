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

  @hand_drawn_seed 20_261_030_055_935
  @hand_drawn_seed_migration Sketch.Repo.Migrations.HandDrawnSeed
  @hand_drawn_seed_file Path.expand(
                          "../../../priv/repo/migrations/20261030055935_hand_drawn_seed.exs",
                          __DIR__
                        )

  @styling 20_261_030_064_759
  @styling_migration Sketch.Repo.Migrations.Styling
  @styling_file Path.expand(
                  "../../../priv/repo/migrations/20261030064759_styling.exs",
                  __DIR__
                )

  setup_all do
    unless Code.ensure_loaded?(@styling_migration), do: Code.require_file(@styling_file)

    unless Code.ensure_loaded?(@migration), do: Code.require_file(@migration_file)

    unless Code.ensure_loaded?(@hand_drawn_seed_migration),
      do: Code.require_file(@hand_drawn_seed_file)

    unless Code.ensure_loaded?(@line_points_migration),
      do: Code.require_file(@line_points_file)

    :ok
  end

  @migrator_opts [log: false, migration_lock: false]

  defp migrate(:down), do: Ecto.Migrator.down(Repo, @element_model, @migration, @migrator_opts)
  defp migrate(:up), do: Ecto.Migrator.up(Repo, @element_model, @migration, @migrator_opts)

  defp migrate_seed(:down),
    do: Ecto.Migrator.down(Repo, @hand_drawn_seed, @hand_drawn_seed_migration, @migrator_opts)

  defp migrate_seed(:up),
    do: Ecto.Migrator.up(Repo, @hand_drawn_seed, @hand_drawn_seed_migration, @migrator_opts)

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

  test "adding the seed gives every existing row and every insert without one a random seed in range" do
    board = Canvas.create_board!()
    assert :ok = migrate_seed(:down)

    insert = fn ->
      Repo.query!(
        "INSERT INTO elements (board_id, kind, x, y, width, height) VALUES ($1, 'rectangle', 0, 0, 10, 10)",
        [Ecto.UUID.dump!(board.id)]
      )
    end

    for _row <- 1..20, do: insert.()
    assert :ok = migrate_seed(:up)
    insert.()

    seeds = board.id |> Canvas.list_elements_for_board!() |> Enum.map(& &1.seed)
    assert length(seeds) == 21
    assert Enum.all?(seeds, &(&1 in 0..Sketch.Canvas.geometry().max_seed))
    assert length(Enum.uniq(seeds)) > 1
  end

  test "adding the style keeps every existing element's look and lets an old server keep inserting (ADR 0006)" do
    board = Canvas.create_board!()
    assert :ok = Ecto.Migrator.down(Repo, @styling, @styling_migration, @migrator_opts)

    insert = fn kind ->
      Repo.query!(
        "INSERT INTO elements (board_id, kind, x, y, width, height, text) " <>
          "VALUES ($1, $2, 0, 0, 10, 10, $3)",
        [Ecto.UUID.dump!(board.id), kind, if(kind == "text", do: "hi", else: "")]
      )
    end

    for kind <- ~w(rectangle note text), do: insert.(kind)
    assert :ok = Ecto.Migrator.up(Repo, @styling, @styling_migration, @migrator_opts)
    insert.("ellipse")

    elements = Canvas.list_elements_for_board!(board.id)
    assert length(elements) == 4

    for element <- elements do
      assert Map.take(element, Canvas.style_properties()) == Canvas.style_defaults()
    end

    note = Enum.find(elements, &(&1.kind == :note))

    assert {:ok, %{version: 1, fill_color: :blue}} =
             Canvas.commit_style(note.id, board.id, %{fill_color: :blue})
  end
end
