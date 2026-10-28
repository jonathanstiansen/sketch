defmodule SketchWeb.ArchitectureFixtures.ChangesetBuilder do
  @moduledoc false

  def move(rectangle, params), do: Ash.Changeset.for_update(rectangle, :commit_position, params)
end
