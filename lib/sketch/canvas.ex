defmodule Sketch.Canvas do
  @moduledoc """
  The collaborative canvas domain. The web layer reaches boards and elements
  only through the code interfaces defined here.
  """
  use Ash.Domain,
    otp_app: :sketch

  alias Ash.Resource.Info
  alias Sketch.Canvas.Element

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
  def element_kinds,
    do: Info.attribute(Element, :kind).constraints[:one_of]

  defdelegate geometry, to: Sketch.Canvas.Geometry, as: :dimensions

  defdelegate default_box(element_count), to: Sketch.Canvas.Geometry

  defdelegate fit_shape(kind, box, points), to: Sketch.Canvas.Geometry

  defdelegate point_kinds, to: Sketch.Canvas.Geometry

  @doc "A client's merged view of a board, built from element events (ADR 0001)."
  defdelegate new_board_state(element_events), to: Sketch.Canvas.BoardState, as: :new

  @doc "Merges an element event; only a higher version than the known one changes the state."
  defdelegate apply_board_event(board_state, element_event),
    to: Sketch.Canvas.BoardState,
    as: :apply_event

  defdelegate board_element_count(board_state),
    to: Sketch.Canvas.BoardState,
    as: :element_count
end
