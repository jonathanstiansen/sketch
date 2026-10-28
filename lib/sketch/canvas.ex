defmodule Sketch.Canvas do
  @moduledoc """
  The collaborative canvas domain. The web layer reaches boards and rectangles
  only through the code interfaces defined here.
  """
  use Ash.Domain,
    otp_app: :sketch

  resources do
  end
end
