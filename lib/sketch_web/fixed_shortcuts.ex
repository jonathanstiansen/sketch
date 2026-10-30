defmodule SketchWeb.FixedShortcuts do
  @moduledoc """
  The shortcuts that belong to no feature registry: deleting the selection, panning with Space,
  Esc on the canvas and in the text editor, and the help itself, plus the Ctrl/⌘ + wheel gesture
  the help lists. `SketchWeb.Shortcuts` aggregates them with the feature registries (A23).
  """

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
      chords: [%{key: [" "], code: nil, mod: :none, shift: :any, alt: false, keys: ["Space"]}],
      suffix: "+ drag"
    },
    %{
      group: :canvas,
      action: "delete",
      label: "Delete selected",
      contexts: [:canvas],
      chords: [
        %{key: ["Delete"], code: nil, mod: :none, shift: :any, alt: false, keys: ["Delete"]},
        %{key: ["Backspace"], code: nil, mod: :none, shift: :any, alt: false, keys: ["Backspace"]}
      ]
    },
    %{
      group: :canvas,
      action: "escape",
      label: "Back to Selection",
      contexts: [:canvas],
      chords: [%{key: ["Escape"], code: nil, mod: :none, shift: :any, alt: false, keys: ["Esc"]}]
    },
    %{
      group: :editor,
      action: "finish_text",
      label: "Finish editing text",
      contexts: [:editor],
      chords: [%{key: ["Escape"], code: nil, mod: :none, shift: :any, alt: false, keys: ["Esc"]}]
    },
    %{
      group: :canvas,
      action: "help",
      label: "This help",
      contexts: [:canvas],
      chords: [%{key: ["?"], code: nil, mod: :none, shift: :any, alt: false, keys: ["?"]}]
    }
  ]

  @spec shortcuts() :: [map()]
  def shortcuts, do: @shortcuts
end
