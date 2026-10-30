defmodule SketchWeb.Elements.Note do
  @moduledoc """
  Renders a note as a rounded body over its box, its hand-drawn edges and, in a nested `svg` that
  clips to the box, a `text` with one `tspan` per wrapped line: the text wraps to the box width
  minus `Sketch.Canvas.Geometry` padding on both sides, at its character width per code point.
  """
  @behaviour SketchWeb.ElementRenderer

  @font_size Sketch.Canvas.geometry().font_size
  @line_height Sketch.Canvas.geometry().line_height
  @text_baseline Sketch.Canvas.geometry().text_baseline
  @char_width Sketch.Canvas.geometry().char_width
  @padding Sketch.Canvas.geometry().note_padding

  @impl true
  def render(%{width: width, height: height, text: text, seed: seed}) do
    [
      %{
        tag: "rect",
        attrs: [
          {"data-note-body", ""},
          {"x", 0},
          {"y", 0},
          {"width", width},
          {"height", height},
          {"rx", 6},
          {"stroke-width", 2},
          {"class", "note-body"}
        ]
      },
      SketchWeb.ElementRenderer.sketch(
        SketchWeb.HandDrawn.rectangle(width, height, seed),
        "note-sketch"
      ),
      %{
        tag: "svg",
        attrs: [
          {"data-note-clip", ""},
          {"x", 0},
          {"y", 0},
          {"width", width},
          {"height", height},
          {"overflow", "hidden"},
          {"pointer-events", "none"}
        ],
        children: [
          %{
            tag: "text",
            attrs: [
              {"data-text-body", ""},
              {"transform", "translate(#{@padding} #{@padding})"},
              {"font-size", @font_size},
              {"class", "text-element fill-base-content"}
            ],
            children:
              text
              |> Sketch.Canvas.wrap_text(width - 2 * @padding, @char_width)
              |> Enum.with_index(&line/2)
          }
        ]
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
