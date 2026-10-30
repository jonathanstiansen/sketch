defmodule SketchWeb.SelectionActions do
  @moduledoc """
  Multi-select (addendum D13): selecting every element with a chord, and what a press does with the
  Selection tool. The chord reaches the client and the help through `SketchWeb.Shortcuts` (A23); the
  client asks `shortcutFor` and acts only on its own `selection` group. The gestures reach
  `pointerAction` and the help through the same aggregate. Deleting and clearing the selection stay
  with `SketchWeb.FixedShortcuts`. The selection itself is local UI state of the `Canvas` hook,
  never pushed, broadcast or stored (addendum D8).
  """

  @shortcuts [
    %{
      group: :selection,
      action: "select_all",
      label: "Select all",
      contexts: [:canvas],
      chords: [
        %{
          key: ["a"],
          code: nil,
          mod: :command,
          shift: false,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl/⌘", "A"]
        }
      ]
    }
  ]

  @press %{motion: :click, button: :primary, tools: ["selection"], space: false, mod: :any}

  @pointer_gestures [
    Map.merge(@press, %{
      action: "resize",
      motion: :drag,
      target: :handle,
      shift: :any,
      alt: :any
    }),
    Map.merge(@press, %{
      action: "marquee",
      motion: :drag,
      target: :empty,
      shift: :any,
      alt: :any,
      help: %{
        group: :selection,
        action: "select_in_box",
        label: "Select in a box (Shift adds)",
        contexts: [:canvas]
      }
    }),
    Map.merge(@press, %{
      action: "copy",
      motion: :drag,
      target: :element,
      shift: :any,
      alt: true
    }),
    Map.merge(@press, %{
      action: "toggle",
      target: :element,
      shift: true,
      alt: false,
      help: %{
        group: :selection,
        action: "toggle_selected",
        label: "Add to or remove from the selection",
        contexts: [:canvas]
      }
    }),
    Map.merge(@press, %{
      action: "move",
      motion: :drag,
      target: :element,
      shift: false,
      alt: false
    })
  ]

  @doc "The shortcut groups this registry owns (A23)."
  @spec shortcut_groups() :: [atom()]
  def shortcut_groups, do: [:selection]

  @doc "The selection shortcuts for `SketchWeb.Shortcuts` (A23)."
  @spec shortcuts() :: [map()]
  def shortcuts, do: @shortcuts

  @doc "What a press does with the Selection tool (A23)."
  @spec pointer_gestures() :: [SketchWeb.Shortcuts.Aggregate.gesture()]
  def pointer_gestures, do: @pointer_gestures
end
