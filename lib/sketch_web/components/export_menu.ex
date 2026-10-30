defmodule SketchWeb.ExportMenu do
  @moduledoc """
  The export button and menu, rendered from `SketchWeb.ExportActions`. Opening the menu, the
  export itself and the status message are client-side behaviour owned by the `ExportMenu` hook
  (`assets/js/hooks/export_menu.ts`); these components only render the controls.
  """
  use SketchWeb, :html

  alias SketchWeb.ExportActions

  @button "export-button"
  @menu "export-menu"

  def export_button(assigns) do
    assigns = assign(assigns, :action, Enum.find(ExportActions.all(), &(&1.id == "open_menu")))

    ~H"""
    <button
      id={button_id()}
      type="button"
      title={"#{@action.label} (#{Enum.join(@action.keys, "+")})"}
      aria-label={@action.label}
      aria-haspopup="true"
      aria-expanded="false"
      aria-controls={menu_id()}
      aria-keyshortcuts={ExportActions.aria_keyshortcuts(@action)}
      class={[button_class(), "font-semibold"]}
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
        <path d="M12 3v12" />
        <path d="M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
    </button>
    """
  end

  attr :board_id, :string, required: true

  def export_menu(assigns) do
    assigns = assign(assigns, :actions, ExportActions.menu())

    ~H"""
    <div id="export-root" phx-hook="ExportMenu" phx-update="ignore" data-board-id={@board_id}>
      <section
        id={menu_id()}
        aria-label="Export"
        hidden
        class="absolute top-full right-4 z-20 mt-2 w-64 rounded-xl border border-base-300 bg-base-100 p-4 text-sm shadow-lg"
      >
        <h2 class="mb-2 font-semibold">Export</h2>
        <div class="flex flex-col gap-1">
          <button
            :for={action <- @actions}
            type="button"
            data-export-action={action.id}
            aria-keyshortcuts={ExportActions.aria_keyshortcuts(action)}
            class="flex items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
          >
            {action.label}
            <span :if={action.keys != []} class="flex gap-1" aria-hidden="true">
              <kbd
                :for={key <- action.keys}
                class="rounded border border-base-300 bg-base-200 px-1.5 font-mono text-xs"
              >
                {key}
              </kbd>
            </span>
          </button>
        </div>
        <div class="mt-3 flex flex-col gap-2 border-t border-base-300 pt-3">
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              data-export-option="selection"
              disabled
              class="size-4 accent-primary disabled:opacity-40"
            /> Only selected
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              data-export-option="background"
              checked
              class="size-4 accent-primary"
            /> Background
          </label>
        </div>
      </section>
      <p
        id="export-status"
        role="status"
        aria-live="polite"
        hidden
        class="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-neutral px-4 py-2 text-sm text-neutral-content shadow-lg"
      >
      </p>
    </div>
    """
  end

  defp button_class do
    [
      "relative grid size-9 place-items-center rounded-lg transition-colors",
      "hover:bg-base-200 aria-expanded:bg-primary/15 aria-expanded:text-primary",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    ]
  end

  defp button_id, do: @button
  defp menu_id, do: @menu
end
