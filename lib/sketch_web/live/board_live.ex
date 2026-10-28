defmodule SketchWeb.BoardLive do
  use SketchWeb, :live_view

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
    {x, y} = next_position(map_size(socket.assigns.versions))

    case Sketch.Canvas.create_rectangle(%{board_id: socket.assigns.board_id, x: x, y: y}) do
      {:ok, _rectangle} -> {:noreply, socket}
      {:error, _error} -> {:noreply, put_flash(socket, :error, "Could not add rectangle")}
    end
  end

  @impl true
  def handle_info(%Phoenix.Socket.Broadcast{event: event, payload: rectangle}, socket)
      when event in ~w(create commit_position) do
    if rectangle.version > Map.get(socket.assigns.versions, rectangle.id, -1) do
      {:noreply,
       socket
       |> update(:versions, &Map.put(&1, rectangle.id, rectangle.version))
       |> stream_insert(:rectangles, rectangle)}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <div class="flex flex-col gap-4 p-4">
        <p>
          Share this board:
          <a id="board-url" class="link" href={~p"/b/#{@board_id}"}>{url(~p"/b/#{@board_id}")}</a>
        </p>
        <div>
          <button id="add-rectangle" class="btn btn-primary" phx-click="add-rectangle">
            Add rectangle
          </button>
        </div>
        <svg
          id="canvas"
          viewBox={"0 0 #{@geometry.canvas_width} #{@geometry.canvas_height}"}
          class="w-full max-h-[80vh] border border-base-300 bg-base-100"
        >
          <g id="rectangles" phx-update="stream">
            <rect
              :for={{dom_id, rectangle} <- @streams.rectangles}
              id={dom_id}
              x={rectangle.x}
              y={rectangle.y}
              width={@geometry.rectangle_width}
              height={@geometry.rectangle_height}
              data-x={rectangle.x}
              data-y={rectangle.y}
              data-version={rectangle.version}
              class="fill-primary"
            />
          </g>
        </svg>
      </div>
    </Layouts.app>
    """
  end

  defp load_board(socket, board_id) do
    if connected?(socket),
      do: :ok = SketchWeb.Endpoint.subscribe(Sketch.Canvas.board_topic(board_id))

    rectangles =
      board_id
      |> Sketch.Canvas.list_rectangles_for_board!()
      |> Enum.map(&Sketch.Canvas.rectangle_event/1)

    socket
    |> assign(:board_id, board_id)
    |> assign(:geometry, Sketch.Canvas.geometry())
    |> assign(:versions, Map.new(rectangles, &{&1.id, &1.version}))
    |> stream(:rectangles, rectangles, dom_id: &"rect-#{&1.id}")
  end

  defp next_position(count) do
    offset = rem(count, 20) * @cascade_step
    {100 + offset, 100 + offset}
  end
end
