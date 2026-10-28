defmodule SketchWeb.BoardLive do
  use SketchWeb, :live_view

  @rectangle_width 120
  @rectangle_height 80
  @max_x 3880
  @max_y 3920
  @cascade_step 150

  @impl true
  def mount(%{"board_id" => board_id}, _session, socket) do
    case Sketch.Canvas.get_board(board_id, not_found_error?: false) do
      {:ok, %{id: id}} -> {:ok, load_board(socket, id)}
      _missing -> {:ok, socket |> put_flash(:error, "Board not found") |> redirect(to: ~p"/")}
    end
  end

  @impl true
  def handle_event("add-rectangle", _params, socket) do
    {x, y} = next_position(socket.assigns.rectangle_count)

    case Sketch.Canvas.create_rectangle(%{board_id: socket.assigns.board_id, x: x, y: y}) do
      {:ok, _rectangle} -> {:noreply, socket}
      {:error, _error} -> {:noreply, put_flash(socket, :error, "Could not add rectangle")}
    end
  end

  @impl true
  def handle_info(%Phoenix.Socket.Broadcast{event: "create", payload: rectangle}, socket) do
    {:noreply,
     socket
     |> update(:rectangle_count, &(&1 + 1))
     |> stream_insert(:rectangles, rectangle)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.flash_group flash={@flash} />
    <div class="flex flex-col gap-4 p-4">
      <div>
        <button id="add-rectangle" class="btn btn-primary" phx-click="add-rectangle">
          Add rectangle
        </button>
      </div>
      <svg
        id="canvas"
        viewBox="0 0 4000 4000"
        class="w-full max-h-[80vh] border border-base-300 bg-base-100"
      >
        <g id="rectangles" phx-update="stream">
          <rect
            :for={{dom_id, rectangle} <- @streams.rectangles}
            id={dom_id}
            x={rectangle.x}
            y={rectangle.y}
            width={rectangle_width()}
            height={rectangle_height()}
            data-x={rectangle.x}
            data-y={rectangle.y}
            data-version={rectangle.version}
            class="fill-primary"
          />
        </g>
      </svg>
    </div>
    """
  end

  defp rectangle_width, do: @rectangle_width
  defp rectangle_height, do: @rectangle_height

  defp load_board(socket, board_id) do
    if connected?(socket), do: :ok = SketchWeb.Endpoint.subscribe("board:#{board_id}")

    rectangles =
      board_id
      |> Sketch.Canvas.list_rectangles_for_board!()
      |> Enum.map(&Map.take(&1, [:id, :board_id, :x, :y, :version]))

    socket
    |> assign(:board_id, board_id)
    |> assign(:rectangle_count, length(rectangles))
    |> stream(:rectangles, rectangles, dom_id: &"rect-#{&1.id}")
  end

  defp next_position(count) do
    offset = rem(count, 20) * @cascade_step
    {min(100 + offset, @max_x), min(100 + offset, @max_y)}
  end
end
