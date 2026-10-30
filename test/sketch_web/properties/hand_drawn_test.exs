defmodule SketchWeb.Properties.HandDrawnTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Sketch.Canvas.Geometry
  alias SketchWeb.HandDrawn

  @max_jitter HandDrawn.max_jitter()
  @number ~r/^-?\d+(\.\d\d)?$/

  defp size, do: one_of([member_of([0, 1, 2, 3, 59, 60, 61, 4000]), integer(0..4000)])
  defp seed, do: one_of([member_of([0, 1, Geometry.max_seed()]), integer(0..Geometry.max_seed())])
  defp point, do: fixed_map(%{x: size(), y: size()})

  defp box_paths(width, height, seed) do
    for draw <- [&HandDrawn.rectangle/3, &HandDrawn.diamond/3, &HandDrawn.ellipse/3],
        do: draw.(width, height, seed)
  end

  defp hundredths(text) do
    assert text =~ @number, "#{inspect(text)} is not an integer or a 2-decimal number"

    case String.split(text, ".") do
      [whole] -> String.to_integer(whole) * 100
      ["-" <> whole, fraction] -> -(String.to_integer(whole) * 100 + String.to_integer(fraction))
      [whole, fraction] -> String.to_integer(whole) * 100 + String.to_integer(fraction)
    end
  end

  defp coordinates(path) do
    path
    |> String.split(" ")
    |> Enum.reject(&(&1 in ["M", "C"]))
    |> Enum.map(&hundredths/1)
    |> Enum.chunk_every(2)
  end

  defp within?(path, {min_x, min_y}, {max_x, max_y}) do
    path
    |> coordinates()
    |> Enum.all?(fn [x, y] ->
      x in (min_x * 100 - @max_jitter)..(max_x * 100 + @max_jitter) and
        y in (min_y * 100 - @max_jitter)..(max_y * 100 + @max_jitter)
    end)
  end

  defp well_formed?(path, subpaths, segments_per_subpath) do
    tokens = String.split(path, " ")
    commands = Enum.filter(tokens, &(&1 in ["M", "C"]))

    commands ==
      List.flatten(List.duplicate(["M" | List.duplicate("C", segments_per_subpath)], subpaths)) and
      length(tokens) == subpaths * (3 + 7 * segments_per_subpath)
  end

  property "a box shape's strokes are the same for the same seed and stay within the box plus the jitter cap" do
    check all width <- size(), height <- size(), seed <- seed(), max_runs: 500 do
      paths = box_paths(width, height, seed)
      assert paths == box_paths(width, height, seed)

      for path <- paths do
        assert within?(path, {0, 0}, {width, height}), path
      end

      [rectangle, diamond, ellipse] = paths
      assert well_formed?(rectangle, 8, 1)
      assert well_formed?(diamond, 8, 1)
      assert well_formed?(ellipse, 2, 4)
    end
  end

  property "a line's strokes are the same for the same seed and stay within its points' box plus the jitter cap" do
    check all start <- point(), finish <- point(), seed <- seed(), max_runs: 500 do
      path = HandDrawn.line(start, finish, seed)
      assert path == HandDrawn.line(start, finish, seed)
      assert well_formed?(path, 2, 1)

      assert within?(
               path,
               {min(start.x, finish.x), min(start.y, finish.y)},
               {max(start.x, finish.x), max(start.y, finish.y)}
             ),
             path
    end
  end

  property "format prints every hundredths value so that it reads back as the same value" do
    check all value <- integer(-1_000_000..1_000_000), max_runs: 1000 do
      assert value |> HandDrawn.format() |> hundredths() == value
    end
  end

  test "a zero-size shape is a valid path at the origin" do
    for path <- box_paths(0, 0, 0) ++ [HandDrawn.line(%{x: 0, y: 0}, %{x: 0, y: 0}, 0)] do
      assert path |> coordinates() |> Enum.uniq() == [[0, 0]]
    end
  end

  test "different seeds draw the same shape differently" do
    paths = for seed <- 0..9, do: HandDrawn.rectangle(120, 80, seed)
    assert length(Enum.uniq(paths)) == 10
  end
end
