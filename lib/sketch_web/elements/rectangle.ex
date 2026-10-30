defmodule SketchWeb.Elements.Rectangle do
  @moduledoc "Renders a rectangle as one filled `rect` covering its box under its hand-drawn edges."
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{width: width, height: height, seed: seed}) do
    [
      %{
        tag: "rect",
        attrs: [
          {"x", 0},
          {"y", 0},
          {"width", width},
          {"height", height},
          {"stroke", "transparent"},
          {"stroke-width", 2},
          {"class", "fill-primary"}
        ]
      },
      SketchWeb.ElementRenderer.sketch(SketchWeb.HandDrawn.rectangle(width, height, seed))
    ]
  end
end
