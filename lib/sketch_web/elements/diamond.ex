defmodule SketchWeb.Elements.Diamond do
  @moduledoc "Renders a diamond as one filled `polygon` through the midpoints of its box's sides."
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{width: width, height: height}) do
    mid_x = half(width)
    mid_y = half(height)

    [
      %{
        tag: "polygon",
        attrs: [
          {"points", "#{mid_x},0 #{width},#{mid_y} #{mid_x},#{height} 0,#{mid_y}"},
          {"stroke-width", 2},
          {"class", "fill-primary stroke-base-content"}
        ]
      }
    ]
  end

  defp half(value) when rem(value, 2) == 0, do: div(value, 2)
  defp half(value), do: value / 2
end
