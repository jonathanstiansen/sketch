defmodule Sketch.Canvas.Element do
  @moduledoc """
  A shape on a board (ADR 0003): its `kind`, bounding box, for point kinds such as lines its points
  relative to the box origin, for text kinds its text, and the `seed` its hand-drawn strokes are
  generated from (ADR 0005), chosen once on create and never changed, and its style: a stroke colour,
  fill colour, stroke width and stroke style, tokens from `Sketch.Canvas.Style` that `commit_style`
  changes; a property that does not apply to the kind keeps its default (ADR 0006).
  `version` is the server-ordered tag of the whole element (ADR 0001); each commit action writes only
  its own attributes and increments it.
  A line or arrow end may be bound to another element on the board (ADR 0016): it stores the
  target and an anchor in per mille of the target's box, and is drawn there whatever the stored
  points say. Erasing a target first freezes the ends bound to it with `freeze_ends`.
  `erase` hard-deletes it and publishes `%{id, board_id}`, a tombstone every client applies over any version.
  """
  use Ash.Resource,
    otp_app: :sketch,
    domain: Sketch.Canvas,
    data_layer: AshPostgres.DataLayer,
    notifiers: [Ash.Notifier.PubSub]

  alias Sketch.Canvas.{Binding, Geometry, Kinds, Label, Style}
  alias Sketch.Canvas.Changes.FreezeBoundEnds
  alias Sketch.Canvas.Validations.{FitsCanvas, PointsFitShape, TextFitsKind}

  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()
  @kinds Kinds.ids()
  @point_kinds Geometry.point_kinds()
  @box_kinds @kinds -- @point_kinds
  @box_min_size Geometry.dimensions().min_size
  @max_text_length Geometry.max_text_length()
  @max_seed Geometry.max_seed()
  @style_properties Style.properties()
  @binding_attributes Binding.attributes()
  @label_defaults %{label_x: Label.default().x, label_y: Label.default().y}
  @label_attributes Map.keys(@label_defaults)
  @unlabelled_kinds @kinds -- Label.kinds()
  @unbindable_kinds @kinds -- Binding.kinds()
  @event_fields [:id, :board_id, :kind, :x, :y, :width, :height, :text, :seed] ++
                  @style_properties ++ @binding_attributes ++ @label_attributes ++ [:version]
  @unstyled_kinds Map.new(@style_properties, &{&1, @kinds -- Kinds.styled_by(&1)})

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
  @sql_style_checks Enum.flat_map(@style_properties, fn property ->
                      default = Style.default(property)
                      tokens = Enum.map_join(Style.tokens(property), ", ", &"'#{&1}'")
                      styled = Enum.map_join(Kinds.styled_by(property), ", ", &"'#{&1}'")

                      [
                        {property, "#{property}_known", "#{property} IN (#{tokens})"},
                        {property, "#{property}_fits_kind",
                         "#{property} = '#{default}' OR kind IN (#{styled})"}
                      ]
                    end)
  @sql_binding_kinds Enum.map_join(Binding.kinds(), ", ", &"'#{&1}'")
  @sql_binding_checks Enum.flat_map(Binding.ends(), fn end_name ->
                        %{target: target, anchor_x: ax, anchor_y: ay} = Binding.fields(end_name)
                        scale = Binding.anchor_scale()

                        [
                          {target, "#{end_name}_binding_fits_kind",
                           "#{target} IS NULL OR kind IN (#{@sql_binding_kinds})"},
                          {target, "#{end_name}_binding_has_anchor",
                           "#{target} IS NULL OR (#{ax} IS NOT NULL AND #{ay} IS NOT NULL)"},
                          {target, "#{end_name}_binding_not_self",
                           "#{target} IS NULL OR #{target} <> id"},
                          {ax, "#{end_name}_anchor_in_range",
                           "(#{ax} IS NULL OR #{ax} BETWEEN 0 AND #{scale}) AND (#{ay} IS NULL OR #{ay} BETWEEN 0 AND #{scale})"}
                        ]
                      end)
  @sql_label_kinds Enum.map_join(Label.kinds(), ", ", &"'#{&1}'")
  @sql_label_default Label.default()
  @sql_point_outside String.trim(~S"""
                     $[*] ? (@.type() != "object" || !exists(@.x) || !exists(@.y) ||
                       @.x.type() != "number" || @.y.type() != "number" ||
                       @.x.floor() != @.x || @.y.floor() != @.y ||
                       @.x < 0 || @.y < 0 || @.x > $w || @.y > $h)
                     """)

  postgres do
    table "elements"
    repo Sketch.Repo

    migration_defaults seed: ~s|fragment("floor(random() * #{@max_seed + 1})::bigint")|

    references do
      reference :board, on_delete: :delete, index?: true
    end

    foreign_key_names Enum.map(Binding.ends(), fn end_name ->
                        {Binding.fields(end_name).target, "elements_#{end_name}_target_fkey",
                         "must be an element on the same board"}
                      end)

    custom_statements do
      statement :elements_board_id_id_index do
        up "CREATE UNIQUE INDEX elements_board_id_id_index ON elements (board_id, id);"
        down "DROP INDEX elements_board_id_id_index;"
      end

      for end_name <- Binding.ends() do
        statement :"elements_#{end_name}_target_fkey" do
          up "ALTER TABLE elements ADD CONSTRAINT elements_#{end_name}_target_fkey FOREIGN KEY (board_id, #{end_name}_target_id) REFERENCES elements (board_id, id) ON DELETE SET NULL (#{end_name}_target_id);"

          down "ALTER TABLE elements DROP CONSTRAINT elements_#{end_name}_target_fkey;"
        end

        statement :"elements_#{end_name}_target_index" do
          up "CREATE INDEX elements_#{end_name}_target_id_index ON elements (#{end_name}_target_id);"
          down "DROP INDEX elements_#{end_name}_target_id_index;"
        end
      end
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

      check_constraint :seed, "seed_in_range", check: "seed >= 0 AND seed <= #{@max_seed}"

      for {property, name, check} <- @sql_style_checks do
        check_constraint property, name, check: check
      end

      for {attribute, name, check} <- @sql_binding_checks do
        check_constraint attribute, name, check: check
      end

      check_constraint :label_x, "label_in_box",
        check: "label_x BETWEEN 0 AND #{Label.scale()} AND label_y BETWEEN 0 AND #{Label.scale()}"

      check_constraint :label_x, "label_fits_kind",
        check:
          "(label_x = #{@sql_label_default.x} AND label_y = #{@sql_label_default.y}) OR kind IN (#{@sql_label_kinds})"
    end
  end

  actions do
    defaults [:read]

    create :create do
      accept [:kind, :x, :y, :width, :height, :points, :text, :seed, :board_id] ++
               @style_properties ++ @binding_attributes ++ @label_attributes
    end

    update :commit_position do
      accept [:x, :y]
      change atomic_update(:version, expr(version + 1))
    end

    update :commit_shape do
      accept [:x, :y, :width, :height, :points, :text] ++
               @binding_attributes ++ @label_attributes

      require_attributes [:x, :y, :width, :height]
      change atomic_update(:version, expr(version + 1))
    end

    update :freeze_ends do
      accept [:x, :y, :width, :height, :points] ++ @binding_attributes
      change atomic_update(:version, expr(version + 1))
    end

    update :commit_style do
      accept @style_properties
      change atomic_update(:version, expr(version + 1))
    end

    destroy :erase do
      require_atomic? false
      change FreezeBoundEnds
    end

    read :bound_to do
      argument :board_id, :uuid, allow_nil?: false
      argument :target_id, :uuid, allow_nil?: false

      filter expr(
               board_id == ^arg(:board_id) and
                 (start_target_id == ^arg(:target_id) or end_target_id == ^arg(:target_id))
             )
    end

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
    publish :commit_style, [:board_id], transform: &__MODULE__.event_payload/1
    publish :freeze_ends, [:board_id], transform: &__MODULE__.event_payload/1
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

    for end_name <- Binding.ends() do
      %{target: target, anchor_x: anchor_x, anchor_y: anchor_y} = Binding.fields(end_name)

      validate absent(target),
        where: [attribute_in(:kind, @unbindable_kinds)],
        message: "only a line or arrow end can be bound"

      validate present([anchor_x, anchor_y]),
        where: [present(target)],
        message: "a bound end needs an anchor"
    end

    for attribute <- @label_attributes do
      validate attribute_equals(attribute, Map.fetch!(@label_defaults, attribute)),
        where: [attribute_in(:kind, @unlabelled_kinds)],
        message: "only a labelled shape has a label offset"
    end

    for {property, [_ | _] = kinds} <- @unstyled_kinds do
      validate attribute_equals(property, Style.default(property)),
        where: [attribute_in(:kind, kinds)],
        message: "does not apply to the element's kind"
    end
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

    attribute :seed, :integer,
      allow_nil?: false,
      default: &__MODULE__.random_seed/0,
      public?: true,
      constraints: [min: 0, max: @max_seed]

    for property <- @style_properties do
      attribute property, :atom,
        constraints: [one_of: Style.tokens(property)],
        allow_nil?: false,
        default: Style.default(property),
        public?: true
    end

    for end_name <- Binding.ends() do
      %{target: target, anchor_x: anchor_x, anchor_y: anchor_y} = Binding.fields(end_name)

      attribute target, :uuid, allow_nil?: true, public?: true

      for anchor <- [anchor_x, anchor_y] do
        attribute anchor, :integer,
          allow_nil?: true,
          public?: true,
          constraints: [min: 0, max: Binding.anchor_scale()]
      end
    end

    for attribute <- @label_attributes do
      attribute attribute, :integer,
        allow_nil?: false,
        default: Map.fetch!(@label_defaults, attribute),
        public?: true,
        constraints: [min: 0, max: Label.scale()]
    end

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

  @doc "A seed drawn uniformly from `0..Geometry.max_seed()`, for creates that do not choose one."
  @spec random_seed() :: non_neg_integer()
  def random_seed, do: :rand.uniform(@max_seed + 1) - 1

  def event_payload(%{data: element}), do: to_event(element)

  def erase_payload(%{data: element}), do: Map.take(element, [:id, :board_id])

  def to_event(element) do
    element
    |> Map.take(@event_fields)
    |> Map.put(:points, Enum.map(element.points, &Map.take(&1, [:x, :y])))
  end
end
