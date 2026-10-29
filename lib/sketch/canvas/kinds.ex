defmodule Sketch.Canvas.Kinds do
  @moduledoc """
  The registry of element kinds (ADR 0004), in board order. Each entry is a kind module under
  `lib/sketch/canvas/kinds/` or, until that kind moves, its id in `Sketch.Canvas.Kinds.Legacy`.
  """

  alias Sketch.Canvas.Kind
  alias Sketch.Canvas.Kinds.{Arrow, Diamond, Ellipse, Freedraw, Legacy, Line, Rectangle}

  @registry [Rectangle, Diamond, Ellipse, Arrow, Freedraw, Line, :text, :note]

  @legacy Map.new(Legacy.specs(), &{&1.id, &1})
  @legacy_ids Enum.filter(@registry, &is_map_key(@legacy, &1))

  if Enum.sort(@legacy_ids) != Enum.sort(Map.keys(@legacy)) do
    raise CompileError,
      description:
        "Sketch.Canvas.Kinds must list every Legacy kind exactly once: registered #{inspect(@legacy_ids)}, Legacy has #{inspect(Map.keys(@legacy))}"
  end

  @specs Enum.map(@registry, fn entry -> Map.get_lazy(@legacy, entry, &entry.spec/0) end)
  @ids Enum.map(@specs, & &1.id)

  if length(Enum.uniq(@ids)) != length(@ids) do
    raise CompileError, description: "Sketch.Canvas.Kinds declares a kind twice: #{inspect(@ids)}"
  end

  @doc "Every kind's spec, in board order."
  @spec all() :: [Kind.t()]
  def all, do: @specs

  @doc "Every kind's id, in board order."
  @spec ids() :: [atom()]
  def ids, do: @ids

  @doc "The kinds whose spec still lives in `Sketch.Canvas.Kinds.Legacy`."
  @spec legacy_ids() :: [atom()]
  def legacy_ids, do: @legacy_ids

  @spec fetch!(atom()) :: Kind.t()
  def fetch!(id),
    do: Enum.find(@specs, &(&1.id == id)) || raise(KeyError, key: id, term: __MODULE__)
end
