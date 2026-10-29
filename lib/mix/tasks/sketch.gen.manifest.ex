defmodule Mix.Tasks.Sketch.Gen.Manifest do
  @shortdoc "Writes the generated client manifest, or checks that it is current"

  @moduledoc """
  Writes `assets/js/generated/manifest.ts` from the kind registry, the tool manifest, the element
  renderers and the canvas geometry (ADR 0004).

      mix sketch.gen.manifest          # write the file
      mix sketch.gen.manifest --check  # fail if the committed file differs
  """
  use Mix.Task

  alias Mix.Sketch.GeneratedFile
  alias SketchWeb.ClientManifest

  @requirements ["compile"]

  @impl Mix.Task
  def run(args) do
    GeneratedFile.run(args, ClientManifest.path(), ClientManifest.render(), "sketch.gen.manifest")
  end
end
