defmodule SketchWeb.ShapeTextActions do
  @moduledoc """
  Text inside shapes (addendum D19): Enter opens the text editor on the one selected element that
  holds text, a labelled shape (`Sketch.Canvas.Label`) or a note or text element, the same editor a
  double click opens. The chord reaches the client and the help through `SketchWeb.Shortcuts` (A23).
  """

  @shortcuts [
    %{
      group: :shape_text,
      action: "edit_text",
      label: "Edit the selected shape's text",
      contexts: [:canvas],
      chords: [
        %{
          key: ["Enter"],
          code: nil,
          mod: :none,
          shift: false,
          alt: false,
          modifiers: :exact,
          keys: ["Enter"]
        }
      ]
    }
  ]

  @doc "The shortcut groups this registry owns (A23)."
  @spec shortcut_groups() :: [atom()]
  def shortcut_groups, do: [:shape_text]

  @doc "Editing a shape's text for `SketchWeb.Shortcuts` (A23)."
  @spec shortcuts() :: [map()]
  def shortcuts, do: @shortcuts
end
