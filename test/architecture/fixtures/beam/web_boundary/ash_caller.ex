defmodule SketchWeb.ArchitectureFixtures.AshCaller do
  @moduledoc false

  def create(resource, params), do: Ash.create(resource, params)
end
