defmodule SketchWeb.RandomFixtures do
  @moduledoc """
  Renders `assets/test/fixtures/random_parity.json` (ADR 0005): the first outputs of
  `SketchWeb.HandDrawn.Random` for fixed seeds (0, small values, the largest element seed and the
  largest 32-bit value), and how `SketchWeb.HandDrawn.format/1` prints a range of hundredths,
  including negative and fractional values. `assets/test/random_parity.test.ts` expects the client
  generator and formatter to return the same. A drift in the random source shows up here before it
  shows up as a different path in the render fixture.
  `mix sketch.gen.render_fixtures` writes it with the render parity fixture.
  """

  alias SketchWeb.HandDrawn
  alias SketchWeb.HandDrawn.Random

  @path "assets/test/fixtures/random_parity.json"
  @seeds [
    0,
    1,
    2,
    7,
    42,
    65_535,
    1_234_567_890,
    Sketch.Canvas.geometry().max_seed - 1,
    Sketch.Canvas.geometry().max_seed,
    0xFFFFFFFF
  ]
  @outputs 64
  @hundredths [0, 1, 5, 9, 10, 50, 99, 100, 101, 150, 199, 1_000, 12_345, 400_000, 400_525] ++
                [-1, -5, -10, -99, -100, -101, -150, -525]

  @spec path() :: Path.t()
  def path, do: @path

  @spec render() :: String.t()
  def render do
    outputs =
      Enum.map_join(@seeds, ",\n", fn seed ->
        "    #{JSON.encode!(%{"seed" => seed, "outputs" => Random.take(seed, @outputs)})}"
      end)

    formats =
      Enum.map_join(@hundredths, ",\n", fn value ->
        "    #{JSON.encode!(%{"hundredths" => value, "text" => HandDrawn.format(value)})}"
      end)

    "{\n  \"random\": [\n#{outputs}\n  ],\n  \"format\": [\n#{formats}\n  ]\n}\n"
  end
end
