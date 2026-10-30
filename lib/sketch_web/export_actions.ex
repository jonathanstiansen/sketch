defmodule SketchWeb.ExportActions do
  @moduledoc """
  The export actions, in menu order: each action's id, label and keyboard chords, if it has any.
  The export menu renders from this list and `mix sketch.gen.manifest` copies the ids and labels
  to the client; the chords reach the client and the shortcuts help through `SketchWeb.Shortcuts`
  (A23).
  """

  @type t :: %{id: String.t(), label: String.t(), menu: boolean(), chords: [map()]}

  @actions [
    %{
      id: "open_menu",
      label: "Export",
      menu: false,
      chords: [
        %{
          key: [],
          code: "KeyE",
          mod: :command,
          shift: true,
          alt: false,
          modifiers: :exact,
          keys: ["Ctrl/⌘", "Shift", "E"]
        }
      ]
    },
    %{id: "download_png", label: "Download PNG", menu: true, chords: []},
    %{id: "download_svg", label: "Download SVG", menu: true, chords: []},
    %{
      id: "copy_png",
      label: "Copy as PNG",
      menu: true,
      chords: [
        %{
          key: [],
          code: "KeyC",
          mod: :none,
          shift: true,
          alt: true,
          modifiers: :exact,
          keys: ["Shift", "Alt", "C"]
        }
      ]
    }
  ]

  @doc "The shortcut groups this registry owns (A23)."
  @spec shortcut_groups() :: [atom()]
  def shortcut_groups, do: [:export]

  @spec all() :: [t()]
  def all, do: @actions

  @spec menu() :: [t()]
  def menu, do: Enum.filter(@actions, & &1.menu)

  @doc "The export shortcuts for `SketchWeb.Shortcuts` (A23); they do not fire while text is edited."
  @spec shortcuts() :: [map()]
  def shortcuts do
    for %{chords: [_ | _]} = action <- @actions do
      %{
        group: :export,
        action: action.id,
        label: action.label,
        contexts: [:canvas],
        chords: action.chords
      }
    end
  end
end
