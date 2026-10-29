defmodule SketchWeb.Elements.Rectangle do
  @moduledoc "Renders a rectangle as one filled `rect` covering its box."
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{width: width, height: height}) do
    [
      %{
        tag: "rect",
        attrs: [
          {"x", 0},
          {"y", 0},
          {"width", width},
          {"height", height},
          {"stroke-width", 2},
          {"class", "fill-primary stroke-base-content"}
        ]
      }
    ]
  end
end
