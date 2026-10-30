defmodule SketchWeb.SelectionActions do
  @moduledoc """
  Multi-select (addendum D13): selecting every element with a chord, plus the two pointer gestures
  the shortcuts help lists. The chord reaches the client and the help through `SketchWeb.Shortcuts`
  (A23); the client asks `shortcutFor` and acts only on its own `selection` group. Deleting and
  clearing the selection stay with `SketchWeb.FixedShortcuts`. The selection itself is local UI
  state of the `Canvas` hook, never pushed, broadcast or stored (addendum D8).
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
    },
    %{
      group: :selection,
      action: "toggle_selected",
      label: "Add to or remove from the selection",
      contexts: [:canvas],
      chords: [],
      help_keys: ["Shift"],
      suffix: "+ click"
    },
    %{
      group: :selection,
      action: "select_in_box",
      label: "Select in a box (Shift adds)",
      contexts: [:canvas],
      chords: [],
      help_keys: ["Drag"],
      suffix: "on empty canvas"
    }
  ]

  @doc "The shortcut groups this registry owns (A23)."
  @spec shortcut_groups() :: [atom()]
  def shortcut_groups, do: [:selection]

  @doc "The selection shortcuts for `SketchWeb.Shortcuts` (A23)."
  @spec shortcuts() :: [map()]
  def shortcuts, do: @shortcuts
end
