defmodule SketchWeb.StyleCssTest do
  use ExUnit.Case, async: true

  alias Sketch.Canvas

  @css File.read!(Path.expand("../../assets/css/app.css", __DIR__))
  @theme_blocks 3

  defp rule?(selector, declaration),
    do: @css =~ ~r/#{Regex.escape(selector)} \{\s*#{Regex.escape(declaration)}/

  defp theme_values(variable),
    do: ~r/^\s+#{Regex.escape(variable)}: /m |> Regex.scan(@css) |> length()

  test "every colour token has a light and a dark theme value (ADR 0006)" do
    for token <- Canvas.style_tokens(:stroke_color) do
      assert theme_values("--palette-stroke-#{token}") == @theme_blocks, inspect(token)
    end

    for token <- Canvas.style_tokens(:fill_color) do
      assert theme_values("--palette-fill-#{token}") == @theme_blocks, inspect(token)
    end
  end

  test "every class a renderer maps a token to is defined" do
    for token <- Canvas.style_tokens(:stroke_color) do
      assert rule?(".stroke-palette-#{token}", "stroke: var(--palette-stroke-#{token})")
      assert rule?(".ink-palette-#{token}", "fill: var(--palette-stroke-#{token})")
    end

    for token <- Canvas.style_tokens(:fill_color) do
      assert rule?(".fill-palette-#{token}", "fill: var(--palette-fill-#{token})")
      assert rule?(".note-edge-#{token}", "stroke: ")
    end
  end
end
