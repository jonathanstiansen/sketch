defmodule SketchWeb.ClipboardActions do
  @moduledoc """
  Duplicate, copy, cut and paste of the selection: each action's id, label and keyboard chords.
  `mix sketch.gen.manifest` copies the ids and labels to the client; the chords reach the client and
  the shortcuts help through `SketchWeb.Shortcuts` (A23). The actions work on the canvas only: while
  a text editor has focus the browser's own copy and paste apply. `mod: :command` means Ctrl on
  Windows and Linux and Command on macOS.

  The system clipboard holds text/plain JSON, `{"type": "sketch/elements", "version": 1,
  "elements": [...]}`, so a copy pastes into another board or tab.
  """

  @type t :: %{id: String.t(), label: String.t(), chords: [map(), ...]}

  @actions [
    %{
      id: "duplicate",
      label: "Duplicate selected",
      chords: [
        %{
          key: ["d"],
          code: nil,
          mod: :command,
          shift: false,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl/⌘", "D"]
        }
      ]
    },
    %{
      id: "copy",
      label: "Copy selected",
      chords: [
        %{
          key: ["c"],
          code: nil,
          mod: :command,
          shift: false,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl/⌘", "C"]
        }
      ]
    },
    %{
      id: "cut",
      label: "Cut selected",
      chords: [
        %{
          key: ["x"],
          code: nil,
          mod: :command,
          shift: false,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl/⌘", "X"]
        }
      ]
    },
    %{
      id: "paste",
      label: "Paste",
      chords: [
        %{
          key: ["v"],
          code: nil,
          mod: :command,
          shift: false,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl/⌘", "V"]
        }
      ]
    }
  ]

  @doc "The shortcut groups this registry owns (A23)."
  @spec shortcut_groups() :: [atom()]
  def shortcut_groups, do: [:clipboard]

  @spec all() :: [t()]
  def all, do: @actions

  @doc "The clipboard shortcuts for `SketchWeb.Shortcuts` (A23)."
  @spec shortcuts() :: [map()]
  def shortcuts do
    for action <- @actions do
      %{
        group: :clipboard,
        action: action.id,
        label: action.label,
        contexts: [:canvas],
        chords: action.chords
      }
    end
  end
end
