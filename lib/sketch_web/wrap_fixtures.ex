defmodule SketchWeb.WrapFixtures do
  @moduledoc """
  Renders `assets/test/fixtures/wrap_parity.json` (ADR 0004): the lines `Sketch.Canvas.wrap_text/3`
  returns for a fixed grid of texts and widths around the note's character width, and for cases
  drawn by a seeded generator from an alphabet of words, line breaks, the whitespace the wrap
  splits on and Unicode spaces it must keep inside words (no-break, ideographic, line separator,
  zero-width no-break, vertical tab and form feed), plus astral code points and a ZWJ sequence.
  `assets/test/wrap_parity.test.ts` expects the client's `wrapText` to return the same lines.
  `mix sketch.gen.render_fixtures` writes it with the render parity fixture.
  """

  @path "assets/test/fixtures/wrap_parity.json"

  @grid_texts [
    "",
    " ",
    "\t \t",
    "\n",
    "a",
    "the quick brown fox jumps over the lazy dog",
    "supercalifragilisticexpialidocious",
    "a  b   c    d     e",
    "  leading and trailing  ",
    "no\u00A0break\u00A0space between words",
    "ideographic\u3000space and\u2028line separator",
    "😀😀😀😀😀😀😀😀😀😀 𝄞𝄞𝄞𝄞𝄞𝄞 👩‍💻👩‍💻",
    "one\ntwo is longer than a line\n\n  indented\r\ncrlf\rcr",
    "tab\tseparated\twords",
    "<b>x</b> & &amp;"
  ]
  @alphabet [
    "a",
    "bc",
    "W",
    "é",
    "中文",
    "😀",
    "𝄞",
    "👩‍💻",
    "-",
    "<",
    " ",
    " ",
    "  ",
    "\t",
    "\n",
    "\r\n",
    "\r",
    "\u00A0",
    "\u2028",
    "\u3000",
    "\uFEFF",
    "\v",
    "\f",
    "\u0085",
    "\u2003"
  ]
  @generated_cases 600
  @max_tokens 60
  @seed 20_261_029

  @spec path() :: Path.t()
  def path, do: @path

  @spec render() :: String.t()
  def render do
    cases = Enum.map_join(cases(), ",\n", &"  #{JSON.encode!(&1)}")
    "[\n#{cases}\n]\n"
  end

  defp cases do
    %{char_width: char_width, note_padding: padding} = Sketch.Canvas.geometry()

    grid =
      for text <- @grid_texts, width <- grid_widths(char_width, padding) do
        {text, width - 2 * padding, char_width}
      end

    Enum.map(grid ++ generated(), fn {text, max_width, char_width} ->
      %{
        "text" => text,
        "max_width" => max_width,
        "char_width" => char_width,
        "lines" => Sketch.Canvas.wrap_text(text, max_width, char_width)
      }
    end)
  end

  defp grid_widths(char_width, padding) do
    for chars <- [0, 1, 2, 3, 14],
        offset <- [-1, 0, 1],
        width = 2 * padding + chars * char_width + offset do
      width
    end
    |> Enum.concat([0, 1, padding, 200])
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp generated do
    {cases, _state} =
      Enum.map_reduce(1..@generated_cases, @seed, fn _index, state ->
        {tokens, state} = draw(state, @max_tokens + 1)
        {text, state} = text(tokens, state)
        {max_width, state} = draw(state, 431)
        {char_width, state} = draw(state, 3)
        {{text, max_width - 30, Enum.at([1, 5, 12], char_width)}, state}
      end)

    cases
  end

  defp text(count, state) do
    {tokens, state} =
      Enum.map_reduce(List.duplicate(nil, count), state, fn _token, state ->
        {index, state} = draw(state, length(@alphabet))
        {Enum.at(@alphabet, index), state}
      end)

    {Enum.join(tokens), state}
  end

  defp draw(state, bound) do
    next = rem(state * 1_103_515_245 + 12_345, 2_147_483_648)
    {rem(div(next, 65_536), bound), next}
  end
end
