defmodule Mix.Tasks.Sketch.Gen.RenderFixtures do
  @shortdoc "Writes the render, wrap, random and shortcut parity fixtures, or checks that they are current"

  @moduledoc """
  Writes `assets/test/fixtures/render_parity.json` from the server element renderers and
  `assets/test/fixtures/wrap_parity.json` from the server text wrapping, for the client parity
  tests (ADR 0004), and `assets/test/fixtures/random_parity.json` from the hand-drawn random
  source and number formatting (ADR 0005), and `assets/test/fixtures/shortcut_parity.json` from the
  shortcut conflict model (A23).

      mix sketch.gen.render_fixtures          # write the files
      mix sketch.gen.render_fixtures --check  # fail if a committed file differs
  """
  use Mix.Task

  alias Mix.Sketch.GeneratedFile
  alias SketchWeb.{RandomFixtures, RenderFixtures, ShortcutFixtures, WrapFixtures}

  @requirements ["compile"]

  @impl Mix.Task
  def run(args) do
    for {path, contents} <- [
          {RenderFixtures.path(), RenderFixtures.render()},
          {WrapFixtures.path(), WrapFixtures.render()},
          {RandomFixtures.path(), RandomFixtures.render()},
          {ShortcutFixtures.path(), ShortcutFixtures.render()}
        ] do
      GeneratedFile.run(args, path, contents, "sketch.gen.render_fixtures")
    end

    :ok
  end
end
