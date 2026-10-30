defmodule SketchWeb.ZoomActions do
  @moduledoc """
  The zoom actions: each action's id, label, icon paths, keyboard chords and the focus contexts
  they work in. The zoom control renders from this list and `mix sketch.gen.manifest` copies the
  ids and labels to the client; the chords reach the client and the shortcuts help through
  `SketchWeb.Shortcuts` (A23). Zoom is local UI state of one view; it is never broadcast or stored.

  `-`, `=` and `0` match `KeyboardEvent.key`; zoom to fit matches `KeyboardEvent.code` (`Digit1`),
  which keeps Shift+1 working on layouts where Shift+1 types another character. `shift: :any` on
  the Ctrl/⌘ chords is because Ctrl+Shift+= is how many layouts type `+`. Only the Ctrl/⌘ chords
  work while text is edited: a plain Shift+1 there types `!`.
  """

  @type t :: %{
          id: String.t(),
          label: String.t(),
          icon: [String.t()],
          contexts: [atom(), ...],
          chords: [map(), ...]
        }

  @actions [
    %{
      id: "zoom_out",
      label: "Zoom out",
      icon: ["M5 12h14"],
      contexts: [:canvas, :editor],
      chords: [
        %{
          key: ["-", "_"],
          code: nil,
          mod: :command,
          shift: :any,
          alt: false,
          keys: ["Ctrl/⌘", "-"]
        }
      ]
    },
    %{
      id: "zoom_in",
      label: "Zoom in",
      icon: ["M5 12h14", "M12 5v14"],
      contexts: [:canvas, :editor],
      chords: [
        %{
          key: ["=", "+"],
          code: nil,
          mod: :command,
          shift: :any,
          alt: false,
          keys: ["Ctrl/⌘", "+"]
        }
      ]
    },
    %{
      id: "zoom_reset",
      label: "Reset zoom to 100%",
      icon: [],
      contexts: [:canvas, :editor],
      chords: [
        %{key: ["0"], code: nil, mod: :command, shift: :any, alt: false, keys: ["Ctrl/⌘", "0"]}
      ]
    },
    %{
      id: "zoom_fit",
      label: "Zoom to fit content",
      icon: [],
      contexts: [:canvas],
      chords: [
        %{key: [], code: "Digit1", mod: :none, shift: true, alt: false, keys: ["Shift", "1"]}
      ]
    }
  ]

  @spec all() :: [t()]
  def all, do: @actions

  @spec get!(String.t()) :: t()
  def get!(id),
    do: Enum.find(@actions, &(&1.id == id)) || raise(ArgumentError, "unknown zoom action #{id}")

  @doc "The zoom shortcuts for `SketchWeb.Shortcuts` (A23)."
  @spec shortcuts() :: [map()]
  def shortcuts do
    for action <- @actions do
      %{
        group: :zoom,
        action: action.id,
        label: action.label,
        contexts: action.contexts,
        chords: action.chords
      }
    end
  end
end
