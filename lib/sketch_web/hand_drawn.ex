defmodule SketchWeb.HandDrawn do
  @moduledoc """
  The hand-drawn strokes of ADR 0005, as SVG path data in an element's local coordinates.

  Each straight edge is two cubic Bézier strokes with jittered ends and control points bowed
  along the edge's normal; an ellipse is two jittered closed curves of four Bézier segments.
  The jitter comes from `SketchWeb.HandDrawn.Random` seeded with the element's seed, grows with
  the edge's larger axis span and is capped, so no point lies more than `max_jitter/0` hundredths
  of a pixel outside the exact shape's box on either axis.

  Every value is an integer number of hundredths of a pixel and only integer arithmetic is used
  (truncating `div/2`), so `assets/js/elements/hand_drawn.ts` produces the same strings.
  """

  alias SketchWeb.HandDrawn.Random

  @scale 100
  @half_scale div(@scale, 2)
  @end_divisor 50
  @max_end 200
  @bow_divisor 25
  @max_bow 300
  @kappa 5523
  @kappa_scale 10_000
  @max_jitter @max_end + @max_bow + div(@max_bow, 2)

  @type point :: %{x: integer(), y: integer()}

  @doc "The furthest any path point lies outside the exact shape's box, in hundredths of a pixel."
  @spec max_jitter() :: pos_integer()
  def max_jitter, do: @max_jitter

  @doc "The four edges of the box `[0, width] × [0, height]`."
  @spec rectangle(non_neg_integer(), non_neg_integer(), non_neg_integer()) :: String.t()
  def rectangle(width, height, seed) do
    w = width * @scale
    h = height * @scale
    outline([{0, 0}, {w, 0}, {w, h}, {0, h}], seed)
  end

  @doc "The four edges through the midpoints of the box's sides."
  @spec diamond(non_neg_integer(), non_neg_integer(), non_neg_integer()) :: String.t()
  def diamond(width, height, seed) do
    w = width * @scale
    h = height * @scale
    mid_x = width * @half_scale
    mid_y = height * @half_scale
    outline([{mid_x, 0}, {w, mid_y}, {mid_x, h}, {0, mid_y}], seed)
  end

  @doc "One edge from `start` to `finish`, in whole pixels."
  @spec line(point(), point(), non_neg_integer()) :: String.t()
  def line(start, finish, seed) do
    {strokes, _rng} =
      edge(
        {start.x * @scale, start.y * @scale},
        {finish.x * @scale, finish.y * @scale},
        Random.new(seed)
      )

    Enum.join(strokes, " ")
  end

  @doc "Two closed curves around the ellipse inscribed in the box."
  @spec ellipse(non_neg_integer(), non_neg_integer(), non_neg_integer()) :: String.t()
  def ellipse(width, height, seed) do
    rx = width * @half_scale
    ry = height * @half_scale
    kx = div(rx * @kappa, @kappa_scale)
    ky = div(ry * @kappa, @kappa_scale)
    amplitude = min(div(max(rx, ry), @bow_divisor), @max_bow)

    curve = %{
      anchors: [{2 * rx, ry}, {rx, 2 * ry}, {0, ry}, {rx, 0}, {2 * rx, ry}],
      leaving: [{0, ky}, {-kx, 0}, {0, -ky}, {kx, 0}],
      arriving: [{kx, 0}, {0, ky}, {-kx, 0}, {0, -ky}],
      amplitude: amplitude
    }

    rng = Random.new(seed)
    {first, rng} = closed_curve(curve, rng)
    {second, _rng} = closed_curve(curve, rng)
    first <> " " <> second
  end

  @doc """
  A hundredths value as SVG text: an integer when it is whole, otherwise the whole part, a dot and
  exactly two digits, with a leading minus sign for negative values.
  """
  @spec format(integer()) :: String.t()
  def format(value) when value < 0, do: "-" <> format(-value)
  def format(value) when rem(value, @scale) == 0, do: Integer.to_string(div(value, @scale))

  def format(value) do
    fraction = value |> rem(@scale) |> Integer.to_string() |> String.pad_leading(2, "0")
    "#{div(value, @scale)}.#{fraction}"
  end

  defp outline(vertices, seed) do
    edges = Enum.zip(vertices, tl(vertices) ++ [hd(vertices)])

    {strokes, _rng} =
      Enum.flat_map_reduce(edges, Random.new(seed), fn {start, finish}, rng ->
        edge(start, finish, rng)
      end)

    Enum.join(strokes, " ")
  end

  defp edge({x0, y0} = start, {x1, y1} = finish, rng) do
    dx = x1 - x0
    dy = y1 - y0
    span = max(abs(dx), abs(dy))

    shape = %{
      direction: {dx, dy, span},
      end_amplitude: min(div(span, @end_divisor), @max_end),
      bow_amplitude: min(div(span, @bow_divisor), @max_bow)
    }

    {first, rng} = stroke(start, finish, shape, rng)
    {second, rng} = stroke(start, finish, shape, rng)
    {[first, second], rng}
  end

  defp stroke({x0, y0}, {x1, y1}, shape, rng) do
    %{direction: direction, end_amplitude: end_amplitude, bow_amplitude: bow_amplitude} = shape
    {sx, rng} = jitter(x0, end_amplitude, rng)
    {sy, rng} = jitter(y0, end_amplitude, rng)
    {ex, rng} = jitter(x1, end_amplitude, rng)
    {ey, rng} = jitter(y1, end_amplitude, rng)
    {bow, rng} = Random.offset(rng, bow_amplitude)
    {extra, rng} = Random.offset(rng, div(bow_amplitude, 2))
    {nx1, ny1} = normal(direction, bow)
    {nx2, ny2} = normal(direction, bow + extra)
    c1 = {sx + div(ex - sx, 3) + nx1, sy + div(ey - sy, 3) + ny1}
    c2 = {sx + div(2 * (ex - sx), 3) + nx2, sy + div(2 * (ey - sy), 3) + ny2}
    {"M #{pair({sx, sy})} C #{pair(c1)} #{pair(c2)} #{pair({ex, ey})}", rng}
  end

  defp normal({_dx, _dy, 0}, _bow), do: {0, 0}
  defp normal({dx, dy, span}, bow), do: {div(-dy * bow, span), div(dx * bow, span)}

  defp closed_curve(curve, rng) do
    {anchors, rng} =
      Enum.map_reduce(curve.anchors, rng, fn {x, y}, rng ->
        {jx, rng} = jitter(x, curve.amplitude, rng)
        {jy, rng} = jitter(y, curve.amplitude, rng)
        {{jx, jy}, rng}
      end)

    segments =
      [Enum.drop(anchors, -1), tl(anchors), curve.leaving, curve.arriving]
      |> Enum.zip()
      |> Enum.map_join(" ", fn {from, to, leaving, arriving} ->
        "C #{pair(add(from, leaving))} #{pair(add(to, arriving))} #{pair(to)}"
      end)

    {"M #{pair(hd(anchors))} #{segments}", rng}
  end

  defp jitter(value, amplitude, rng) do
    {offset, rng} = Random.offset(rng, amplitude)
    {value + offset, rng}
  end

  defp add({x, y}, {dx, dy}), do: {x + dx, y + dy}

  defp pair({x, y}), do: "#{format(x)} #{format(y)}"
end
