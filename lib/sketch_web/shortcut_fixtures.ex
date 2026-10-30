defmodule SketchWeb.ShortcutFixtures do
  @moduledoc """
  Renders `assets/test/fixtures/shortcut_parity.json` (A23): every chord over a few keys and
  physical codes and every valid combination of `mod`, `shift`, `alt` and modifier policy, with
  the server's verdict from `SketchWeb.Shortcuts.Aggregate.collide?/2` for each pair.
  `assets/test/shortcut_parity.test.ts` runs the client matcher on key presses and expects a press
  matching both chords of a pair exactly when the server says they collide.
  `mix sketch.gen.render_fixtures` writes it with the render parity fixture.
  """

  alias SketchWeb.Shortcuts.Aggregate

  @path "assets/test/fixtures/shortcut_parity.json"
  @presses [
    {["a"], nil},
    {[], "KeyA"},
    {["1"], nil},
    {[], "Digit1"},
    {["!"], nil},
    {[], "Space"},
    {[" "], nil},
    {["escape"], nil},
    {[], "Escape"}
  ]

  @spec path() :: Path.t()
  def path, do: @path

  @spec chords() :: [map()]
  def chords do
    for {key, code} <- @presses,
        modifiers <- [:exact, :ignore_alt, :any],
        mod <- [:none, :command, :ctrl],
        shift <- [false, true, :any],
        alt <- [false, true],
        valid?(modifiers, mod, shift, alt) do
      %{key: key, code: code, mod: mod, shift: shift, alt: alt, modifiers: modifiers}
    end
  end

  @spec render() :: String.t()
  def render do
    chords = chords()

    collisions =
      for {a, i} <- Enum.with_index(chords), b <- Enum.drop(chords, i), into: "" do
        if Aggregate.collide?(a, b), do: "1", else: "0"
      end

    lines = Enum.map_join(chords, ",\n", &"    #{JSON.encode!(client_chord(&1))}")
    "{\n  \"chords\": [\n#{lines}\n  ],\n  \"collisions\": #{JSON.encode!(collisions)}\n}\n"
  end

  defp valid?(:exact, _mod, _shift, _alt), do: true
  defp valid?(:ignore_alt, _mod, _shift, alt), do: alt == false
  defp valid?(:any, mod, shift, alt), do: mod == :none and shift == :any and alt == false

  defp client_chord(chord) do
    %{
      "key" => chord.key,
      "code" => chord.code,
      "mod" => chord.mod,
      "shift" => if(chord.shift == :any, do: nil, else: chord.shift),
      "alt" => chord.alt,
      "modifiers" => chord.modifiers
    }
  end
end
