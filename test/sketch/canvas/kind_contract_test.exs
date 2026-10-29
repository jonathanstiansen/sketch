defmodule Sketch.Canvas.KindContractTest do
  use ExUnit.Case, async: true

  alias Sketch.Canvas
  alias Sketch.Canvas.{ElementKind, Kind, Kinds}
  alias Sketch.CanvasFixtures
  alias SketchWeb.{ClientManifest, Tools}

  @generated_samples 1000

  setup_all do
    generated_kinds =
      CanvasFixtures.element_kind() |> Enum.take(@generated_samples) |> MapSet.new()

    %{manifest: File.read!(ClientManifest.path()), generated_kinds: generated_kinds}
  end

  test "the committed client manifest is the generated one (A22)", %{manifest: manifest} do
    assert manifest == ClientManifest.render(),
           "#{ClientManifest.path()} is stale; run mix sketch.gen.manifest"
  end

  for kind <- Canvas.element_kinds() do
    @kind kind

    test "#{kind} has a spec, is in the client manifest and is drawn by the property generators",
         %{manifest: manifest, generated_kinds: generated_kinds} do
      assert %Kind{id: @kind} = spec = Kinds.fetch!(@kind)
      assert well_formed?(spec), inspect(spec)
      assert manifest =~ ~r/^export const ELEMENT_KINDS = \[[^\]]*"#{@kind}"/m
      assert manifest =~ ~r/^  #{@kind}: \{ id: "#{@kind}", /m
      assert MapSet.member?(generated_kinds, @kind)
    end
  end

  test "the registry, the element attribute and the specs list the same kinds in the same order" do
    assert Canvas.element_kinds() == Enum.map(Canvas.kind_specs(), & &1.id)
    assert ElementKind.values() == Canvas.element_kinds()
    assert Enum.uniq(Canvas.element_kinds()) == Canvas.element_kinds()
  end

  test "every tool creates a registered kind and every kind has exactly one tool" do
    created = for %{creates: kind} <- Tools.all(), kind != nil, do: kind

    assert Enum.sort(created) == Enum.sort(Canvas.element_kinds())
  end

  defp well_formed?(%Kind{geometry: geometry, text: text, default_size: size}) do
    geometry_ok?(geometry) and text in [:none, :optional, :required] and
      positive_integer?(size.width) and positive_integer?(size.height)
  end

  defp geometry_ok?(:box), do: true
  defp geometry_ok?({:points, %Range{first: first, last: last, step: 1}}), do: first in 1..last//1
  defp geometry_ok?(_geometry), do: false

  defp positive_integer?(value), do: is_integer(value) and value > 0
end
