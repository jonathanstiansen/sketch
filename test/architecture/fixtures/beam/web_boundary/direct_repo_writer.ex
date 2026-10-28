defmodule Sketch.ArchitectureFixtures.DirectRepoWriter do
  @moduledoc false

  def insert(rows), do: Sketch.Repo.insert_all("rectangles", rows)
end
