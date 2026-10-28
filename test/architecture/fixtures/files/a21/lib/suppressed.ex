defmodule Sketch.ArchitectureFixtures.Suppressed do
  @moduledoc false
  @dialyzer :no_return

  # credo:disable-for-next-line
  def value, do: :ok
end
