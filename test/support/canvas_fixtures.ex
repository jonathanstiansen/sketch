defmodule Sketch.CanvasFixtures do
  @moduledoc "Attributes and generators for test elements."

  alias Sketch.Canvas.{Geometry, Kinds}

  @max_generated_size 400

  @doc "Generates any element kind; every kind property test draws its kinds from here."
  def element_kind, do: StreamData.member_of(Sketch.Canvas.element_kinds())

  @doc "Create attributes for a default-sized rectangle, overridden by `attrs`."
  def rectangle(attrs) do
    %{default_width: width, default_height: height} = Geometry.dimensions()
    Map.merge(%{kind: :rectangle, width: width, height: height}, attrs)
  end

  @doc "Create attributes for a valid 120 x 80 element of any kind at the origin, overridden by `attrs`."
  def element_attrs(kind, attrs) do
    %{kind: kind, x: 0, y: 0, width: 120, height: 80}
    |> Map.merge(kind_shape(Kinds.fetch!(kind)))
    |> Map.merge(attrs)
  end

  defp kind_shape(%{geometry: {:points, _range}}),
    do: %{points: [%{x: 0, y: 0}, %{x: 120, y: 80}]}

  defp kind_shape(%{text: :required}), do: %{text: "hello"}
  defp kind_shape(_box_kind), do: %{}

  @doc "A rectangle's notification payload, shaped like `Sketch.Canvas.element_event/1`."
  def rectangle_event(attrs) do
    %{points: [], text: "", seed: 0}
    |> Map.merge(Sketch.Canvas.style_defaults())
    |> Map.merge(attrs)
    |> rectangle()
  end

  @doc "Inserts `count` rectangles with random boxes inside the canvas on the board."
  def generate_rectangles(board_id, count) do
    Sketch.Canvas.Element
    |> Ash.Generator.changeset_generator(:create,
      defaults: [
        board_id: board_id,
        kind: :rectangle,
        points: [],
        text: "",
        width: StreamData.integer(1..@max_generated_size),
        height: StreamData.integer(1..@max_generated_size),
        x: StreamData.integer(0..(Geometry.canvas_width() - @max_generated_size)),
        y: StreamData.integer(0..(Geometry.canvas_height() - @max_generated_size))
      ]
    )
    |> Ash.Generator.generate_many(count)
  end
end
