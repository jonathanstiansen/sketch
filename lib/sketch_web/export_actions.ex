defmodule SketchWeb.ExportActions do
  @moduledoc """
  The export actions, in menu order: each action's id, label and keyboard chord, if it has one.
  The export menu and the shortcuts help render from this list and `mix sketch.gen.manifest`
  copies it to the client, which matches key presses against the chords. `mod` means Ctrl on
  Windows and Linux and Command on macOS.
  """

  @type chord :: %{code: String.t(), mod: boolean(), shift: boolean(), alt: boolean()}

  @type t :: %{
          id: String.t(),
          label: String.t(),
          menu: boolean(),
          chord: chord() | nil,
          keys: [String.t()]
        }

  @actions [
    %{
      id: "open_menu",
      label: "Export",
      menu: false,
      chord: %{code: "KeyE", mod: true, shift: true, alt: false},
      keys: ["Ctrl/⌘", "Shift", "E"]
    },
    %{id: "download_png", label: "Download PNG", menu: true, chord: nil, keys: []},
    %{id: "download_svg", label: "Download SVG", menu: true, chord: nil, keys: []},
    %{
      id: "copy_png",
      label: "Copy as PNG",
      menu: true,
      chord: %{code: "KeyC", mod: false, shift: true, alt: true},
      keys: ["Shift", "Alt", "C"]
    }
  ]

  @spec all() :: [t()]
  def all, do: @actions

  @spec menu() :: [t()]
  def menu, do: Enum.filter(@actions, & &1.menu)

  @spec with_shortcuts() :: [t()]
  def with_shortcuts, do: Enum.filter(@actions, &(&1.chord != nil))

  @doc "The `aria-keyshortcuts` value for an action, or nil if it has no chord."
  @spec aria_keyshortcuts(t()) :: String.t() | nil
  def aria_keyshortcuts(%{chord: nil}), do: nil

  def aria_keyshortcuts(%{chord: chord}) do
    modifiers = Enum.filter([chord.shift && "Shift", chord.alt && "Alt"], & &1)
    key = String.replace_prefix(chord.code, "Key", "")

    mods =
      if chord.mod,
        do: [["Control" | modifiers], ["Meta" | modifiers]],
        else: [modifiers]

    Enum.map_join(mods, " ", &Enum.join(&1 ++ [key], "+"))
  end
end
