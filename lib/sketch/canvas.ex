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
    end

    resource Sketch.Canvas.Rectangle do
      define :create_rectangle, action: :create
      define :list_rectangles_for_board, action: :list_for_board, args: [:board_id]
    end
  end
end
