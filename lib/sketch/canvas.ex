defmodule Sketch.Canvas do
  @moduledoc """
  The collaborative canvas domain. The web layer reaches boards and elements
  only through the code interfaces defined here.
  """
  use Ash.Domain,
    otp_app: :sketch

  alias Sketch.Canvas.Kinds

  resources do
    resource Sketch.Canvas.Board do
      define :create_board, action: :create
      define :get_board, action: :read, get_by: [:id]
      define :database_reachable, action: :database_reachable
    end

    resource Sketch.Canvas.Element do
      define :create_element, action: :create
      define :commit_position, action: :commit_position, get_by: [:id, :board_id]
      define :commit_shape, action: :commit_shape, get_by: [:id, :board_id]
      define :commit_style, action: :commit_style, get_by: [:id, :board_id]
      define :erase_element, action: :erase, get_by: [:id, :board_id]
      define :list_elements_for_board, action: :list_for_board, args: [:board_id]
    end
  end

  @doc "The PubSub topic of a board's element notifications."
  @spec board_topic(String.t()) :: String.t()
  def board_topic(board_id), do: "board:#{board_id}"

  @doc "The map an element notification carries, so loaded and broadcast elements match."
  defdelegate element_event(element), to: Sketch.Canvas.Element, as: :to_event

  @doc "The element kinds a board can hold."
  @spec element_kinds() :: [atom()]
  defdelegate element_kinds, to: Kinds, as: :ids

  @doc "Every element kind's spec, in board order (ADR 0004)."
  @spec kind_specs() :: [Sketch.Canvas.Kind.t()]
  defdelegate kind_specs, to: Kinds, as: :all

  defdelegate geometry, to: Sketch.Canvas.Geometry, as: :dimensions

  @doc "A fresh anonymous viewer: random id, name and colour derived from it (ADR 0007)."
  defdelegate new_viewer, to: Sketch.Canvas.Viewer, as: :new

  @doc "The style properties, in panel order (ADR 0006)."
  defdelegate style_properties, to: Sketch.Canvas.Style, as: :properties

  @doc "A style property's tokens, in panel order; the first is its default."
  defdelegate style_tokens(property), to: Sketch.Canvas.Style, as: :tokens

  defdelegate style_defaults, to: Sketch.Canvas.Style, as: :defaults

  @doc "The style token a client's value names for a property, or `:error`."
  defdelegate style_token(property, value), to: Sketch.Canvas.Style, as: :cast_token

  defdelegate style_label(name), to: Sketch.Canvas.Style, as: :label

  defdelegate style_stroke_px(width), to: Sketch.Canvas.Style, as: :stroke_px

  defdelegate style_sketch_px(width), to: Sketch.Canvas.Style, as: :sketch_px

  defdelegate style_dash_array(style, width), to: Sketch.Canvas.Style, as: :dash_array

  @doc "The roughness of a sloppiness level, in percent of the artist's jitter."
  defdelegate style_roughness(sloppiness), to: Sketch.Canvas.Style, as: :roughness

  @doc "Every token's client data, by property."
  defdelegate style_token_data, to: Sketch.Canvas.Style, as: :token_data

  defdelegate default_box(element_count), to: Sketch.Canvas.Geometry

  @doc "The kinds whose ends may be bound to another element (ADR 0016)."
  defdelegate binding_kinds, to: Sketch.Canvas.Binding, as: :kinds

  @doc "The kinds the client binds an arrow end to (ADR 0016)."
  defdelegate binding_target_kinds, to: Sketch.Canvas.Binding, as: :target_kinds

  defdelegate binding_anchor_scale, to: Sketch.Canvas.Binding, as: :anchor_scale

  defdelegate binding_ends, to: Sketch.Canvas.Binding, as: :ends

  defdelegate binding_fields(end_name), to: Sketch.Canvas.Binding, as: :fields

  @doc "The kinds whose text is a label at a draggable offset."
  defdelegate label_kinds, to: Sketch.Canvas.Label, as: :kinds

  defdelegate label_default, to: Sketch.Canvas.Label, as: :default

  @doc "A label offset clamped into its box."
  defdelegate label_clamp(offset), to: Sketch.Canvas.Label, as: :clamp

  @doc "The point of a label offset in a box, relative to the box origin."
  defdelegate label_point(width, height, offset), to: Sketch.Canvas.Label, as: :point

  @doc "Where a label's text block is centred so it stays inside the box when it fits."
  defdelegate label_placed(width, height, offset, block_width, block_height),
    to: Sketch.Canvas.Label,
    as: :placed

  @doc "The anchor of a point on a target's box, in per mille (ADR 0016)."
  defdelegate binding_anchor_for(point, box), to: Sketch.Canvas.Binding, as: :anchor_for

  @doc "The ids an element's ends are bound to (ADR 0016)."
  defdelegate binding_targets(element), to: Sketch.Canvas.Binding, as: :targets

  @doc "An element as drawn, its bound ends on their targets' current boxes (ADR 0016)."
  defdelegate resolve_binding(element, box_of), to: Sketch.Canvas.Binding, as: :resolve

  @doc "An element as drawn on a board state: its bound ends on their targets (ADR 0016)."
  defdelegate drawn_element(board_state, element), to: Sketch.Canvas.BoardState, as: :drawn

  defdelegate board_bound_to(board_state, element_id),
    to: Sketch.Canvas.BoardState,
    as: :bound_to

  defdelegate board_binding_target?(board_state, element_id),
    to: Sketch.Canvas.BoardState,
    as: :binding_target?

  defdelegate fit_shape(kind, box, points), to: Sketch.Canvas.Geometry

  defdelegate point_kinds, to: Sketch.Canvas.Geometry

  defdelegate text_whitespace, to: Sketch.Canvas.Geometry

  defdelegate text_lines(text), to: Sketch.Canvas.Geometry

  defdelegate wrap_text(text, max_width, char_width), to: Sketch.Canvas.Geometry

  @doc "A client's merged view of a board, built from element events (ADR 0001)."
  defdelegate new_board_state(element_events), to: Sketch.Canvas.BoardState, as: :new

  @doc """
  Merges an element or erase event: an erase removes the element for good, and otherwise only a
  higher version than the known one changes the state.
  """
  defdelegate apply_board_event(board_state, event),
    to: Sketch.Canvas.BoardState,
    as: :apply_event

  defdelegate board_erased?(board_state, element_id), to: Sketch.Canvas.BoardState, as: :erased?
end
