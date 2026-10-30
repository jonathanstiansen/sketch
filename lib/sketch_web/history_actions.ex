defmodule SketchWeb.HistoryActions do
  @moduledoc """
  Undo and redo (ADR 0008): each action's id, label, icon paths and keyboard chords. The toolbar
  buttons and the shortcuts help render from this list and `mix sketch.gen.manifest` copies it to
  the client, which matches key presses against the chords. A chord's `key` is compared with
  `KeyboardEvent.key`, ignoring case, so it follows the keyboard layout the way the browser's own
  undo does. `mod: :command` means Ctrl on Windows and Linux and Command on macOS; `mod: :ctrl`
  means Ctrl only.
  """

  @type chord :: %{
          key: String.t(),
          mod: :command | :ctrl,
          shift: boolean(),
          keys: [String.t(), ...]
        }

  @type t :: %{
          id: String.t(),
          label: String.t(),
          icon: [String.t(), ...],
          chords: [chord(), ...]
        }

  @actions [
    %{
      id: "undo",
      label: "Undo",
      icon: ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
      chords: [%{key: "z", mod: :command, shift: false, keys: ["Ctrl/⌘", "Z"]}]
    },
    %{
      id: "redo",
      label: "Redo",
      icon: ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
      chords: [
        %{key: "z", mod: :command, shift: true, keys: ["Ctrl/⌘", "Shift", "Z"]},
        %{key: "y", mod: :ctrl, shift: false, keys: ["Ctrl", "Y"]}
      ]
    }
  ]

  @spec all() :: [t()]
  def all, do: @actions

  @doc "The `aria-keyshortcuts` value for an action: every chord, with Control and Meta for `:command`."
  @spec aria_keyshortcuts(t()) :: String.t()
  def aria_keyshortcuts(%{chords: chords}) do
    Enum.map_join(chords, " ", fn chord ->
      shift = if chord.shift, do: ["Shift"], else: []
      key = String.upcase(chord.key)

      chord.mod
      |> modifiers()
      |> Enum.map_join(" ", &Enum.join([&1 | shift] ++ [key], "+"))
    end)
  end

  @doc "The button title: the label and its first chord."
  @spec title(t()) :: String.t()
  def title(%{label: label, chords: [chord | _]}), do: "#{label} (#{Enum.join(chord.keys, "+")})"

  defp modifiers(:command), do: ["Control", "Meta"]
  defp modifiers(:ctrl), do: ["Control"]
end
