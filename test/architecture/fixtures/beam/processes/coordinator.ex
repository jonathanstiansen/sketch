defmodule Sketch.ArchitectureFixtures.Coordinator do
  @moduledoc false
  use GenServer

  @impl GenServer
  def init(state), do: {:ok, state}
end
