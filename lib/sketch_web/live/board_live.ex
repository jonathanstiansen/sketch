defmodule SketchWeb.BoardLive do
  use SketchWeb, :live_view

  @canvas_width Sketch.Canvas.geometry().canvas_width
  @canvas_height Sketch.Canvas.geometry().canvas_height
  @min_size Sketch.Canvas.geometry().min_size
  @max_points Sketch.Canvas.geometry().max_points
  @kinds Enum.map(Sketch.Canvas.element_kinds(), &Atom.to_string/1)
  @point_kinds Enum.map(Sketch.Canvas.point_kinds(), &Atom.to_string/1)
  @max_text_bytes Sketch.Canvas.geometry().max_text_length * 4
  @font_size Sketch.Canvas.geometry().font_size
  @line_height Sketch.Canvas.geometry().line_height
  @text_baseline Sketch.Canvas.geometry().text_baseline
  @note_padding Sketch.Canvas.geometry().note_padding
  @rendered_kinds Map.from_keys(SketchWeb.Elements.kinds(), true)

  defguardp is_uuid(value) when is_binary(value) and byte_size(value) == 36

  defguardp is_seq(value) when is_integer(value) and value >= 0

  defguardp is_kind(value) when is_binary(value) and value in @kinds

  defguardp is_box(x, y, width, height)
            when is_integer(x) and is_integer(y) and is_integer(width) and is_integer(height) and
                   x >= 0 and y >= 0 and width >= 0 and height >= 0 and
                   x + width <= @canvas_width and y + height <= @canvas_height

  defguardp fits_kind(kind, width, height)
            when kind in @point_kinds or (width >= @min_size and height >= @min_size)

  defguardp is_integer_box(x, y, width, height)
            when is_integer(x) and is_integer(y) and is_integer(width) and is_integer(height)

  @impl true
  def mount(%{"board_id" => board_id}, _session, socket) do
    case Sketch.Canvas.get_board(board_id, not_found_error?: false) do
      {:ok, %{id: id}} -> {:ok, load_board(socket, id)}
      _missing -> {:ok, socket |> put_flash(:error, "Board not found") |> redirect(to: ~p"/")}
    end
  end

  @impl true
  def handle_event("add-rectangle", _params, socket) do
    box =
      socket.assigns.board_state
      |> Sketch.Canvas.board_element_count()
      |> Sketch.Canvas.default_box()

    {:noreply, create_element(socket, "rectangle", box)}
  end

  def handle_event(
        "create_element",
        %{
          "kind" => kind,
          "drag_id" => drag_id,
          "x" => x,
          "y" => y,
          "width" => width,
          "height" => height
        } = params,
        socket
      )
      when is_kind(kind) and is_uuid(drag_id) and is_integer_box(x, y, width, height) do
    with {:ok, points} <- points(params),
         {:ok, text} <- text(params) do
      shape =
        kind
        |> String.to_existing_atom()
        |> Sketch.Canvas.fit_shape(%{x: x, y: y, width: width, height: height}, points)
        |> Map.merge(text)

      socket
      |> create_element(kind, shape)
      |> broadcast_preview("draw_end", %{drag_id: drag_id})
    else
      :error -> {:noreply, socket}
    end
  end

  def handle_event(
        "draw_preview",
        %{
          "kind" => kind,
          "drag_id" => drag_id,
          "seq" => seq,
          "x" => x,
          "y" => y,
          "width" => width,
          "height" => height
        } = params,
        socket
      )
      when is_kind(kind) and is_uuid(drag_id) and is_seq(seq) and is_box(x, y, width, height) and
             fits_kind(kind, width, height) do
    relay_shape(socket, "draw_preview", params, %{
      kind: kind,
      drag_id: drag_id,
      seq: seq,
      x: x,
      y: y,
      width: width,
      height: height
    })
  end

  def handle_event("draw_cancel", %{"drag_id" => drag_id}, socket) when is_uuid(drag_id) do
    broadcast_preview(socket, "draw_end", %{drag_id: drag_id})
  end

  def handle_event(
        "preview",
        %{
          "element_id" => element_id,
          "drag_id" => drag_id,
          "seq" => seq,
          "base_version" => base_version,
          "x" => x,
          "y" => y,
          "width" => width,
          "height" => height
        } = params,
        socket
      )
      when is_uuid(element_id) and is_uuid(drag_id) and is_seq(seq) and is_seq(base_version) and
             is_box(x, y, width, height) do
    relay_shape(socket, "preview", params, %{
      element_id: element_id,
      drag_id: drag_id,
      seq: seq,
      base_version: base_version,
      x: x,
      y: y,
      width: width,
      height: height
    })
  end

  def handle_event("drag_cancel", %{"element_id" => element_id, "drag_id" => drag_id}, socket)
      when is_uuid(element_id) and is_uuid(drag_id) do
    broadcast_preview(socket, "drag_cancel", %{element_id: element_id, drag_id: drag_id})
  end

  def handle_event("erase", %{"element_ids" => element_ids}, socket) when is_list(element_ids) do
    socket =
      if Enum.all?(element_ids, &is_uuid/1),
        do: element_ids |> Enum.uniq() |> Enum.reduce(socket, &erase_element/2),
        else: socket

    {:reply, %{}, socket}
  end

  def handle_event("erase", _params, socket), do: {:reply, %{}, socket}

  def handle_event(
        "commit",
        %{"element_id" => element_id, "drag_id" => drag_id, "x" => x, "y" => y},
        socket
      )
      when is_uuid(element_id) and is_uuid(drag_id) and is_integer(x) and is_integer(y) do
    commit(socket, element_id, drag_id, "Could not move element", fn board_id ->
      Sketch.Canvas.commit_position(element_id, board_id, %{x: x, y: y})
    end)
  end

  def handle_event(
        "commit_shape",
        %{
          "element_id" => element_id,
          "drag_id" => drag_id,
          "x" => x,
          "y" => y,
          "width" => width,
          "height" => height
        } = params,
        socket
      )
      when is_uuid(element_id) and is_uuid(drag_id) and is_integer_box(x, y, width, height) do
    with {:ok, points} <- points(params),
         {:ok, text} <- text(params) do
      shape = Map.merge(%{x: x, y: y, width: width, height: height, points: points}, text)

      commit(socket, element_id, drag_id, commit_shape_error(text), fn board_id ->
        Sketch.Canvas.commit_shape(element_id, board_id, shape)
      end)
    else
      :error -> {:noreply, socket}
    end
  end

  def handle_event(event, _params, socket)
      when event in ~w(create_element draw_preview draw_cancel preview drag_cancel commit commit_shape) do
    {:noreply, socket}
  end

  @impl true
  def handle_info(%Phoenix.Socket.Broadcast{event: event, payload: element}, socket)
      when event in ~w(create commit_position commit_shape) do
    case Sketch.Canvas.apply_board_event(socket.assigns.board_state, element) do
      {:changed, board_state, element} ->
        {:noreply,
         socket
         |> assign(:board_state, board_state)
         |> stream_insert(:elements, element)}

      {:unchanged, _board_state} ->
        {:noreply, socket}
    end
  end

  def handle_info(%Phoenix.Socket.Broadcast{event: "erase", payload: erase}, socket) do
    {:noreply, apply_erase(socket, erase)}
  end

  def handle_info(%Phoenix.Socket.Broadcast{event: event, payload: payload}, socket)
      when event in ~w(preview drag_cancel draw_preview draw_end) do
    {:noreply, push_event(socket, event, payload)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <div class="flex h-screen flex-col">
        <div class="relative flex flex-wrap items-center justify-center gap-4 p-4 md:grid md:grid-cols-[1fr_auto_1fr]">
          <button
            id="add-rectangle"
            class="btn btn-primary md:justify-self-start"
            phx-click="add-rectangle"
          >
            Add rectangle
          </button>
          <SketchWeb.Toolbar.toolbar />
          <p class="min-w-0 text-sm md:justify-self-end md:text-right">
            Share this board:
            <a id="board-url" class="link block truncate" href={~p"/b/#{@board_id}"}>
              {url(~p"/b/#{@board_id}")}
            </a>
          </p>
          <SketchWeb.Toolbar.shortcuts_help />
        </div>
        <div
          id="canvas-viewport"
          phx-hook="Canvas"
          data-tool="selection"
          data-canvas-width={@geometry.canvas_width}
          data-canvas-height={@geometry.canvas_height}
          data-default-width={@geometry.default_width}
          data-default-height={@geometry.default_height}
          data-max-points={@geometry.max_points}
          data-max-text-length={@geometry.max_text_length}
          data-font-size={@geometry.font_size}
          data-line-height={@geometry.line_height}
          data-text-baseline={@geometry.text_baseline}
          data-char-width={@geometry.char_width}
          data-note-padding={@geometry.note_padding}
          data-note-width={@geometry.note_width}
          data-note-height={@geometry.note_height}
          class="relative min-h-0 flex-1 overflow-auto border-t border-base-300"
        >
          <svg
            id="canvas"
            width={@geometry.canvas_width}
            height={@geometry.canvas_height}
            viewBox={"0 0 #{@geometry.canvas_width} #{@geometry.canvas_height}"}
            class="block select-none bg-base-100"
          >
            <defs>
              <marker
                id="arrowhead"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M0 0L10 5L0 10z" class="fill-base-content" />
              </marker>
            </defs>
            <g id="elements" phx-update="stream">
              <.element_shape
                :for={{dom_id, element} <- @streams.elements}
                dom_id={dom_id}
                element={element}
              />
            </g>
            <g id="draw-previews" phx-update="ignore"></g>
            <g id="selection" phx-update="ignore"></g>
          </svg>
          <div id="text-editor-layer" phx-update="ignore" class="absolute top-0 left-0"></div>
        </div>
      </div>
    </Layouts.app>
    """
  end

  attr :dom_id, :string, required: true
  attr :element, :map, required: true

  defp element_shape(%{element: %{kind: kind}} = assigns) when is_map_key(@rendered_kinds, kind),
    do: SketchWeb.Elements.element(assigns)

  defp element_shape(%{element: %{kind: :freedraw}} = assigns) do
    ~H"""
    <g
      id={@dom_id}
      x={@element.x}
      y={@element.y}
      width={@element.width}
      height={@element.height}
      data-element={@element.id}
      data-kind={@element.kind}
      data-x={@element.x}
      data-y={@element.y}
      data-width={@element.width}
      data-height={@element.height}
      data-points={points_attribute(@element.points)}
      data-version={@element.version}
      live-points={points_attribute(@element.points)}
      class="cursor-grab touch-none"
    >
      <.stroke_polyline element={@element} data-freedraw-hit stroke="transparent" stroke-width="14" />
      <.stroke_polyline
        element={@element}
        data-freedraw-stroke
        stroke-width="2"
        pointer-events="none"
        class="stroke-base-content"
      />
    </g>
    """
  end

  defp element_shape(%{element: %{kind: :text}} = assigns) do
    assigns =
      assign(assigns,
        font_size: @font_size,
        lines:
          assigns.element.text
          |> String.split("\n")
          |> Enum.with_index(&{&1, @text_baseline + &2 * @line_height})
      )

    ~H"""
    <g
      id={@dom_id}
      x={@element.x}
      y={@element.y}
      width={@element.width}
      height={@element.height}
      data-element={@element.id}
      data-kind={@element.kind}
      data-x={@element.x}
      data-y={@element.y}
      data-width={@element.width}
      data-height={@element.height}
      data-text={@element.text}
      data-version={@element.version}
      class="cursor-grab touch-none"
    >
      <rect
        data-text-hit
        x={@element.x}
        y={@element.y}
        width={@element.width}
        height={@element.height}
        fill="transparent"
      />
      <text
        data-text-body
        transform={"translate(#{@element.x} #{@element.y})"}
        font-size={@font_size}
        pointer-events="none"
        class="text-element fill-base-content"
      >
        <tspan :for={{line, y} <- @lines} x="0" y={y}>{line}</tspan>
      </text>
    </g>
    """
  end

  defp element_shape(%{element: %{kind: :note}} = assigns) do
    assigns = assign(assigns, font_size: @font_size, padding: @note_padding)

    ~H"""
    <g
      id={@dom_id}
      x={@element.x}
      y={@element.y}
      width={@element.width}
      height={@element.height}
      data-element={@element.id}
      data-kind={@element.kind}
      data-x={@element.x}
      data-y={@element.y}
      data-width={@element.width}
      data-height={@element.height}
      data-text={@element.text}
      data-version={@element.version}
      class="cursor-grab touch-none"
    >
      <rect
        data-note-body
        x={@element.x}
        y={@element.y}
        width={@element.width}
        height={@element.height}
        rx="6"
        stroke-width="2"
        class="note-body"
      />
      <svg
        data-note-clip
        x={@element.x}
        y={@element.y}
        width={@element.width}
        height={@element.height}
        overflow="hidden"
        pointer-events="none"
      >
        <text
          id={"#{@dom_id}-text"}
          data-text-body
          data-note-text
          phx-update="ignore"
          transform={"translate(#{@padding} #{@padding})"}
          font-size={@font_size}
          class="text-element fill-base-content"
        >
        </text>
      </svg>
    </g>
    """
  end

  attr :element, :map, required: true
  attr :rest, :global, include: ~w(stroke stroke-width pointer-events)

  defp stroke_polyline(%{element: %{x: x, y: y, points: points}} = assigns) do
    assigns = assign(assigns, :absolute, Enum.map_join(points, " ", &"#{x + &1.x},#{y + &1.y}"))

    ~H"""
    <polyline
      points={@absolute}
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
      {@rest}
    />
    """
  end

  defp points_attribute(points), do: Enum.map_join(points, " ", &"#{&1.x},#{&1.y}")

  defp points(%{"points" => points}) when is_list(points) and length(points) <= @max_points do
    if Enum.all?(points, &point?/1),
      do: {:ok, Enum.map(points, &%{x: &1["x"], y: &1["y"]})},
      else: :error
  end

  defp points(%{"points" => _invalid}), do: :error
  defp points(_without_points), do: {:ok, []}

  defp point?(%{"x" => x, "y" => y} = point),
    do: map_size(point) == 2 and is_integer(x) and is_integer(y)

  defp point?(_point), do: false

  defp text(%{"text" => text}) when is_binary(text) and byte_size(text) <= @max_text_bytes,
    do: {:ok, %{text: text}}

  defp text(%{"text" => _invalid}), do: :error
  defp text(_without_text), do: {:ok, %{}}

  defp commit_shape_error(%{text: _text}), do: "Could not edit text"
  defp commit_shape_error(_shape), do: "Could not resize element"

  defp relay_shape(socket, event, params, payload) do
    case {points(params), text(params)} do
      {{:ok, [_ | _] = points}, {:ok, text}} ->
        broadcast_preview(socket, event, payload |> Map.put(:points, points) |> Map.merge(text))

      {{:ok, []}, {:ok, text}} when payload.width >= @min_size and payload.height >= @min_size ->
        broadcast_preview(socket, event, payload |> Map.put(:points, []) |> Map.merge(text))

      _invalid ->
        {:noreply, socket}
    end
  end

  defp create_element(socket, kind, shape) do
    case Sketch.Canvas.create_element(
           Map.merge(shape, %{board_id: socket.assigns.board_id, kind: kind})
         ) do
      {:ok, _element} -> socket
      {:error, _error} -> put_flash(socket, :error, "Could not add element")
    end
  end

  defp erase_element(element_id, socket) do
    case Sketch.Canvas.erase_element(element_id, socket.assigns.board_id) do
      :ok -> apply_erase(socket, %{id: element_id, board_id: socket.assigns.board_id})
      {:error, _not_on_this_board} -> socket
    end
  end

  defp apply_erase(socket, %{id: element_id} = erase) do
    case Sketch.Canvas.apply_board_event(socket.assigns.board_state, erase) do
      {:erased, board_state, _erase} ->
        socket
        |> assign(:board_state, board_state)
        |> stream_delete_by_dom_id(:elements, element_dom_id(element_id))
        |> push_event("erased", %{id: element_id})

      {:unchanged, _board_state} ->
        socket
    end
  end

  defp commit(socket, element_id, drag_id, message, commit_on_board) do
    if Sketch.Canvas.board_erased?(socket.assigns.board_state, element_id),
      do: {:noreply, socket},
      else:
        socket.assigns.board_id
        |> commit_on_board.()
        |> committed(socket, element_id, drag_id, message)
  end

  defp committed({:ok, _element}, socket, _element_id, _drag_id, _message), do: {:noreply, socket}

  defp committed({:error, _error}, socket, element_id, drag_id, message) do
    socket
    |> put_flash(:error, message)
    |> push_event("revert", %{element_id: element_id})
    |> broadcast_preview("drag_cancel", %{element_id: element_id, drag_id: drag_id})
  end

  defp broadcast_preview({:noreply, socket}, event, payload),
    do: broadcast_preview(socket, event, payload)

  defp broadcast_preview(socket, event, payload) do
    topic = Sketch.Canvas.board_topic(socket.assigns.board_id)
    :ok = SketchWeb.Endpoint.broadcast_from(self(), topic, event, payload)

    {:noreply, socket}
  end

  defp element_dom_id(element_id), do: "element-#{element_id}"

  defp load_board(socket, board_id) do
    if connected?(socket),
      do: :ok = SketchWeb.Endpoint.subscribe(Sketch.Canvas.board_topic(board_id))

    elements =
      board_id
      |> Sketch.Canvas.list_elements_for_board!()
      |> Enum.map(&Sketch.Canvas.element_event/1)

    socket
    |> assign(:board_id, board_id)
    |> assign(:geometry, Sketch.Canvas.geometry())
    |> assign(:board_state, Sketch.Canvas.new_board_state(elements))
    |> stream(:elements, elements, dom_id: &element_dom_id(&1.id))
  end
end
