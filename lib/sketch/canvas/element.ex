defmodule Sketch.Canvas.Element do
  @moduledoc """
  A shape on a board (ADR 0003): its `kind`, bounding box, for point kinds such as lines its points
  relative to the box origin, and for text kinds its text. `version` is the server-ordered tag of the shape (ADR 0001).
  `erase` hard-deletes it and publishes `%{id, board_id}`, a tombstone every client applies over any version.
  """
  use Ash.Resource,
    otp_app: :sketch,
    domain: Sketch.Canvas,
    data_layer: AshPostgres.DataLayer,
    notifiers: [Ash.Notifier.PubSub]

  alias Sketch.Canvas.{Geometry, Kinds}
  alias Sketch.Canvas.Validations.{FitsCanvas, PointsFitShape, TextFitsKind}

  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()
  @kinds Kinds.ids()
  @point_kinds Geometry.point_kinds()
  @box_kinds @kinds -- @point_kinds
  @box_min_size Geometry.dimensions().min_size
  @max_text_length Geometry.max_text_length()
  @event_fields [:id, :board_id, :kind, :x, :y, :width, :height, :text, :version]

  # The CHECK constraints were generated with the point kinds in this order; listing them in
  # registry order would change the SQL text, and so the migrations, without changing the rule.
  @migrated_point_kind_order [:line, :arrow, :freedraw]
  @sql_point_kind_order Enum.filter(@migrated_point_kind_order, &(&1 in @point_kinds)) ++
                          (@point_kinds -- @migrated_point_kind_order)
  @sql_point_kinds Enum.map_join(@sql_point_kind_order, ", ", &"'#{&1}'")
  @sql_point_counts Enum.map_join(@sql_point_kind_order, " ", fn kind ->
                      range = Geometry.point_count(kind)

                      "WHEN kind = '#{kind}' THEN cardinality(points) BETWEEN #{range.first} AND #{range.last}"
                    end)
  @sql_required_text_kinds Enum.map_join(Geometry.required_text_kinds(), ", ", &"'#{&1}'")
  @sql_text_kinds Enum.map_join(Geometry.text_kinds(), ", ", &"'#{&1}'")
  @sql_not_text_whitespace ~S"[^ \t\n\r]"
  @sql_point_outside String.trim(~S"""
                     $[*] ? (@.type() != "object" || !exists(@.x) || !exists(@.y) ||
                       @.x.type() != "number" || @.y.type() != "number" ||
                       @.x.floor() != @.x || @.y.floor() != @.y ||
                       @.x < 0 || @.y < 0 || @.x > $w || @.y > $h)
                     """)

  postgres do
    table "elements"
    repo Sketch.Repo

    references do
      reference :board, on_delete: :delete, index?: true
    end

    check_constraints do
      check_constraint :x, "x_within_canvas", check: "x >= 0 AND x + width <= #{@canvas_width}"

      check_constraint :y, "y_within_canvas", check: "y >= 0 AND y + height <= #{@canvas_height}"

      check_constraint :width, "width_at_least_min",
        check: "width >= CASE WHEN kind IN (#{@sql_point_kinds}) THEN 0 ELSE #{@box_min_size} END"

      check_constraint :height, "height_at_least_min",
        check:
          "height >= CASE WHEN kind IN (#{@sql_point_kinds}) THEN 0 ELSE #{@box_min_size} END"

      check_constraint :points, "points_match_kind",
        check: """
        CASE #{@sql_point_counts} ELSE cardinality(points) = 0 END
        """

      check_constraint :points, "points_within_box",
        check: """
        NOT jsonb_path_exists(array_to_json(points)::jsonb, '#{@sql_point_outside}',
          jsonb_build_object('w', width, 'h', height))
        """

      check_constraint :text, "text_length", check: "char_length(text) <= #{@max_text_length}"

      check_constraint :text, "text_matches_kind",
        check:
          "CASE WHEN kind IN (#{@sql_required_text_kinds}) THEN text ~ '#{@sql_not_text_whitespace}' WHEN kind IN (#{@sql_text_kinds}) THEN true ELSE text = '' END"

      check_constraint :version, "version_not_negative", check: "version >= 0"
    end
  end

  actions do
    defaults [:read]

    create :create do
      accept [:kind, :x, :y, :width, :height, :points, :text, :board_id]
    end

    update :commit_position do
      accept [:x, :y]
      change atomic_update(:version, expr(version + 1))
    end

    update :commit_shape do
      accept [:x, :y, :width, :height, :points, :text]
      require_attributes [:x, :y, :width, :height]
      change atomic_update(:version, expr(version + 1))
    end

    destroy :erase

    read :list_for_board do
      argument :board_id, :uuid, allow_nil?: false
      filter expr(board_id == ^arg(:board_id))
      prepare build(sort: [inserted_at: :asc, id: :asc])
    end
  end

  pub_sub do
    module SketchWeb.Endpoint
    prefix "board"

    publish :create, [:board_id], transform: &__MODULE__.event_payload/1
    publish :commit_position, [:board_id], transform: &__MODULE__.event_payload/1
    publish :commit_shape, [:board_id], transform: &__MODULE__.event_payload/1
    publish :erase, [:board_id], transform: &__MODULE__.erase_payload/1
  end

  validations do
    validate {FitsCanvas, position: :x, size: :width, limit: @canvas_width}
    validate {FitsCanvas, position: :y, size: :height, limit: @canvas_height}

    validate compare(:width, greater_than_or_equal_to: @box_min_size),
      where: [attribute_in(:kind, @box_kinds)]

    validate compare(:height, greater_than_or_equal_to: @box_min_size),
      where: [attribute_in(:kind, @box_kinds)]

    validate {PointsFitShape, kinds: @kinds}
    validate {TextFitsKind, kinds: @kinds}
  end

  attributes do
    uuid_primary_key :id

    attribute :kind, Sketch.Canvas.ElementKind,
      allow_nil?: false,
      public?: true

    attribute :x, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: @canvas_width]

    attribute :y, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: @canvas_height]

    attribute :width, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: @canvas_width]

    attribute :height, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: @canvas_height]

    attribute :points, {:array, Sketch.Canvas.Point},
      allow_nil?: false,
      default: [],
      public?: true,
      constraints: [max_length: Geometry.max_points()]

    attribute :text, :string,
      allow_nil?: false,
      default: "",
      public?: true,
      constraints: [max_length: @max_text_length, allow_empty?: true, trim?: false]

    attribute :version, :integer,
      allow_nil?: false,
      default: 0,
      public?: true,
      writable?: false,
      constraints: [min: 0]

    create_timestamp :inserted_at
  end

  relationships do
    belongs_to :board, Sketch.Canvas.Board, allow_nil?: false, public?: true
  end

  def event_payload(%{data: element}), do: to_event(element)

  def erase_payload(%{data: element}), do: Map.take(element, [:id, :board_id])

  def to_event(element) do
    element
    |> Map.take(@event_fields)
    |> Map.put(:points, Enum.map(element.points, &Map.take(&1, [:x, :y])))
  end
end
