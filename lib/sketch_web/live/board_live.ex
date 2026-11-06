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
  @max_group_elements 1000
  @cursor_batch_ms 16
  @relayed_events SketchWeb.BoardEvents.relayed_events()
  @ignored_when_malformed Enum.map(SketchWeb.BoardEvents.all(), & &1.event) -- ~w(erase)
  @style_properties Sketch.Canvas.style_properties()
  @binding_ends Sketch.Canvas.binding_ends()
  @anchor_scale Sketch.Canvas.binding_anchor_scale()
  @style_params Enum.map(@style_properties, &{Atom.to_string(&1), &1})

  defguardp is_uuid(value) when is_binary(value) and byte_size(value) == 36

  defguardp is_seq(value) when is_integer(value) and value >= 0

  defguardp is_kind(value) when is_binary(value) and value in @kinds

  defguardp is_canvas_point(x, y)
            when is_integer(x) and is_integer(y) and x >= 0 and y >= 0 and x <= @canvas_width and
                   y <= @canvas_height

  defguardp is_seed(value) when is_integer(value) and value >= 0 and value <= @max_seed

  defguardp is_anchor(value) when is_integer(value) and value >= 0 and value <= @anchor_scale

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
         {:ok, style} <- style(params),
         {:ok, bindings} <- bindings(params, socket.assigns.board_state),
         {:ok, label} <- label(params) do
      shape =
        kind
        |> String.to_existing_atom()
        |> Sketch.Canvas.fit_shape(%{x: x, y: y, width: width, height: height}, points)
        |> Map.merge(text)
        |> Map.merge(seed)
        |> Map.merge(style)
        |> Map.merge(bindings)
        |> Map.merge(label)

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

  def handle_event(
        "group_preview",
        %{"drag_id" => drag_id, "seq" => seq, "elements" => [_ | _] = elements},
        socket
      )
      when is_uuid(drag_id) and is_seq(seq) and length(elements) <= @max_group_elements do
    case group_entries(elements) do
      {:ok, entries} ->
        broadcast_preview(socket, "group_preview", %{
          drag_id: drag_id,
          seq: seq,
          elements: entries
        })

      :error ->
        {:noreply, socket}
    end
  end

  def handle_event(
        "group_cancel",
        %{"drag_id" => drag_id, "element_ids" => [_ | _] = element_ids},
        socket
      )
      when is_uuid(drag_id) and length(element_ids) <= @max_group_elements do
    if Enum.all?(element_ids, &is_uuid/1),
      do:
        broadcast_preview(socket, "group_cancel", %{drag_id: drag_id, element_ids: element_ids}),
      else: {:noreply, socket}
  end

  def handle_event("drag_cancel", %{"element_id" => element_id, "drag_id" => drag_id}, socket)
      when is_uuid(element_id) and is_uuid(drag_id) do
    broadcast_preview(socket, "drag_cancel", %{element_id: element_id, drag_id: drag_id})
  end

  def handle_event("cursor", %{"x" => x, "y" => y, "seq" => seq}, socket)
      when is_canvas_point(x, y) and is_seq(seq) do
    %{id: viewer_id, name: name, color: color} = socket.assigns.viewer
    cursor = %{viewer_id: viewer_id, name: name, color: color, x: x, y: y, seq: seq}

    socket
    |> track_on_canvas(true)
    |> assign(:cursor, cursor)
    |> broadcast_preview("cursors", cursor)
  end

  def handle_event("cursor_leave", %{"seq" => seq}, socket) when is_seq(seq) do
    socket
    |> track_on_canvas(false)
    |> assign(:cursor, nil)
    |> broadcast_preview("cursors", %{viewer_id: socket.assigns.viewer.id, seq: seq, left: true})
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
         {:ok, text} <- text(params),
         {:ok, bindings} <- bindings(params, socket.assigns.board_state),
         {:ok, label} <- label(params) do
      shape =
        %{x: x, y: y, width: width, height: height, points: points}
        |> Map.merge(text)
        |> Map.merge(bindings)
        |> Map.merge(label)

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
      when event in @ignored_when_malformed do
    {:noreply, socket}
  end

  @impl true
  def handle_info(%Phoenix.Socket.Broadcast{event: event, payload: element}, socket)
      when event in ~w(create commit_position commit_shape commit_style freeze_ends) do
    case Sketch.Canvas.apply_board_event(socket.assigns.board_state, element) do
      {:changed, board_state, element} ->
        {:noreply,
         socket
         |> assign(:board_state, board_state)
         |> stream_drawn([element | Sketch.Canvas.board_bound_to(board_state, element.id)])}

      {:unchanged, _board_state} ->
        {:noreply, socket}
    end
  end

  def handle_info(%Phoenix.Socket.Broadcast{event: "erase", payload: erase}, socket) do
    {:noreply, apply_erase(socket, erase)}
  end

  def handle_info(
        %Phoenix.Socket.Broadcast{
          event: "presence_diff",
          payload: %{joins: joins, leaves: leaves}
        },
        socket
      ) do
    own_id = socket.assigns.viewer.id
    joined = Map.delete(joins, own_id)
    left = leaves |> Map.drop([own_id | Map.keys(joins)]) |> Map.keys()
    arrived = joined |> Map.keys() |> Enum.reject(&MapSet.member?(socket.assigns.others, &1))

    socket
    |> forget_viewers(left)
    |> show_viewers(joined)
    |> share_cursor_with(arrived)
  end

  def handle_info(%Phoenix.Socket.Broadcast{event: "cursors", payload: cursor}, socket) do
    {:noreply, queue_cursor(socket, cursor)}
  end

  def handle_info(:flush_cursors, socket), do: {:noreply, flush_cursors(socket)}

  def handle_info(%Phoenix.Socket.Broadcast{event: event, payload: payload}, socket)
      when event in @relayed_events do
    {:noreply, push_event(socket, event, payload)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <div class="flex h-screen flex-col">
        <header
          id="board-header"
          class="relative flex flex-wrap items-center justify-center gap-4 px-4 py-2 min-[960px]:grid min-[960px]:grid-cols-[1fr_auto_1fr]"
        >
          <div class="min-[960px]:col-start-2">
            <SketchWeb.Toolbar.toolbar />
          </div>
          <p class="min-w-0 max-w-full text-sm min-[960px]:justify-self-end min-[960px]:text-right">
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
        </header>
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
              <g id="marquee" phx-update="ignore" pointer-events="none"></g>
              <g id="remote-cursors" phx-update="ignore" pointer-events="none"></g>
            </svg>
            <div id="text-editor-layer" phx-update="ignore" class="absolute top-0 left-0"></div>
          </div>
          <SketchWeb.Toolbar.history_controls />
          <SketchWeb.Toolbar.zoom_controls />
          <div
            id="viewer-roster-card"
            role="group"
            aria-label="Others on this board"
            class="absolute top-12 right-6 z-10 flex items-center rounded-xl border border-base-300 bg-base-100 px-2 py-1.5 text-xs shadow-sm"
          >
            <ul
              id="viewer-roster"
              phx-update="stream"
              class="flex items-center"
            >
              <li id="viewer-roster-empty" class="hidden text-base-content/60 only:block">
                Just you here
              </li>
              <li :for={{dom_id, other} <- @streams.viewers} id={dom_id} class="-ml-1.5 first:ml-0">
                <button
                  type="button"
                  id={"jump-#{dom_id}"}
                  data-viewer={other.id}
                  data-on-canvas={to_string(other.on_canvas)}
                  disabled={not other.on_canvas}
                  title={
                    if(other.on_canvas,
                      do: "Go to #{other.name}",
                      else: "#{other.name} is not on the canvas"
                    )
                  }
                  aria-label={
                    if(other.on_canvas,
                      do: "Go to #{other.name}",
                      else: "#{other.name}, not on the canvas"
                    )
                  }
                  phx-click={jump_to_viewer(other.id)}
                  class={"viewer-avatar cursor-color-#{other.color}"}
                >
                  {initials(other.name)}
                </button>
              </li>
            </ul>
          </div>
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
      case Map.fetch(params, param) do
        {:ok, value} -> put_style_token(style, property, value)
        :error -> {:cont, {:ok, style}}
      end
    end)
  end

  defp put_style_token(style, property, value) do
    case Sketch.Canvas.style_token(property, value) do
      {:ok, token} -> {:cont, {:ok, Map.put(style, property, token)}}
      :error -> {:halt, :error}
    end
  end

  defp group_entries(elements) do
    entries = Enum.map(elements, &group_entry/1)

    if Enum.all?(entries, &match?({:ok, _entry}, &1)),
      do: {:ok, Enum.map(entries, &elem(&1, 1))},
      else: :error
  end

  defp group_entry(
         %{
           "element_id" => element_id,
           "base_version" => base_version,
           "x" => x,
           "y" => y,
           "width" => width,
           "height" => height
         } = params
       )
       when is_uuid(element_id) and is_seq(base_version) and is_box(x, y, width, height) do
    entry = %{
      element_id: element_id,
      base_version: base_version,
      x: x,
      y: y,
      width: width,
      height: height
    }

    case points(params) do
      {:ok, [_ | _] = points} ->
        {:ok, Map.put(entry, :points, points)}

      {:ok, []} when width >= @min_size and height >= @min_size ->
        {:ok, Map.put(entry, :points, [])}

      _invalid ->
        :error
    end
  end

  defp group_entry(_invalid), do: :error

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
      {:ok, element} -> {%{element: drawn_event(socket, element)}, socket}
      {:error, _error} -> {%{}, put_flash(socket, :error, "Could not add element")}
    end
  end

  defp erase_element(element_id, socket) do
    case Sketch.Canvas.erase_element(element_id, socket.assigns.board_id, return_destroyed?: true) do
      {:ok, element} ->
        {[drawn_event(socket, element)],
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
        |> stream_drawn(Sketch.Canvas.board_bound_to(board_state, element_id))
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

  defp join_board(topic, viewer) do
    :ok = SketchWeb.Endpoint.subscribe(topic)
    {:ok, _ref} = SketchWeb.Presence.track(self(), topic, viewer.id, viewer_meta(viewer, false))
    topic |> SketchWeb.Presence.list() |> Map.delete(viewer.id)
  end

  defp viewer_meta(viewer, on_canvas) do
    %{name: viewer.name, color: viewer.color, on_canvas: on_canvas, joined_at: joined_at()}
  end

  defp joined_at, do: System.monotonic_time()

  defp track_on_canvas(%{assigns: %{cursor: cursor}} = socket, on_canvas)
       when is_nil(cursor) == on_canvas do
    %{board_id: board_id, viewer: viewer} = socket.assigns
    topic = Sketch.Canvas.board_topic(board_id)

    {:ok, _ref} =
      SketchWeb.Presence.update(self(), topic, viewer.id, fn meta ->
        %{meta | on_canvas: on_canvas}
      end)

    socket
  end

  defp track_on_canvas(socket, _unchanged), do: socket

  defp show_viewers(socket, presences) do
    presences
    |> Enum.map(fn {id, %{metas: [meta | _older]}} -> Map.put(meta, :id, id) end)
    |> Enum.sort_by(& &1.joined_at)
    |> Enum.reduce(socket, fn viewer, socket ->
      socket
      |> stream_insert(:viewers, Map.take(viewer, [:id, :name, :color, :on_canvas]))
      |> assign(:others, MapSet.put(socket.assigns.others, viewer.id))
    end)
  end

  defp forget_viewers(socket, viewer_ids) do
    Enum.reduce(viewer_ids, socket, fn viewer_id, socket ->
      socket
      |> stream_delete_by_dom_id(:viewers, viewer_dom_id(viewer_id))
      |> assign(:others, MapSet.delete(socket.assigns.others, viewer_id))
      |> push_event("viewer_left", %{viewer_id: viewer_id})
    end)
  end

  defp share_cursor_with(%{assigns: %{cursor: %{} = cursor}} = socket, [_arrived | _more]),
    do: broadcast_preview(socket, "cursors", cursor)

  defp share_cursor_with(socket, _arrived), do: {:noreply, socket}

  defp viewer_dom_id(viewer_id), do: "viewer-#{viewer_id}"

  defp queue_cursor(socket, %{viewer_id: viewer_id} = cursor) do
    pending = Map.update(pending_cursors(socket), viewer_id, cursor, &later_cursor(&1, cursor))

    socket
    |> put_private(:pending_cursors, pending)
    |> schedule_cursor_flush()
  end

  defp schedule_cursor_flush(%{private: %{cursor_flush_scheduled: true}} = socket), do: socket
  defp schedule_cursor_flush(socket), do: flush_cursors_in(socket, cursor_batch_wait(socket))

  defp flush_cursors_in(socket, wait) when wait <= 0, do: flush_cursors(socket)

  defp flush_cursors_in(socket, wait) do
    Process.send_after(self(), :flush_cursors, wait)
    put_private(socket, :cursor_flush_scheduled, true)
  end

  defp pending_cursors(socket), do: Map.get(socket.private, :pending_cursors, %{})

  defp later_cursor(%{seq: held} = current, %{seq: arriving}) when held > arriving, do: current
  defp later_cursor(_current, arriving), do: arriving

  defp cursor_batch_wait(socket) do
    case socket.private[:cursors_flushed_at] do
      nil -> 0
      flushed_at -> flushed_at + @cursor_batch_ms - System.monotonic_time(:millisecond)
    end
  end

  defp flush_cursors(socket) do
    cursors = socket |> pending_cursors() |> Map.values()

    socket
    |> put_private(:pending_cursors, %{})
    |> put_private(:cursor_flush_scheduled, false)
    |> put_private(:cursors_flushed_at, System.monotonic_time(:millisecond))
    |> push_cursors(cursors)
  end

  defp push_cursors(socket, []), do: socket
  defp push_cursors(socket, cursors), do: push_event(socket, "cursors", %{cursors: cursors})

  defp initials(name) do
    name |> String.split() |> Enum.map_join(&String.first/1)
  end

  defp jump_to_viewer(viewer_id) do
    JS.dispatch("sketch:jump-to-viewer", to: "#canvas-viewport", detail: %{viewer_id: viewer_id})
  end

  defp load_board(socket, board_id) do
    topic = Sketch.Canvas.board_topic(board_id)
    viewer = Sketch.Canvas.new_viewer()
    others = if connected?(socket), do: join_board(topic, viewer), else: %{}

    elements =
      board_id
      |> Sketch.Canvas.list_elements_for_board!()
      |> Enum.map(&Sketch.Canvas.element_event/1)

    board_state = Sketch.Canvas.new_board_state(elements)

    socket
    |> assign(:board_id, board_id)
    |> assign(:viewer, viewer)
    |> assign(:cursor, nil)
    |> assign(:others, MapSet.new())
    |> stream_configure(:viewers, dom_id: &viewer_dom_id(&1.id))
    |> stream(:viewers, [])
    |> show_viewers(others)
    |> assign(:geometry, Sketch.Canvas.geometry())
    |> assign(:stroke_colors, Sketch.Canvas.style_tokens(:stroke_color))
    |> assign(:board_state, board_state)
    |> stream(:elements, Enum.map(elements, &Sketch.Canvas.drawn_element(board_state, &1)),
      dom_id: &element_dom_id(&1.id)
    )
  end

  defp stream_drawn(socket, elements) do
    Enum.reduce(elements, socket, fn element, socket ->
      stream_insert(
        socket,
        :elements,
        Sketch.Canvas.drawn_element(socket.assigns.board_state, element)
      )
    end)
  end

  defp drawn_event(socket, element),
    do:
      Sketch.Canvas.drawn_element(
        socket.assigns.board_state,
        Sketch.Canvas.element_event(element)
      )

  defp label(%{"label" => %{"x" => x, "y" => y}}) when is_integer(x) and is_integer(y) do
    %{x: label_x, y: label_y} = Sketch.Canvas.label_clamp(%{x: x, y: y})
    {:ok, %{label_x: label_x, label_y: label_y}}
  end

  defp label(%{"label" => _malformed}), do: :error
  defp label(_params), do: {:ok, %{}}

  defp bindings(params, board_state) do
    Enum.reduce_while(@binding_ends, {:ok, %{}}, fn end_name, {:ok, fields} ->
      case end_binding(Map.fetch(params, "#{end_name}_binding"), board_state) do
        {:ok, binding} -> {:cont, {:ok, Map.merge(fields, binding_fields(end_name, binding))}}
        :error -> {:halt, :error}
      end
    end)
  end

  defp end_binding(:error, _board_state), do: {:ok, :unchanged}
  defp end_binding({:ok, nil}, _board_state), do: {:ok, nil}

  defp end_binding({:ok, %{"target_id" => id, "anchor_x" => x, "anchor_y" => y}}, board_state)
       when is_uuid(id) and is_anchor(x) and is_anchor(y) do
    if Sketch.Canvas.board_binding_target?(board_state, id),
      do: {:ok, %{target: id, anchor_x: x, anchor_y: y}},
      else: {:ok, nil}
  end

  defp end_binding(_malformed, _board_state), do: :error

  defp binding_fields(_end_name, :unchanged), do: %{}

  defp binding_fields(end_name, binding) do
    fields = Sketch.Canvas.binding_fields(end_name)
    Map.new(fields, fn {key, field} -> {field, binding && Map.fetch!(binding, key)} end)
  end
end
