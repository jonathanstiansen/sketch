alias Sketch.Canvas

board = Canvas.create_board!()

wave =
  for step <- 0..18 do
    %{x: step * 10, y: 45 + round(40 * :math.sin(step / 3))}
  end

elements = [
  %{kind: :rectangle, x: 60, y: 60, width: 180, height: 110, seed: 1},
  %{kind: :diamond, x: 290, y: 60, width: 180, height: 110, seed: 2},
  %{kind: :ellipse, x: 520, y: 60, width: 180, height: 110, seed: 3},
  %{
    kind: :note,
    x: 750,
    y: 40,
    width: 200,
    height: 150,
    seed: 4,
    text: "Hand-drawn notes keep crisp text"
  },
  %{
    kind: :line,
    x: 60,
    y: 240,
    width: 180,
    height: 90,
    seed: 5,
    points: [%{x: 0, y: 0}, %{x: 180, y: 90}]
  },
  %{
    kind: :arrow,
    x: 290,
    y: 240,
    width: 180,
    height: 90,
    seed: 6,
    points: [%{x: 0, y: 90}, %{x: 180, y: 0}]
  },
  %{kind: :freedraw, x: 520, y: 240, width: 180, height: 90, seed: 7, points: wave},
  %{kind: :text, x: 750, y: 260, width: 228, height: 25, seed: 8, text: "Text stays as typed"}
]

for element <- elements, do: Canvas.create_element!(Map.put(element, :board_id, board.id))

IO.puts(board.id)
