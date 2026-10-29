defmodule SketchWeb.Toolbar do
  @moduledoc """
  The canvas toolbar and its shortcuts help. The selected tool is client-side UI state owned by
  the `Canvas` hook (`assets/js/hooks/tools.ts` holds the keymap); these components only render it.
  """
  use SketchWeb, :html

  @tools [
    %{id: "hand", label: "Hand", keys: ["H"], enabled: true},
    %{id: "selection", label: "Selection", keys: ["V", "1"], enabled: true},
    %{id: "rectangle", label: "Rectangle", keys: ["R", "2"], enabled: true},
    %{id: "diamond", label: "Diamond", keys: ["D", "3"], enabled: true},
    %{id: "ellipse", label: "Ellipse", keys: ["O", "4"], enabled: true},
    %{id: "arrow", label: "Arrow", keys: ["A", "5"], enabled: false},
    %{id: "line", label: "Line", keys: ["L", "6"], enabled: true},
    %{id: "draw", label: "Draw", keys: ["P", "7"], enabled: false},
    %{id: "text", label: "Text", keys: ["T", "8"], enabled: false},
    %{id: "note", label: "Note", keys: ["N", "9"], enabled: false},
    %{id: "eraser", label: "Eraser", keys: ["E", "0"], enabled: false}
  ]

  @icons %{
    "hand" => [
      "M18 11V6a2 2 0 0 0-4 0v1",
      "M14 10V4a2 2 0 0 0-4 0v2",
      "M10 10.5V6a2 2 0 0 0-4 0v8",
      "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
    ],
    "selection" => [
      "M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"
    ],
    "rectangle" => ["M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"],
    "diamond" => ["M12 3l9 9-9 9-9-9z"],
    "ellipse" => ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"],
    "arrow" => ["M5 19L19 5", "M9 5h10v10"],
    "line" => ["M5 19L19 5"],
    "draw" => [
      "M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"
    ],
    "text" => ["M4 7V4h16v3", "M9 20h6", "M12 4v16"],
    "note" => [
      "M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z",
      "M15 3v4a2 2 0 0 0 2 2h4"
    ],
    "eraser" => [
      "M7 21l-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21",
      "M22 21H7",
      "M5 11l9 9"
    ]
  }

  @help_button "shortcuts-help-button"
  @help_panel "shortcuts-help"

  def toolbar(assigns) do
    assigns = assign(assigns, :tools, @tools)

    ~H"""
    <div class="flex flex-col items-center gap-1">
      <div
        id="toolbar"
        role="toolbar"
        aria-label="Canvas tools"
        class="flex items-center gap-1 rounded-xl border border-base-300 bg-base-100 p-1 shadow-sm"
      >
        <.tool_button :for={tool <- @tools} tool={tool} pressed={tool.id == "selection"} />
        <span class="mx-1 h-6 w-px bg-base-300" aria-hidden="true"></span>
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
        <path :for={path <- icon_paths(@tool.id)} d={path} />
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

  def shortcuts_help(assigns) do
    assigns = assign(assigns, :tools, @tools)

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
        <dt>Move canvas</dt>
        <dd class="flex items-center gap-1"><.key>Space</.key>+ drag</dd>
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

  defp icon_paths(tool_id), do: Map.fetch!(@icons, tool_id)

  defp button_class do
    [
      "relative grid size-9 place-items-center rounded-lg transition-colors",
      "hover:bg-base-200 aria-pressed:bg-primary/15 aria-pressed:text-primary",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    ]
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
