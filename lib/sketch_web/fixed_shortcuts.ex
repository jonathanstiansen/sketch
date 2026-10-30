defmodule SketchWeb.FixedShortcuts do
  @moduledoc """
  The shortcuts that belong to no feature registry: deleting the selection, panning with Space,
  Esc on the canvas and in the text editor, and the help itself, plus the Ctrl/⌘ + wheel gesture
  the help lists. `SketchWeb.Shortcuts` aggregates them with the feature registries (A23).

  It also declares the two base focus contexts, which are never active together: `canvas` when
  nothing editable has focus and `editor` while text entry has focus. Both Esc chords ignore held
  modifiers, so Esc cancels a gesture that started with Alt or Shift held.
  """

  @contexts [
    %{id: :canvas, description: "Nothing editable has focus", overlaps: []},
    %{id: :editor, description: "Text entry has focus", overlaps: []}
  ]

  @shortcuts [
    %{
      group: :canvas,
      action: "zoom_wheel",
      label: "Zoom around the pointer",
      contexts: [:canvas],
      chords: [],
      help_keys: ["Ctrl/⌘"],
      suffix: "+ wheel or pinch"
    },
    %{
      group: :canvas,
      action: "pan",
      label: "Move canvas",
      contexts: [:canvas],
      chords: [
        %{
          key: [" "],
          code: nil,
          mod: :none,
          shift: :any,
          alt: false,
          modifiers: :exact,
          keys: ["Space"]
        }
      ],
      suffix: "+ drag"
    },
    %{
      group: :canvas,
      action: "delete",
      label: "Delete selected",
      contexts: [:canvas],
      chords: [
        %{
          key: ["Delete"],
          code: nil,
          mod: :none,
          shift: :any,
          alt: false,
          modifiers: :exact,
          keys: ["Delete"]
        },
        %{
          key: ["Backspace"],
          code: nil,
          mod: :none,
          shift: :any,
          alt: false,
          modifiers: :exact,
          keys: ["Backspace"]
        }
      ]
    },
    %{
      group: :canvas,
      action: "escape",
      label: "Back to Selection",
      contexts: [:canvas],
      chords: [
        %{
          key: ["Escape"],
          code: nil,
          mod: :none,
          shift: :any,
          alt: false,
          modifiers: :any,
          keys: ["Esc"]
        }
      ]
    },
    %{
      group: :editor,
      action: "finish_text",
      label: "Finish editing text",
      contexts: [:editor],
      chords: [
        %{
          key: ["Escape"],
          code: nil,
          mod: :none,
          shift: :any,
          alt: false,
          modifiers: :any,
          keys: ["Esc"]
        }
      ]
    },
    %{
      group: :canvas,
      action: "help",
      label: "This help",
      contexts: [:canvas],
      chords: [
        %{
          key: ["?"],
          code: nil,
          mod: :none,
          shift: :any,
          alt: false,
          modifiers: :exact,
          keys: ["?"]
        }
      ]
    }
  ]

  @spec shortcuts() :: [map()]
  def shortcuts, do: @shortcuts

  @doc "The shortcut groups this registry owns (A23)."
  @spec shortcut_groups() :: [atom()]
  def shortcut_groups, do: [:canvas, :editor]

  @doc "The base focus contexts (A23)."
  @spec shortcut_contexts() :: [SketchWeb.Shortcuts.Aggregate.context()]
  def shortcut_contexts, do: @contexts
end
