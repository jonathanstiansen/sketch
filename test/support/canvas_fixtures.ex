defmodule Sketch.CanvasFixtures do
  @moduledoc "Attributes and generators for test elements."

  alias Sketch.Canvas.Geometry

  @max_generated_size 400

  @doc "Generates any element kind; every kind property test draws its kinds from here."
  def element_kind, do: StreamData.member_of(Sketch.Canvas.element_kinds())

  @doc "Create attributes for a default-sized rectangle, overridden by `attrs`."
  def rectangle(attrs) do
    %{default_width: width, default_height: height} = Geometry.dimensions()
    Map.merge(%{kind: :rectangle, width: width, height: height}, attrs)
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
