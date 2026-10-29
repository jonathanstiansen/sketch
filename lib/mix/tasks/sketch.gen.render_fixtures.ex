defmodule Mix.Tasks.Sketch.Gen.RenderFixtures do
  @shortdoc "Writes the render parity fixture, or checks that it is current"

  @moduledoc """
  Writes `assets/test/fixtures/render_parity.json` from the server element renderers, for the
  client renderers' parity test (ADR 0004).

      mix sketch.gen.render_fixtures          # write the file
      mix sketch.gen.render_fixtures --check  # fail if the committed file differs
  """
  use Mix.Task

  alias Mix.Sketch.GeneratedFile
  alias SketchWeb.RenderFixtures

  @requirements ["compile"]

  @impl Mix.Task
  def run(args) do
    GeneratedFile.run(
      args,
      RenderFixtures.path(),
      RenderFixtures.render(),
      "sketch.gen.render_fixtures"
    )
  end
end
