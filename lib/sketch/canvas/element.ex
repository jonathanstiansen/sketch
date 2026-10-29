defmodule Sketch.Canvas.Element do
  @moduledoc """
  A shape on a board (ADR 0003): its `kind` and bounding box. `version` is the server-ordered
  tag of the box (ADR 0001).
  """
  use Ash.Resource,
    otp_app: :sketch,
    domain: Sketch.Canvas,
    data_layer: AshPostgres.DataLayer,
    notifiers: [Ash.Notifier.PubSub]

  alias Sketch.Canvas.Geometry
  alias Sketch.Canvas.Validations.FitsCanvas

  @canvas_width Geometry.canvas_width()
  @canvas_height Geometry.canvas_height()
  @min_size Geometry.min_size()
  @kinds [:rectangle, :diamond, :ellipse]
  @event_fields [:id, :board_id, :kind, :x, :y, :width, :height, :version]

  postgres do
    table "elements"
    repo Sketch.Repo

    references do
      reference :board, on_delete: :delete, index?: true
    end

    check_constraints do
      check_constraint :x, "x_within_canvas", check: "x >= 0 AND x + width <= #{@canvas_width}"

      check_constraint :y, "y_within_canvas", check: "y >= 0 AND y + height <= #{@canvas_height}"

      check_constraint :width, "width_at_least_min", check: "width >= #{@min_size}"
      check_constraint :height, "height_at_least_min", check: "height >= #{@min_size}"
      check_constraint :version, "version_not_negative", check: "version >= 0"
    end
  end

  actions do
    defaults [:read]

    create :create do
      accept [:kind, :x, :y, :width, :height, :board_id]
    end

    update :commit_position do
      accept [:x, :y]
      change atomic_update(:version, expr(version + 1))
    end

    update :commit_shape do
      accept [:x, :y, :width, :height]
      change atomic_update(:version, expr(version + 1))
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
  end

  validations do
    validate {FitsCanvas, position: :x, size: :width, limit: @canvas_width}
    validate {FitsCanvas, position: :y, size: :height, limit: @canvas_height}
  end

  attributes do
    uuid_primary_key :id

    attribute :kind, :atom,
      allow_nil?: false,
      public?: true,
      constraints: [one_of: @kinds]

    attribute :x, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: @canvas_width - @min_size]

    attribute :y, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: @canvas_height - @min_size]

    attribute :width, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: @min_size, max: @canvas_width]

    attribute :height, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: @min_size, max: @canvas_height]

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

  def to_event(element), do: Map.take(element, @event_fields)
end
