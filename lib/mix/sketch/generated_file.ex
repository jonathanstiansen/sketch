defmodule Mix.Sketch.GeneratedFile do
  @moduledoc """
  Writes a file generated from the registries (ADR 0004), or with `--check` fails when the
  committed copy differs from what would be generated.
  """

  @spec run([String.t()], Path.t(), String.t(), String.t()) :: :ok
  def run(args, file, contents, task) do
    {opts, _rest} = OptionParser.parse!(args, strict: [check: :boolean])

    if opts[:check], do: check!(file, contents, task), else: write!(file, contents)
  end

  defp check!(file, contents, task) do
    if File.read(file) == {:ok, contents} do
      Mix.shell().info("#{file} is up to date")
    else
      Mix.raise(
        "#{file} is stale or was edited by hand. Run `mix #{task}` and commit the result."
      )
    end
  end

  defp write!(file, contents) do
    File.mkdir_p!(Path.dirname(file))
    File.write!(file, contents)
    Mix.shell().info("Wrote #{file}")
  end
end
