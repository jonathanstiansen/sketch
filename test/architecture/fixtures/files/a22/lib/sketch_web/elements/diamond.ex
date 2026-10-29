defmodule SketchWeb.ArchitectureFixtures.Elements.Diamond do
  @moduledoc false

  def render(%{kind: :diamond}), do: ~s(<polygon data-kind="diamond" />)
end
