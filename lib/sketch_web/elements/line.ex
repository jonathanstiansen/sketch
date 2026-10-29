defmodule SketchWeb.Elements.Line do
  @moduledoc """
  Renders a line as a wide transparent `line` that takes the pointer and a thin visible `line`
  on top, both from the start to the end point in local coordinates.
  """
  @behaviour SketchWeb.ElementRenderer

  @impl true
  def render(%{points: [start, finish]}) do
    [
      segment(start, finish, [
        {"data-line-hit", ""},
        {"stroke", "transparent"},
        {"stroke-width", 14}
      ]),
      segment(start, finish, [
        {"data-line-stroke", ""},
        {"stroke-width", 2},
        {"pointer-events", "none"},
        {"class", "stroke-base-content"}
      ])
    ]
  end

  defp segment(start, finish, attrs) do
    %{
      tag: "line",
      attrs:
        [
          {"x1", start.x},
          {"y1", start.y},
          {"x2", finish.x},
          {"y2", finish.y},
          {"stroke-linecap", "round"}
        ] ++ attrs
    }
  end
end
