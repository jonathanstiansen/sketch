defmodule Mix.Tasks.Sketch.Gen.Manifest do
  @shortdoc "Writes the generated client manifest, or checks that it is current"

  @moduledoc """
  Writes `assets/js/generated/manifest.ts` from the kind registry, the tool manifest and the
  canvas geometry (ADR 0004).

      mix sketch.gen.manifest          # write the file
      mix sketch.gen.manifest --check  # fail if the committed file differs
  """
  use Mix.Task

  @requirements ["compile"]

  @impl Mix.Task
  def run(args) do
    {opts, _rest} = OptionParser.parse!(args, strict: [check: :boolean])
    path = SketchWeb.ClientManifest.path()
    contents = SketchWeb.ClientManifest.render()

    if opts[:check], do: check!(path, contents), else: write!(path, contents)
  end

  defp check!(path, contents) do
    if File.read(path) == {:ok, contents} do
      Mix.shell().info("#{path} is up to date")
    else
      Mix.raise(
        "#{path} is stale or was edited by hand. Run `mix sketch.gen.manifest` and commit the result."
      )
    end
  end

  defp write!(path, contents) do
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, contents)
    Mix.shell().info("Wrote #{path}")
  end
end
