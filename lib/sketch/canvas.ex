defmodule Sketch.Canvas do
  @moduledoc """
  The collaborative canvas domain. The web layer reaches boards and rectangles
  only through the code interfaces defined here.
  """
  use Ash.Domain,
    otp_app: :sketch

  resources do
    resource Sketch.Canvas.Board do
      define :create_board, action: :create
      define :get_board, action: :read, get_by: [:id]
      define :database_reachable, action: :database_reachable
    end

    resource Sketch.Canvas.Rectangle do
      define :create_rectangle, action: :create
      define :commit_position, action: :commit_position, get_by: [:id, :board_id]
      define :list_rectangles_for_board, action: :list_for_board, args: [:board_id]
    end
  end

  @doc "The PubSub topic of a board's rectangle notifications."
  @spec board_topic(String.t()) :: String.t()
  def board_topic(board_id), do: "board:#{board_id}"

  @doc "The map a rectangle notification carries, so loaded and broadcast rectangles match."
  defdelegate rectangle_event(rectangle), to: Sketch.Canvas.Rectangle, as: :to_event

  defdelegate geometry, to: Sketch.Canvas.Geometry, as: :dimensions
end
