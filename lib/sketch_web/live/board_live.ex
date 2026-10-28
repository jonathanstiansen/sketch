defmodule SketchWeb.BoardLive do
  use SketchWeb, :live_view

  @cascade_step 150
  @max_x Sketch.Canvas.geometry().max_x
  @max_y Sketch.Canvas.geometry().max_y

  defguardp is_uuid(value) when is_binary(value) and byte_size(value) == 36

  defguardp is_position(x, y)
            when is_integer(x) and x >= 0 and x <= @max_x and is_integer(y) and y >= 0 and
                   y <= @max_y

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

  def handle_event(
        "preview",
        %{
          "rectangle_id" => rectangle_id,
          "drag_id" => drag_id,
          "seq" => seq,
          "base_version" => base_version,
          "x" => x,
          "y" => y
        },
        socket
      )
      when is_uuid(rectangle_id) and is_uuid(drag_id) and is_integer(seq) and seq >= 0 and
             is_integer(base_version) and base_version >= 0 and is_position(x, y) do
    broadcast_preview(socket, "preview", %{
      rectangle_id: rectangle_id,
      drag_id: drag_id,
      seq: seq,
      base_version: base_version,
      x: x,
      y: y
    })
  end

  def handle_event("drag_cancel", %{"rectangle_id" => rectangle_id, "drag_id" => drag_id}, socket)
      when is_uuid(rectangle_id) and is_uuid(drag_id) do
    broadcast_preview(socket, "drag_cancel", %{rectangle_id: rectangle_id, drag_id: drag_id})
  end

  def handle_event("commit", %{"rectangle_id" => rectangle_id, "x" => x, "y" => y}, socket)
      when is_uuid(rectangle_id) and is_integer(x) and is_integer(y) do
    case Sketch.Canvas.commit_position(rectangle_id, socket.assigns.board_id, %{x: x, y: y}) do
      {:ok, _rectangle} ->
        {:noreply, socket}

      {:error, _error} ->
        {:noreply,
         socket
         |> put_flash(:error, "Could not move rectangle")
         |> push_event("revert", %{rectangle_id: rectangle_id})}
    end
  end

  def handle_event(event, _params, socket) when event in ~w(preview drag_cancel commit) do
    {:noreply, socket}
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

  def handle_info(%Phoenix.Socket.Broadcast{event: event, payload: payload}, socket)
      when event in ~w(preview drag_cancel) do
    {:noreply, push_event(socket, event, payload)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <div class="flex h-screen flex-col">
        <div class="flex flex-wrap items-center gap-4 p-4">
          <button id="add-rectangle" class="btn btn-primary" phx-click="add-rectangle">
            Add rectangle
          </button>
          <p>
            Share this board:
            <a id="board-url" class="link" href={~p"/b/#{@board_id}"}>{url(~p"/b/#{@board_id}")}</a>
          </p>
        </div>
        <div
          id="canvas-viewport"
          phx-hook="Canvas"
          class="min-h-0 flex-1 overflow-auto border-t border-base-300"
        >
          <svg
            id="canvas"
            width={@geometry.canvas_width}
            height={@geometry.canvas_height}
            viewBox={"0 0 #{@geometry.canvas_width} #{@geometry.canvas_height}"}
            class="block select-none bg-base-100"
          >
            <g id="rectangles" phx-update="stream">
              <rect
                :for={{dom_id, rectangle} <- @streams.rectangles}
                id={dom_id}
                x={rectangle.x}
                y={rectangle.y}
                width={@geometry.rectangle_width}
                height={@geometry.rectangle_height}
                data-rect={rectangle.id}
                data-x={rectangle.x}
                data-y={rectangle.y}
                data-version={rectangle.version}
                stroke-width="2"
                class="fill-primary stroke-base-content cursor-grab touch-none"
              />
            </g>
          </svg>
        </div>
      </div>
    </Layouts.app>
    """
  end

  defp broadcast_preview(socket, event, payload) do
    topic = Sketch.Canvas.board_topic(socket.assigns.board_id)
    :ok = SketchWeb.Endpoint.broadcast_from(self(), topic, event, payload)

    {:noreply, socket}
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
