defmodule Mix.Tasks.Sketch.Gen.RenderFixtures do
  @shortdoc "Writes the render and wrap parity fixtures, or checks that they are current"

  @moduledoc """
  Writes `assets/test/fixtures/render_parity.json` from the server element renderers and
  `assets/test/fixtures/wrap_parity.json` from the server text wrapping, for the client parity
  tests (ADR 0004).

      mix sketch.gen.render_fixtures          # write the files
      mix sketch.gen.render_fixtures --check  # fail if a committed file differs
  """
  use Mix.Task

  alias Mix.Sketch.GeneratedFile
  alias SketchWeb.{RenderFixtures, WrapFixtures}

  @requirements ["compile"]

  @impl Mix.Task
  def run(args) do
    for {path, contents} <- [
          {RenderFixtures.path(), RenderFixtures.render()},
          {WrapFixtures.path(), WrapFixtures.render()}
        ] do
      GeneratedFile.run(args, path, contents, "sketch.gen.render_fixtures")
    end

    :ok
  end
end
