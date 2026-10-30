defmodule Sketch.Canvas.Kinds do
  @moduledoc """
  The registry of element kinds (ADR 0004), in board order. Each entry is a kind module under
  `lib/sketch/canvas/kinds/`. Compilation fails if a kind is declared twice, if a spec's draw
  gesture cannot produce its geometry (`Sketch.Canvas.Kind.consistent?/1`), or if a spec's `style`
  names a property twice or one that `Sketch.Canvas.Style` does not declare (ADR 0006).
  """

  alias Sketch.Canvas.{Kind, Style}
  alias Sketch.Canvas.Kinds.{Arrow, Diamond, Ellipse, Freedraw, Line, Note, Rectangle, Text}

  @registry [Rectangle, Diamond, Ellipse, Arrow, Freedraw, Line, Text, Note]

  @specs Enum.map(@registry, & &1.spec())
  @ids Enum.map(@specs, & &1.id)

  if length(Enum.uniq(@ids)) != length(@ids) do
    raise CompileError, description: "Sketch.Canvas.Kinds declares a kind twice: #{inspect(@ids)}"
  end

  for spec <- @specs, not Kind.consistent?(spec) do
    raise CompileError,
      description:
        "#{inspect(spec.id)} has draw gesture #{inspect(spec.draw_gesture)}, which cannot draw " <>
          "geometry #{inspect(spec.geometry)} with text #{inspect(spec.text)}"
  end

  for %{id: id, style: style} = spec <- @specs, not Kind.style_known?(spec) do
    raise CompileError,
      description:
        "#{inspect(id)} has style #{inspect(style)}; it must list distinct properties of " <>
          "Sketch.Canvas.Style: #{inspect(Style.properties())}"
  end

  @doc "Every kind's spec, in board order."
  @spec all() :: [Kind.t()]
  def all, do: @specs

  @doc "Every kind's id, in board order."
  @spec ids() :: [atom()]
  def ids, do: @ids

  @doc "The kinds a style property applies to, in board order."
  @spec styled_by(Style.property()) :: [atom()]
  def styled_by(property), do: for(%{id: id, style: style} <- @specs, property in style, do: id)

  @spec fetch!(atom()) :: Kind.t()
  def fetch!(id),
    do: Enum.find(@specs, &(&1.id == id)) || raise(KeyError, key: id, term: __MODULE__)
end
