defmodule SketchWeb.Shortcuts.Aggregate do
  @moduledoc """
  Collects the keyboard shortcuts of every registry into one list for `SketchWeb.Shortcuts` (A23)
  and raises a `CompileError` when two actions share a chord in the same focus context, when an
  action id repeats, or when an entry or chord is malformed.

  A registry is a module with a `shortcuts/0` function returning entries:

      %{
        group: :tool,              # what the client does with it: :tool, :export, :history, :zoom, :canvas, :editor
        action: "rectangle",       # unique across every registry
        label: "Rectangle",
        contexts: [:canvas],       # :canvas (nothing editable has focus) and/or :editor (text entry has focus)
        chords: [chord, ...],      # may be empty for a pointer gesture that only appears in the help
        enabled: true,             # optional, default true
        suffix: nil,               # optional help text after the keys, for example "+ drag"
        help_keys: nil             # optional keys to show when there are no chords
      }

  A chord names exactly one of `key` (any of these `KeyboardEvent.key` values, compared lower-cased)
  or `code` (a `KeyboardEvent.code`, for a physical key):

      %{key: ["z"], code: nil, mod: :command, shift: false, alt: false, keys: ["Ctrl/⌘", "Z"]}

  `mod: :command` is Ctrl or Command, `:ctrl` is Ctrl without Command and `:none` is neither.
  `shift: :any` accepts either state of Shift. `keys` is what the help shows.

  Two chords collide when their contexts share one, they name the same key (`KeyE` is `e` and
  `Digit1` is `1`, case ignored), their `mod` can both hold (`:command` overlaps `:ctrl`), their
  `shift` can both hold (`:any` overlaps either) and their `alt` is equal.
  """

  @contexts [:canvas, :editor]
  @groups [:tool, :export, :history, :zoom, :canvas, :editor]
  @mods [:none, :command, :ctrl]
  @entry_keys [:group, :action, :label, :contexts, :chords]
  @optional_entry_keys [:enabled, :suffix, :help_keys]
  @chord_keys [:key, :code, :mod, :shift, :alt, :keys]

  @spec contexts() :: [atom()]
  def contexts, do: @contexts

  @spec groups() :: [atom()]
  def groups, do: @groups

  @doc "The normalised entries of `registries`, in order, each tagged with its registry."
  @spec aggregate!([module()]) :: [map()]
  def aggregate!(registries) do
    entries =
      for registry <- registries, entry <- registry.shortcuts() do
        entry |> validate_entry!(registry) |> normalise(registry)
      end

    raise_on_duplicate_actions!(entries)
    raise_on_conflicts!(entries)
    entries
  end

  @doc "Every pair of chords bound to different actions that one key press in one context would match."
  @spec conflicts([map()]) :: [{map(), map(), map(), map(), atom()}]
  def conflicts(entries) do
    indexed = Enum.with_index(entries)

    for {a, i} <- indexed,
        {b, j} <- indexed,
        i < j,
        context <- a.contexts,
        context in b.contexts,
        chord_a <- a.chords,
        chord_b <- b.chords,
        collide?(chord_a, chord_b) do
      {a, chord_a, b, chord_b, context}
    end
  end

  defp collide?(a, b) do
    not MapSet.disjoint?(identity(a), identity(b)) and mods_overlap?(a.mod, b.mod) and
      shifts_overlap?(a.shift, b.shift) and a.alt == b.alt
  end

  defp identity(%{code: nil, key: keys}), do: MapSet.new(keys)
  defp identity(%{code: "Key" <> letter}), do: MapSet.new([String.downcase(letter)])
  defp identity(%{code: "Digit" <> digit}), do: MapSet.new([digit])
  defp identity(%{code: code}), do: MapSet.new([String.downcase(code)])

  defp mods_overlap?(same, same), do: true
  defp mods_overlap?(a, b), do: Enum.sort([a, b]) == [:command, :ctrl]

  defp shifts_overlap?(a, b), do: a == :any or b == :any or a == b

  defp normalise(entry, registry) do
    %{enabled: true, suffix: nil, help_keys: nil}
    |> Map.merge(entry)
    |> Map.update!(:chords, &Enum.map(&1, fn chord -> lower_case_keys(chord) end))
    |> Map.put(:registry, registry)
  end

  defp lower_case_keys(chord),
    do: Map.update!(chord, :key, &Enum.map(&1, fn key -> String.downcase(key) end))

  defp raise_on_duplicate_actions!(entries) do
    duplicates =
      entries
      |> Enum.frequencies_by(& &1.action)
      |> Enum.filter(fn {_action, count} -> count > 1 end)
      |> Enum.map(&elem(&1, 0))

    if duplicates != [] do
      raise CompileError,
        description:
          "SketchWeb.Shortcuts declares these action ids more than once: #{inspect(duplicates)}"
    end
  end

  defp raise_on_conflicts!(entries) do
    case conflicts(entries) do
      [] ->
        :ok

      conflicts ->
        raise CompileError,
          description:
            "SketchWeb.Shortcuts has duplicate chords (A23):\n" <>
              Enum.map_join(conflicts, "\n", &describe_conflict/1)
    end
  end

  defp describe_conflict({a, chord_a, b, chord_b, context}) do
    "  #{Enum.join(chord_a.keys, "+")} (#{a.action} in #{inspect(a.registry)}) and " <>
      "#{Enum.join(chord_b.keys, "+")} (#{b.action} in #{inspect(b.registry)}) both match in the #{context} context"
  end

  defp validate_entry!(entry, registry) do
    keys = entry |> Map.keys() |> MapSet.new()
    missing = MapSet.difference(MapSet.new(@entry_keys), keys)
    unknown = MapSet.difference(keys, MapSet.new(@entry_keys ++ @optional_entry_keys))

    cond do
      MapSet.size(missing) > 0 ->
        malformed!(registry, entry, "misses #{inspect(MapSet.to_list(missing))}")

      MapSet.size(unknown) > 0 ->
        malformed!(registry, entry, "has unknown keys #{inspect(MapSet.to_list(unknown))}")

      entry.group not in @groups ->
        malformed!(registry, entry, "has an unknown group")

      not is_binary(entry.action) ->
        malformed!(registry, entry, "needs a string action")

      entry.contexts == [] or entry.contexts -- @contexts != [] ->
        malformed!(registry, entry, "needs contexts from #{inspect(@contexts)}")

      true ->
        Enum.each(entry.chords, &validate_chord!(&1, entry, registry))
    end

    entry
  end

  defp validate_chord!(chord, entry, registry) do
    cond do
      chord |> Map.keys() |> Enum.sort() != Enum.sort(@chord_keys) ->
        malformed!(
          registry,
          entry,
          "has a chord without exactly the keys #{inspect(@chord_keys)}"
        )

      chord.key == [] == is_nil(chord.code) ->
        malformed!(registry, entry, "has a chord that must name either key or code")

      chord.mod not in @mods or chord.shift not in [true, false, :any] or
          not is_boolean(chord.alt) ->
        malformed!(registry, entry, "has a chord with an invalid mod, shift or alt")

      chord.keys == [] ->
        malformed!(registry, entry, "has a chord without keys to show")

      true ->
        :ok
    end
  end

  @spec malformed!(module(), map(), String.t()) :: no_return()
  defp malformed!(registry, entry, problem) do
    raise CompileError,
      description: "#{inspect(registry)} shortcut #{inspect(Map.get(entry, :action))} #{problem}"
  end
end
