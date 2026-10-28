defmodule Sketch.Canvas.Rectangle do
  @moduledoc """
  A fixed-size rectangle on a board. `version` is the server-ordered tag of its position.
  """
  use Ash.Resource,
    otp_app: :sketch,
    domain: Sketch.Canvas,
    data_layer: AshPostgres.DataLayer,
    notifiers: [Ash.Notifier.PubSub]

  alias Sketch.Canvas.Geometry

  @max_x Geometry.max_x()
  @max_y Geometry.max_y()
  @event_fields [:id, :board_id, :x, :y, :version]

  postgres do
    table "rectangles"
    repo Sketch.Repo

    references do
      reference :board, on_delete: :delete, index?: true
    end

    check_constraints do
      check_constraint :x, "x_within_canvas", check: "x >= 0 AND x <= #{@max_x}"
      check_constraint :y, "y_within_canvas", check: "y >= 0 AND y <= #{@max_y}"
      check_constraint :version, "version_not_negative", check: "version >= 0"
    end
  end

  actions do
    create :create do
      accept [:x, :y, :board_id]
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
  end

  attributes do
    uuid_primary_key :id

    attribute :x, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: @max_x]

    attribute :y, :integer,
      allow_nil?: false,
      public?: true,
      constraints: [min: 0, max: @max_y]

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

  def event_payload(%{data: rectangle}), do: to_event(rectangle)

  def to_event(rectangle), do: Map.take(rectangle, @event_fields)
end
