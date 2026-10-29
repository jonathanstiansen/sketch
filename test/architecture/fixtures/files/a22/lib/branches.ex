defmodule SketchWeb.ArchitectureFixtures.KindBranches do
  @moduledoc false

  def equal(kind), do: if(kind == :diamond, do: :diamond)
  def not_equal(kind), do: kind != :note
  def reversed(kind), do: :ellipse == kind
  def listed(kind) when kind in [:line, :arrow], do: true
  def head(%{kind: :text}), do: true
  def markup, do: ~s(<g data-kind="note"></g>)
  def unrelated(kind), do: kind == :info or kind in @kinds
end
