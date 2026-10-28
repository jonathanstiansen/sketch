defmodule SketchWeb.ArchitectureFixtures.InternalCaller do
  @moduledoc false

  alias Sketch.ArchitectureFixtures.Internal

  def board, do: Internal.board()
end
