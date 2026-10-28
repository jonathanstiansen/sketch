defmodule Sketch.ArchitectureFixtures.Broker do
  @moduledoc false

  def subscribe(board_id),
    do: Registry.register(Sketch.ArchitectureFixtures.Registry, board_id, [])
end
