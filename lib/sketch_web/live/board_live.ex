defmodule SketchWeb.BoardLive do
  use SketchWeb, :live_view

  @canvas_width Sketch.Canvas.geometry().canvas_width
  @canvas_height Sketch.Canvas.geometry().canvas_height
  @min_size Sketch.Canvas.geometry().min_size
  @max_points Sketch.Canvas.geometry().max_points
  @kinds Enum.map(Sketch.Canvas.element_kinds(), &Atom.to_string/1)
  @point_kinds Enum.map(Sketch.Canvas.point_kinds(), &Atom.to_string/1)
  @max_text_bytes Sketch.Canvas.geometry().max_text_length * 4
  @max_seed Sketch.Canvas.geometry().max_seed
  @style_properties Sketch.Canvas.style_properties()
  @style_params Enum.map(@style_properties, &{Atom.to_string(&1), &1})
  @stroke_colors Enum.map(Sketch.Canvas.style_tokens(:stroke_color), &Atom.to_string/1)
  @fill_colors Enum.map(Sketch.Canvas.style_tokens(:fill_color), &Atom.to_string/1)
  @stroke_widths Enum.map(Sketch.Canvas.style_tokens(:stroke_width), &Atom.to_string/1)
  @stroke_styles Enum.map(Sketch.Canvas.style_tokens(:stroke_style), &Atom.to_string/1)

  defguardp is_uuid(value) when is_binary(value) and byte_size(value) == 36

  defguardp is_seq(value) when is_integer(value) and value >= 0

  defguardp is_kind(value) when is_binary(value) and value in @kinds

  defguardp is_canvas_point(x, y)
            when is_integer(x) and is_integer(y) and x >= 0 and y >= 0 and x <= @canvas_width and
                   y <= @canvas_height

  defguardp is_seed(value) when is_integer(value) and value >= 0 and value <= @max_seed

  defguardp is_style_token(property, value)
            when (property == :stroke_color and value in @stroke_colors) or
                   (property == :fill_color and value in @fill_colors) or
                   (property == :stroke_width and value in @stroke_widths) or
                   (property == :stroke_style and value in @stroke_styles)

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

    case create_element(socket, "rectangle", box) do
      {%{element: _element} = created, socket} ->
        {:noreply, push_event(socket, "created", created)}

      {_failed, socket} ->
        {:noreply, socket}
    end
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
         {:ok, text} <- text(params),
         {:ok, seed} <- seed(params),
         {:ok, style} <- style(params) do
      shape =
        kind
        |> String.to_existing_atom()
        |> Sketch.Canvas.fit_shape(%{x: x, y: y, width: width, height: height}, points)
        |> Map.merge(text)
        |> Map.merge(seed)
        |> Map.merge(style)

      {reply, socket} = create_element(socket, kind, shape)
      {:noreply, socket} = broadcast_preview(socket, "draw_end", %{drag_id: drag_id})
      {:reply, reply, socket}
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
    with {:ok, seed} <- seed(params),
         {:ok, style} <- style(params) do
      relay_shape(
        socket,
        "draw_preview",
        params,
        %{kind: kind, drag_id: drag_id, seq: seq, x: x, y: y, width: width, height: height}
        |> Map.merge(seed)
        |> Map.merge(style)
      )
    else
      :error -> {:noreply, socket}
    end
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

  def handle_event("cursor", %{"x" => x, "y" => y, "seq" => seq}, socket)
      when is_canvas_point(x, y) and is_seq(seq) do
    %{id: viewer_id, name: name, color: color} = socket.assigns.viewer

    broadcast_preview(socket, "cursor", %{
      viewer_id: viewer_id,
      name: name,
      color: color,
      x: x,
      y: y,
      seq: seq
    })
  end

  def handle_event("cursor_leave", %{"seq" => seq}, socket) when is_seq(seq) do
    broadcast_preview(socket, "cursor_leave", %{viewer_id: socket.assigns.viewer.id, seq: seq})
  end

  def handle_event("erase", %{"element_ids" => element_ids}, socket) when is_list(element_ids) do
    {erased, socket} =
      if Enum.all?(element_ids, &is_uuid/1),
        do: element_ids |> Enum.uniq() |> Enum.flat_map_reduce(socket, &erase_element/2),
        else: {[], socket}

    {:reply, %{erased: erased}, socket}
  end

  def handle_event("erase", _params, socket), do: {:reply, %{erased: []}, socket}

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

  def handle_event("commit_style", %{"element_id" => element_id} = params, socket)
      when is_uuid(element_id) do
    case style(params) do
      {:ok, style} when map_size(style) > 0 ->
        commit(socket, element_id, nil, "Could not restyle element", fn board_id ->
          Sketch.Canvas.commit_style(element_id, board_id, style)
        end)

      _empty_or_invalid ->
        {:noreply, socket}
    end
  end

  def handle_event(event, _params, socket)
      when event in ~w(create_element draw_preview draw_cancel preview drag_cancel cursor cursor_leave commit commit_shape commit_style) do
    {:noreply, socket}
  end

  @impl true
  def handle_info(%Phoenix.Socket.Broadcast{event: event, payload: element}, socket)
      when event in ~w(create commit_position commit_shape commit_style) do
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
      when event in ~w(preview drag_cancel draw_preview draw_end cursor cursor_leave) do
    {:noreply, push_event(socket, event, payload)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <div class="flex h-screen flex-col">
        <div class="relative flex flex-wrap items-center justify-center gap-4 px-4 py-2 md:grid md:grid-cols-[1fr_auto_1fr]">
          <button
            id="add-rectangle"
            class="btn btn-primary md:justify-self-start"
            phx-click="add-rectangle"
          >
            Add rectangle
          </button>
          <SketchWeb.Toolbar.toolbar />
          <p class="min-w-0 text-sm md:justify-self-end md:text-right">
            <span id="viewer-name" class="mr-2 whitespace-nowrap">
              You are
              <span class="font-semibold">
                <span class={"cursor-dot cursor-color-#{@viewer.color}"} aria-hidden="true"></span>
                {@viewer.name}
              </span>
            </span>
            Share this board:
            <a id="board-url" class="link block truncate" href={~p"/b/#{@board_id}"}>
              {url(~p"/b/#{@board_id}")}
            </a>
          </p>
          <SketchWeb.Toolbar.shortcuts_help />
          <SketchWeb.ExportMenu.export_menu board_id={@board_id} />
        </div>
        <div class="relative flex min-h-0 flex-1 flex-col">
          <SketchWeb.StylePanel.style_panel />
          <div
            id="canvas-viewport"
            phx-hook="Canvas"
            data-tool="selection"
            data-canvas-width={@geometry.canvas_width}
            data-canvas-height={@geometry.canvas_height}
            data-max-points={@geometry.max_points}
            data-max-text-length={@geometry.max_text_length}
            data-font-size={@geometry.font_size}
            data-line-height={@geometry.line_height}
            data-note-padding={@geometry.note_padding}
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
                  :for={stroke_color <- @stroke_colors}
                  id={SketchWeb.ElementRenderer.arrowhead_id(stroke_color)}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M0 0L10 5L0 10z" class={"ink-palette-#{stroke_color}"} />
                </marker>
              </defs>
              <g id="elements" phx-update="stream">
                <SketchWeb.Elements.element
                  :for={{dom_id, element} <- @streams.elements}
                  dom_id={dom_id}
                  element={element}
                />
              </g>
              <g id="draw-previews" phx-update="ignore"></g>
              <g id="selection" phx-update="ignore"></g>
              <g id="remote-cursors" phx-update="ignore" pointer-events="none"></g>
            </svg>
            <div id="text-editor-layer" phx-update="ignore" class="absolute top-0 left-0"></div>
          </div>
          <SketchWeb.Toolbar.history_controls />
          <SketchWeb.Toolbar.zoom_controls />
          <p
            id="history-status"
            role="status"
            aria-live="polite"
            phx-update="ignore"
            hidden
            class="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-neutral px-4 py-2 text-sm text-neutral-content shadow-lg"
          >
          </p>
        </div>
      </div>
    </Layouts.app>
    """
  end

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

  defp seed(%{"seed" => seed}) when is_seed(seed), do: {:ok, %{seed: seed}}
  defp seed(%{"seed" => _invalid}), do: :error
  defp seed(_without_seed), do: {:ok, %{}}

  defp style(params) do
    Enum.reduce_while(@style_params, {:ok, %{}}, fn {param, property}, {:ok, style} ->
      case params do
        %{^param => value} when is_style_token(property, value) ->
          {:cont, {:ok, Map.put(style, property, String.to_existing_atom(value))}}

        %{^param => _invalid} ->
          {:halt, :error}

        _without_property ->
          {:cont, {:ok, style}}
      end
    end)
  end

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
      {:ok, element} -> {%{element: Sketch.Canvas.element_event(element)}, socket}
      {:error, _error} -> {%{}, put_flash(socket, :error, "Could not add element")}
    end
  end

  defp erase_element(element_id, socket) do
    case Sketch.Canvas.erase_element(element_id, socket.assigns.board_id, return_destroyed?: true) do
      {:ok, element} ->
        {[Sketch.Canvas.element_event(element)],
         apply_erase(socket, %{id: element_id, board_id: socket.assigns.board_id})}

      {:error, _not_on_this_board} ->
        {[], socket}
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
      do: {:reply, %{ok: false}, socket},
      else:
        socket.assigns.board_id
        |> commit_on_board.()
        |> committed(socket, element_id, drag_id, message)
  end

  defp committed({:ok, _element}, socket, _element_id, _drag_id, _message),
    do: {:reply, %{ok: true}, socket}

  defp committed({:error, _error}, socket, _element_id, nil, message),
    do: {:reply, %{ok: false}, put_flash(socket, :error, message)}

  defp committed({:error, _error}, socket, element_id, drag_id, message) do
    {:noreply, socket} =
      socket
      |> put_flash(:error, message)
      |> push_event("revert", %{element_id: element_id})
      |> broadcast_preview("drag_cancel", %{element_id: element_id, drag_id: drag_id})

    {:reply, %{ok: false}, socket}
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
    |> assign(:viewer, Sketch.Canvas.new_viewer())
    |> assign(:geometry, Sketch.Canvas.geometry())
    |> assign(:stroke_colors, Sketch.Canvas.style_tokens(:stroke_color))
    |> assign(:board_state, Sketch.Canvas.new_board_state(elements))
    |> stream(:elements, elements, dom_id: &element_dom_id(&1.id))
  end
end
