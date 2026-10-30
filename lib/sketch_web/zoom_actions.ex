defmodule SketchWeb.ZoomActions do
  @moduledoc """
  The zoom actions: each action's id, label, icon paths and keyboard chords. The zoom control and
  the shortcuts help render from this list and `mix sketch.gen.manifest` copies it to the client,
  which matches key presses against the chords. Zoom is local UI state of one view; it is never
  broadcast or stored.

  A chord matches `KeyboardEvent.key` (lower-cased, any of `key`) or, when `code` is set,
  `KeyboardEvent.code`, which keeps Shift+1 working on layouts where Shift+1 types another
  character. `mod: true` means Ctrl or Command is held and `mod: false` that neither is. `shift:
  nil` accepts either state of Shift, because Ctrl+Shift+= is how many layouts type `+`.
  """

  @type chord :: %{
          key: [String.t()],
          code: String.t() | nil,
          mod: boolean(),
          shift: boolean() | nil,
          keys: [String.t(), ...]
        }

  @type t :: %{
          id: String.t(),
          label: String.t(),
          icon: [String.t()],
          chords: [chord(), ...]
        }

  @actions [
    %{
      id: "zoom_out",
      label: "Zoom out",
      icon: ["M5 12h14"],
      chords: [%{key: ["-", "_"], code: nil, mod: true, shift: nil, keys: ["Ctrl/⌘", "-"]}]
    },
    %{
      id: "zoom_in",
      label: "Zoom in",
      icon: ["M5 12h14", "M12 5v14"],
      chords: [%{key: ["=", "+"], code: nil, mod: true, shift: nil, keys: ["Ctrl/⌘", "+"]}]
    },
    %{
      id: "zoom_reset",
      label: "Reset zoom to 100%",
      icon: [],
      chords: [%{key: ["0"], code: nil, mod: true, shift: nil, keys: ["Ctrl/⌘", "0"]}]
    },
    %{
      id: "zoom_fit",
      label: "Zoom to fit content",
      icon: [],
      chords: [%{key: [], code: "Digit1", mod: false, shift: true, keys: ["Shift", "1"]}]
    }
  ]

  @spec all() :: [t()]
  def all, do: @actions

  @spec get!(String.t()) :: t()
  def get!(id),
    do: Enum.find(@actions, &(&1.id == id)) || raise(ArgumentError, "unknown zoom action #{id}")

  @doc "The `aria-keyshortcuts` value for an action: every chord, with Control and Meta for `mod`."
  @spec aria_keyshortcuts(t()) :: String.t()
  def aria_keyshortcuts(%{chords: chords}) do
    Enum.map_join(chords, " ", fn chord ->
      Enum.map_join(modifiers(chord), " ", &Enum.join(&1 ++ [aria_key(chord)], "+"))
    end)
  end

  @doc "The button title: the label and its first chord."
  @spec title(t()) :: String.t()
  def title(%{label: label, chords: [chord | _]}), do: "#{label} (#{Enum.join(chord.keys, "+")})"

  defp modifiers(%{mod: true}), do: [["Control"], ["Meta"]]
  defp modifiers(%{shift: true}), do: [["Shift"]]
  defp modifiers(_chord), do: [[]]

  defp aria_key(%{code: "Digit" <> digit}), do: digit
  defp aria_key(%{key: [key | _]}), do: key
end
