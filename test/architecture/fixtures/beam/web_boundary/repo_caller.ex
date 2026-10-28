defmodule SketchWeb.ArchitectureFixtures.RepoCaller do
  @moduledoc false

  def list_rectangles, do: Sketch.Repo.all("rectangles")
end
