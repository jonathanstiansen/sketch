defmodule SketchWeb.Toolbar do
  @moduledoc """
  The canvas toolbar and its shortcuts help, rendered from `SketchWeb.Tools`, the undo and redo
  buttons, rendered from `SketchWeb.HistoryActions` (ADR 0008), and the zoom control, rendered from
  `SketchWeb.ZoomActions`. The selected tool, the undo and redo stacks and the zoom level are
  client-side UI state owned by the `Canvas` hook (`assets/js/hooks/tools.ts` and `zoom_logic.ts`
  read the keymaps from the generated manifest); these components only render them.
  """
  use SketchWeb, :html

  alias SketchWeb.{HistoryActions, ZoomActions}

  @help_button "shortcuts-help-button"
  @help_panel "shortcuts-help"

  def toolbar(assigns) do
    assigns = assign(assigns, :tools, SketchWeb.Tools.all())

    ~H"""
    <div class="flex flex-col items-center gap-1">
      <div
        id="toolbar"
        role="toolbar"
        aria-label="Canvas tools"
        class="flex items-center gap-1 rounded-xl border border-base-300 bg-base-100 p-1 shadow-sm"
      >
        <.tool_button
          :for={tool <- @tools}
          tool={tool}
          pressed={tool.id == SketchWeb.Tools.default_id()}
        />
        <span class="mx-1 h-6 w-px bg-base-300" aria-hidden="true"></span>
        <SketchWeb.ExportMenu.export_button />
        <button
          id={help_button_id()}
          type="button"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="Shift+?"
          aria-expanded="false"
          aria-controls={help_panel_id()}
          phx-click={toggle_help()}
          class={[button_class(), "font-semibold"]}
        >
          ?
        </button>
      </div>
      <p id="canvas-hint" class="text-xs text-base-content/60">
        To move canvas, hold Scroll wheel or Space while dragging, or use the hand tool
      </p>
    </div>
    """
  end

  attr :tool, :map, required: true
  attr :pressed, :boolean, required: true

  defp tool_button(assigns) do
    ~H"""
    <span :if={@tool.id == "selection"} class="mx-1 h-6 w-px bg-base-300" aria-hidden="true"></span>
    <button
      id={"tool-#{@tool.id}"}
      type="button"
      data-tool-button={@tool.id}
      aria-label={@tool.label}
      aria-pressed={to_string(@pressed)}
      aria-keyshortcuts={Enum.join(@tool.keys, " ")}
      aria-disabled={to_string(not @tool.enabled)}
      disabled={not @tool.enabled}
      title={tool_title(@tool)}
      phx-click={@tool.enabled && select_tool(@tool.id)}
      class={button_class()}
    >
      <svg
        viewBox="0 0 24 24"
        class="size-5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path :for={path <- @tool.icon} d={path} />
      </svg>
      <span
        class="absolute right-0.5 bottom-0 text-[0.6rem] leading-none opacity-70"
        aria-hidden="true"
      >
        {List.last(@tool.keys)}
      </span>
    </button>
    """
  end

  def history_controls(assigns) do
    assigns = assign(assigns, :history_actions, HistoryActions.all())

    ~H"""
    <div
      id="history-controls"
      role="group"
      aria-label="History"
      class="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-xl border border-base-300 bg-base-100 p-1 shadow-sm"
    >
      <.history_button :for={action <- @history_actions} action={action} />
    </div>
    """
  end

  attr :action, :map, required: true

  defp history_button(assigns) do
    ~H"""
    <button
      id={"history-#{@action.id}"}
      type="button"
      data-history-action={@action.id}
      aria-label={@action.label}
      aria-keyshortcuts={HistoryActions.aria_keyshortcuts(@action)}
      title={HistoryActions.title(@action)}
      disabled
      phx-click={run_history_action(@action.id)}
      class={button_class()}
    >
      <svg
        viewBox="0 0 24 24"
        class="size-5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path :for={path <- @action.icon} d={path} />
      </svg>
    </button>
    """
  end

  def zoom_controls(assigns) do
    assigns =
      assign(assigns,
        zoom_out: ZoomActions.get!("zoom_out"),
        zoom_in: ZoomActions.get!("zoom_in"),
        zoom_reset: ZoomActions.get!("zoom_reset")
      )

    ~H"""
    <div
      id="zoom-controls"
      role="group"
      aria-label="Zoom"
      phx-update="ignore"
      class="absolute right-6 bottom-6 z-10 flex items-center gap-1 rounded-xl border border-base-300 bg-base-100 p-1 shadow-sm"
    >
      <.zoom_button action={@zoom_out} />
      <button
        id="zoom-reset"
        type="button"
        data-zoom-action={@zoom_reset.id}
        aria-label={@zoom_reset.label}
        aria-keyshortcuts={ZoomActions.aria_keyshortcuts(@zoom_reset)}
        title={ZoomActions.title(@zoom_reset)}
        phx-click={run_zoom_action(@zoom_reset.id)}
        class={[button_class(), "w-14 text-sm tabular-nums"]}
      >
        <span id="zoom-level">100%</span>
      </button>
      <.zoom_button action={@zoom_in} />
    </div>
    """
  end

  attr :action, :map, required: true

  defp zoom_button(assigns) do
    ~H"""
    <button
      id={"zoom-#{String.replace_prefix(@action.id, "zoom_", "")}"}
      type="button"
      data-zoom-action={@action.id}
      aria-label={@action.label}
      aria-keyshortcuts={ZoomActions.aria_keyshortcuts(@action)}
      title={ZoomActions.title(@action)}
      phx-click={run_zoom_action(@action.id)}
      class={button_class()}
    >
      <svg
        viewBox="0 0 24 24"
        class="size-5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path :for={path <- @action.icon} d={path} />
      </svg>
    </button>
    """
  end

  def shortcuts_help(assigns) do
    assigns =
      assign(assigns,
        tools: SketchWeb.Tools.all(),
        history_actions: HistoryActions.all(),
        zoom_actions: ZoomActions.all(),
        export_actions: SketchWeb.ExportActions.with_shortcuts()
      )

    ~H"""
    <section
      id={help_panel_id()}
      aria-label="Keyboard shortcuts"
      data-hide={hide_help()}
      class="absolute top-full right-4 z-20 mt-2 hidden w-80 rounded-xl border border-base-300 bg-base-100 p-4 text-sm shadow-lg"
    >
      <h2 class="mb-2 font-semibold">Keyboard shortcuts</h2>
      <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <%= for tool <- @tools do %>
          <dt class={not tool.enabled && "text-base-content/50"}>
            {tool.label}
            <span :if={not tool.enabled} class="text-xs">coming soon</span>
          </dt>
          <dd class="flex gap-1">
            <.key :for={key <- tool.keys}>{key}</.key>
          </dd>
        <% end %>
        <dt>Delete selected</dt>
        <dd id="shortcut-delete" class="flex gap-1">
          <.key>Delete</.key>
          <.key>Backspace</.key>
        </dd>
        <%= for action <- @history_actions do %>
          <dt>{action.label}</dt>
          <dd id={"shortcut-#{action.id}"} class="flex flex-wrap items-center gap-1">
            <%= for {chord, index} <- Enum.with_index(action.chords) do %>
              <span :if={index > 0} class="text-xs">or</span>
              <.key :for={key <- chord.keys}>{key}</.key>
            <% end %>
          </dd>
        <% end %>
        <%= for action <- @zoom_actions do %>
          <dt>{action.label}</dt>
          <dd id={"shortcut-#{action.id}"} class="flex flex-wrap items-center gap-1">
            <%= for {chord, index} <- Enum.with_index(action.chords) do %>
              <span :if={index > 0} class="text-xs">or</span>
              <.key :for={key <- chord.keys}>{key}</.key>
            <% end %>
          </dd>
        <% end %>
        <dt>Zoom around the pointer</dt>
        <dd class="flex items-center gap-1"><.key>Ctrl/⌘</.key>+ wheel or pinch</dd>
        <dt>Move canvas</dt>
        <dd class="flex items-center gap-1"><.key>Space</.key>+ drag</dd>
        <%= for action <- @export_actions do %>
          <dt>{action.label}</dt>
          <dd class="flex items-center gap-1">
            <.key :for={key <- action.keys}>{key}</.key>
          </dd>
        <% end %>
        <dt>Back to Selection</dt>
        <dd>
          <.key>Esc</.key>
        </dd>
        <dt>This help</dt>
        <dd>
          <.key>?</.key>
        </dd>
      </dl>
    </section>
    """
  end

  slot :inner_block, required: true

  defp key(assigns) do
    ~H"""
    <kbd class="rounded border border-base-300 bg-base-200 px-1.5 font-mono text-xs">
      {render_slot(@inner_block)}
    </kbd>
    """
  end

  defp tool_title(%{enabled: true, label: label, keys: keys}),
    do: "#{label} — #{Enum.join(keys, " or ")}"

  defp tool_title(%{enabled: false, label: label}), do: "#{label} — Coming soon"

  defp button_class do
    [
      "relative grid size-9 place-items-center rounded-lg transition-colors",
      "hover:bg-base-200 aria-pressed:bg-primary/15 aria-pressed:text-primary",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    ]
  end

  defp run_history_action(action_id) do
    JS.dispatch("sketch:history", to: "#canvas-viewport", detail: %{action: action_id})
  end

  defp run_zoom_action(action_id) do
    JS.dispatch("sketch:zoom", to: "#canvas-viewport", detail: %{action: action_id})
  end

  defp select_tool(tool_id) do
    JS.dispatch("sketch:select-tool", to: "#canvas-viewport", detail: %{tool: tool_id})
  end

  defp help_button_id, do: @help_button
  defp help_panel_id, do: @help_panel

  defp toggle_help do
    JS.toggle(to: "##{@help_panel}")
    |> JS.toggle_attribute({"aria-expanded", "true", "false"}, to: "##{@help_button}")
  end

  defp hide_help do
    JS.hide(to: "##{@help_panel}")
    |> JS.set_attribute({"aria-expanded", "false"}, to: "##{@help_button}")
  end
end
