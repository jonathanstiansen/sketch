defmodule SketchWeb.StylePanel do
  @moduledoc """
  The properties panel (ADR 0006), rendered from the style registry: one group of buttons per style
  property, swatches for colours and segmented buttons for widths and stroke styles. Which groups
  show, and which button is pressed, is client-side UI state owned by the `Canvas` hook, like the
  selected tool: it shows the properties that apply to the selected element or, with no selection,
  to the active drawing tool's kind. A button dispatches `sketch:set-style` to the canvas viewport.
  """
  use SketchWeb, :html

  @swatch_properties [:stroke_color, :fill_color]

  def style_panel(assigns) do
    assigns =
      assign(assigns,
        properties: Sketch.Canvas.style_properties(),
        defaults: Sketch.Canvas.style_defaults()
      )

    ~H"""
    <section
      id="style-panel"
      phx-update="ignore"
      aria-label="Element style"
      hidden
      class="absolute top-3 right-3 z-10 w-56 rounded-xl border border-base-300 bg-base-100 p-3 text-xs shadow-sm"
    >
      <div
        :for={property <- @properties}
        id={"style-#{property}"}
        role="group"
        aria-labelledby={"style-#{property}-label"}
        data-style-property={property}
        class="mb-3 last:mb-0"
      >
        <h3 id={"style-#{property}-label"} class="mb-1 font-medium text-base-content/70">
          {Sketch.Canvas.style_label(property)}
        </h3>
        <div class="flex flex-wrap gap-1">
          <button
            :for={token <- Sketch.Canvas.style_tokens(property)}
            type="button"
            data-style-value={token}
            aria-pressed={to_string(token == @defaults[property])}
            aria-label={Sketch.Canvas.style_label(token)}
            title={Sketch.Canvas.style_label(token)}
            phx-click={set_style(property, token)}
            class={button_class()}
          >
            <.token_icon property={property} token={token} />
          </button>
        </div>
      </div>
    </section>
    """
  end

  attr :property, :atom, required: true
  attr :token, :atom, required: true

  defp token_icon(%{property: property} = assigns) when property in @swatch_properties do
    assigns = assign(assigns, :variable, swatch_variable(assigns.property, assigns.token))

    ~H"""
    <span
      class={["style-swatch", @token == :none && "style-swatch-none"]}
      style={"--swatch: var(#{@variable})"}
      aria-hidden="true"
    />
    """
  end

  defp token_icon(%{property: :stroke_width} = assigns) do
    assigns = assign(assigns, :px, Sketch.Canvas.style_stroke_px(assigns.token))

    ~H"""
    <svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
      <line
        x1="4"
        y1="12"
        x2="20"
        y2="12"
        stroke="currentColor"
        stroke-width={@px}
        stroke-linecap="round"
      />
    </svg>
    """
  end

  defp token_icon(%{property: :stroke_style} = assigns) do
    assigns = assign(assigns, :dash_array, Sketch.Canvas.style_dash_array(assigns.token, :thin))

    ~H"""
    <svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
      <line
        x1="2"
        y1="12"
        x2="22"
        y2="12"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray={@dash_array}
      />
    </svg>
    """
  end

  defp swatch_variable(:stroke_color, token), do: "--palette-stroke-#{token}"
  defp swatch_variable(:fill_color, token), do: "--palette-fill-#{token}"

  defp set_style(property, token) do
    JS.dispatch("sketch:set-style",
      to: "#canvas-viewport",
      detail: %{property: property, value: token}
    )
  end

  defp button_class do
    [
      "grid size-8 place-items-center rounded-lg border border-transparent transition-colors",
      "hover:bg-base-200 aria-pressed:border-primary aria-pressed:bg-primary/15",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    ]
  end
end
