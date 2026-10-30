defmodule SketchWeb.HistoryActions do
  @moduledoc """
  Undo and redo (ADR 0008): each action's id, label, icon paths and keyboard chords. The toolbar
  buttons render from this list and `mix sketch.gen.manifest` copies the ids and labels to the
  client; the chords reach the client and the shortcuts help through `SketchWeb.Shortcuts` (A23).
  A chord's `key` is compared with `KeyboardEvent.key`, ignoring case, so it follows the keyboard
  layout the way the browser's own undo does. `mod: :command` means Ctrl on Windows and Linux and
  Command on macOS; `mod: :ctrl` means Ctrl only.
  """

  @type t :: %{id: String.t(), label: String.t(), icon: [String.t(), ...], chords: [map(), ...]}

  @actions [
    %{
      id: "undo",
      label: "Undo",
      icon: ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
      chords: [
        %{
          key: ["z"],
          code: nil,
          mod: :command,
          shift: false,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl/⌘", "Z"]
        }
      ]
    },
    %{
      id: "redo",
      label: "Redo",
      icon: ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
      chords: [
        %{
          key: ["z"],
          code: nil,
          mod: :command,
          shift: true,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl/⌘", "Shift", "Z"]
        },
        %{
          key: ["y"],
          code: nil,
          mod: :ctrl,
          shift: false,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl", "Y"]
        }
      ]
    }
  ]

  @doc "The shortcut groups this registry owns (A23)."
  @spec shortcut_groups() :: [atom()]
  def shortcut_groups, do: [:history]

  @spec all() :: [t()]
  def all, do: @actions

  @doc "Undo and redo for `SketchWeb.Shortcuts` (A23); an editor keeps its own text undo."
  @spec shortcuts() :: [map()]
  def shortcuts do
    for action <- @actions do
      %{
        group: :history,
        action: action.id,
        label: action.label,
        contexts: [:canvas],
        chords: action.chords
      }
    end
  end
end
