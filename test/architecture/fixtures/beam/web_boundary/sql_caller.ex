defmodule SketchWeb.ArchitectureFixtures.SqlCaller do
  @moduledoc false

  alias Ecto.Adapters.SQL

  def count, do: SQL.query(Sketch.Repo, "select count(*) from rectangles", [])
end
