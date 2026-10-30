alias Sketch.Canvas

board = Canvas.create_board!()

wave = for step <- 0..18, do: %{x: step * 7, y: 45 + round(40 * :math.sin(step / 3))}

segment = fn width, height, rising ->
  if rising,
    do: [%{x: 0, y: height}, %{x: width, y: 0}],
    else: [%{x: 0, y: 0}, %{x: width, y: height}]
end

shapes =
  for {{fill, stroke, width, style}, index} <-
        Enum.with_index([
          {:auto, :ink, :thin, :solid},
          {:red, :red, :bold, :solid},
          {:green, :green, :thin, :dashed},
          {:blue, :blue, :extra_bold, :dotted},
          {:yellow, :orange, :bold, :dashed},
          {:none, :ink, :thin, :dotted}
        ]) do
    %{
      kind: Enum.at([:rectangle, :diamond, :ellipse], rem(index, 3)),
      x: 40 + index * 165,
      y: 40,
      width: 140,
      height: 95,
      seed: index + 1,
      fill_color: fill,
      stroke_color: stroke,
      stroke_width: width,
      stroke_style: style
    }
  end

strokes =
  for {{kind, stroke, width, style}, index} <-
        Enum.with_index([
          {:line, :ink, :thin, :solid},
          {:arrow, :red, :bold, :solid},
          {:line, :blue, :extra_bold, :dashed},
          {:arrow, :green, :thin, :dotted},
          {:freedraw, :orange, :bold, :solid},
          {:freedraw, :blue, :thin, :dashed}
        ]) do
    points = if kind == :freedraw, do: wave, else: segment.(140, 80, rem(index, 2) == 1)

    %{
      kind: kind,
      x: 40 + index * 165,
      y: 175,
      width: 140,
      height: if(kind == :freedraw, do: 85, else: 80),
      seed: index + 11,
      points: points,
      stroke_color: stroke,
      stroke_width: width,
      stroke_style: style
    }
  end

notes =
  for {{fill, ink}, index} <-
        Enum.with_index([{:auto, :ink}, {:blue, :blue}, {:green, :ink}, {:red, :red}]) do
    %{
      kind: :note,
      x: 40 + index * 205,
      y: 300,
      width: 180,
      height: 110,
      seed: index + 21,
      fill_color: fill,
      stroke_color: ink,
      text: "#{fill} note, #{ink} text"
    }
  end

texts =
  for {ink, index} <- Enum.with_index([:ink, :red, :green, :blue, :orange]) do
    %{kind: :text, x: 40 + index * 150, y: 440, width: 120, height: 25, seed: index, stroke_color: ink, text: "#{ink} text"}
  end

for element <- shapes ++ strokes ++ notes ++ texts,
    do: Canvas.create_element!(Map.put(element, :board_id, board.id))

IO.puts(board.id)
