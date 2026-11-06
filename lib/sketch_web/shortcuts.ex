defmodule SketchWeb.Shortcuts do
  @moduledoc """
  Every keyboard shortcut in one list (A23), aggregated at compile time from the registries in
  `registries/0` by `SketchWeb.Shortcuts.Aggregate`, which fails compilation when two actions share
  a chord in focus contexts that can be active at once. The registries also declare the shortcut
  groups (`groups/0`) and focus contexts (`contexts/0`). The shortcuts help renders from this list, the buttons take their
  `aria-keyshortcuts` and titles from it, and `mod: :command` means Ctrl on Windows and Linux and
  Command on macOS. `mix sketch.gen.manifest` writes it to the client as `SHORTCUTS`, which
  `assets/js/hooks/shortcuts.ts` matches key presses against. The registries also declare the
  pointer gestures (`pointer_gestures/0`), which the manifest emits as `POINTER_GESTURES` for
  `pointerAction` in `assets/js/hooks/tools.ts`; their help rows are derived from the same rows.

  A new shortcut goes in its feature's registry (or `SketchWeb.FixedShortcuts`), and a new registry
  goes in `@registries`.
  """

  alias SketchWeb.Shortcuts.Aggregate

  @registries [
    SketchWeb.Tools,
    SketchWeb.HistoryActions,
    SketchWeb.ClipboardActions,
    SketchWeb.SelectionActions,
    SketchWeb.ShapeTextActions,
    SketchWeb.ZoomActions,
    SketchWeb.ExportActions,
    SketchWeb.FixedShortcuts
  ]

  @aggregate Aggregate.aggregate!(@registries)
  @shortcuts @aggregate.entries

  @spec registries() :: [module()]
  def registries, do: @registries

  @doc "The shortcut groups the registries declare, in registry order."
  @spec groups() :: [atom()]
  def groups, do: @aggregate.groups

  @doc "The focus contexts the registries declare, each with the contexts it can be active with."
  @spec contexts() :: [Aggregate.context()]
  def contexts, do: @aggregate.contexts

  @doc "What a press or wheel on the canvas does, in registry order; no two overlap."
  @spec pointer_gestures() :: [Aggregate.gesture()]
  def pointer_gestures, do: @aggregate.gestures

  @doc "Every entry, in help order, including the help rows of gestures, which have no chords."
  @spec all() :: [map()]
  def all, do: @shortcuts

  @doc "The entries a key press can trigger: those with at least one chord."
  @spec keyboard() :: [map()]
  def keyboard, do: Enum.filter(@shortcuts, &(&1.chords != []))

  @spec get(String.t()) :: map() | nil
  def get(action), do: Enum.find(@shortcuts, &(&1.action == action))

  @doc "The keys the help shows for an entry: one list per chord, or its gesture's keys."
  @spec help_keys(map()) :: [[String.t()]]
  def help_keys(%{chords: [], help_keys: keys}) when is_list(keys), do: [keys]
  def help_keys(%{chords: chords}), do: Enum.map(chords, & &1.keys)

  @doc "The `aria-keyshortcuts` value for an action: every chord, with Control and Meta for `:command`."
  @spec aria_keyshortcuts(String.t()) :: String.t() | nil
  def aria_keyshortcuts(action) do
    case get(action) do
      %{chords: [_ | _] = chords} -> Enum.map_join(chords, " ", &aria_chord/1)
      _without_chords -> nil
    end
  end

  @doc "The first chord as the title shows it, for example `Ctrl/⌘+Z`."
  @spec key_hint(String.t()) :: String.t()
  def key_hint(action) do
    %{chords: [chord | _]} = get(action)
    Enum.join(chord.keys, "+")
  end

  @doc "A button title: the label and the first chord."
  @spec title(String.t()) :: String.t()
  def title(action), do: "#{get(action).label} (#{key_hint(action)})"

  defp aria_chord(chord) do
    shift = if chord.shift == true, do: ["Shift"], else: []
    alt = if chord.alt, do: ["Alt"], else: []

    chord.mod
    |> aria_modifiers()
    |> Enum.map_join(" ", &Enum.join(&1 ++ shift ++ alt ++ [aria_key(chord)], "+"))
  end

  defp aria_modifiers(:none), do: [[]]
  defp aria_modifiers(:command), do: [["Control"], ["Meta"]]
  defp aria_modifiers(:ctrl), do: [["Control"]]

  defp aria_key(%{code: "Key" <> letter}), do: letter
  defp aria_key(%{code: "Digit" <> digit}), do: digit
  defp aria_key(%{code: code}) when is_binary(code), do: code
  defp aria_key(%{key: [" " | _]}), do: "Space"

  defp aria_key(%{key: [key | _]}),
    do: if(String.length(key) == 1, do: String.upcase(key), else: String.capitalize(key))
end
