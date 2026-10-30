defmodule SketchWeb.Elements.Text do
  @moduledoc """
  Renders text as a transparent `rect` over its box that takes the pointer and a `text` with one
  `tspan` per line, at the font size, baseline and line height from `Sketch.Canvas.Geometry`.
  """
  @behaviour SketchWeb.ElementRenderer

  @font_size Sketch.Canvas.geometry().font_size
  @line_height Sketch.Canvas.geometry().line_height
  @text_baseline Sketch.Canvas.geometry().text_baseline

  @impl true
  def render(%{width: width, height: height, text: text, style: style}) do
    [
      %{
        tag: "rect",
        attrs: [
          {"data-text-hit", ""},
          {"x", 0},
          {"y", 0},
          {"width", width},
          {"height", height},
          {"fill", "transparent"}
        ]
      },
      %{
        tag: "text",
        attrs: [
          {"data-text-body", ""},
          {"font-size", @font_size},
          {"pointer-events", "none"},
          {"class", "text-element #{SketchWeb.ElementRenderer.ink_class(style)}"}
        ],
        children: text |> Sketch.Canvas.text_lines() |> Enum.with_index(&line/2)
      }
    ]
  end

  defp line(text, index),
    do: %{
      tag: "tspan",
      attrs: [{"x", 0}, {"y", @text_baseline + index * @line_height}],
      text: text
    }
end
