defmodule SketchWeb.Shortcuts.Aggregate do
  @moduledoc """
  Collects the keyboard shortcuts, groups and focus contexts of every registry into one aggregate
  for `SketchWeb.Shortcuts` (A23) and raises a `CompileError` when two actions share a chord in
  focus contexts that can be active at once, when an action id, group or context is declared
  twice, when an entry names a group its registry does not declare or a context no registry
  declares, or when an entry, chord or context is malformed.

  A registry is a module with a `shortcuts/0` function returning entries, and optionally
  `shortcut_groups/0` (the groups it owns) and `shortcut_contexts/0` (the focus contexts it
  declares):

      %{
        group: :history,           # one of the groups this registry declares in shortcut_groups/0
        action: "undo",            # unique across every registry
        label: "Undo",
        contexts: [:canvas],       # focus contexts some registry declares in shortcut_contexts/0
        chords: [chord, ...],      # may be empty for a pointer gesture that only appears in the help
        enabled: true,             # optional, default true
        suffix: nil,               # optional help text after the keys, for example "+ drag"
        help_keys: nil             # optional keys to show when there are no chords
      }

  A group tells the client which feature handles the action. A focus context says when the
  shortcut is active; it declares the other contexts that can be active at the same time:

      %{id: :canvas, description: "nothing editable has focus", overlaps: []}

  Overlap is symmetric: declaring it on either side is enough.

  A chord names exactly one of `key` (any of these `KeyboardEvent.key` values, compared lower-cased)
  or `code` (a `KeyboardEvent.code`, for a physical key), and a modifier policy:

      %{key: ["z"], code: nil, mod: :command, shift: false, alt: false, modifiers: :exact,
        keys: ["Ctrl/⌘", "Z"]}

  `mod: :command` is Ctrl or Command, `:ctrl` is Ctrl without Command and `:none` is neither.
  `shift: :any` accepts either state of Shift. `keys` is what the help shows. `modifiers: :exact`
  requires `mod`, `shift` and `alt` as declared; `:ignore_alt` matches with Alt up or down (and
  needs `alt: false`); `:any` matches whatever modifiers are held, for a cancel such as Esc during
  an Alt+drag (and needs `mod: :none`, `shift: :any` and `alt: false`).

  Two chords collide when their contexts can be active at once (the same context, or two that
  overlap), some key press produces a key both accept (`KeyE` is `e`, `Digit1` is `1` and, with
  Shift, `!` as on a US layout; case ignored), and their modifiers can both hold under their
  policies (`:command` overlaps `:ctrl`, Shift `:any` overlaps either, a chord that ignores Alt
  overlaps both Alt states, and `:any` overlaps everything).
  """

  @mods [:none, :command, :ctrl]
  @policies [:exact, :ignore_alt, :any]
  @entry_keys [:group, :action, :label, :contexts, :chords]
  @optional_entry_keys [:enabled, :suffix, :help_keys]
  @chord_keys [:key, :code, :mod, :shift, :alt, :modifiers, :keys]
  @context_keys [:id, :description, :overlaps]

  @code_characters %{
    "Space" => {" ", " "},
    "Minus" => {"-", "_"},
    "Equal" => {"=", "+"},
    "BracketLeft" => {"[", "{"},
    "BracketRight" => {"]", "}"},
    "Backslash" => {"\\", "|"},
    "Semicolon" => {";", ":"},
    "Quote" => {"'", "\""},
    "Backquote" => {"`", "~"},
    "Comma" => {",", "<"},
    "Period" => {".", ">"},
    "Slash" => {"/", "?"}
  }
  @shifted_digits Enum.zip(~w(1 2 3 4 5 6 7 8 9 0), ~w(! @ # $ % ^ & * \( \))) |> Map.new()

  @type context :: %{id: atom(), description: String.t(), overlaps: [atom()]}
  @type t :: %{entries: [map()], groups: [atom()], contexts: [context()]}

  @doc """
  The normalised entries of `registries` in order, each tagged with its registry, with the groups
  and focus contexts the registries declare.
  """
  @spec aggregate!([module()]) :: t()
  def aggregate!(registries) do
    groups = declared!(registries, :shortcut_groups, &validate_group!/2)
    contexts = declared!(registries, :shortcut_contexts, &validate_context!/2)
    group_owners = Map.new(groups, fn {registry, group} -> {group, registry} end)
    contexts = Enum.map(contexts, &elem(&1, 1))
    context_ids = Enum.map(contexts, & &1.id)

    raise_on_unknown_overlaps!(contexts, context_ids)

    entries =
      for registry <- registries, entry <- registry.shortcuts() do
        entry
        |> validate_entry!(registry, group_owners, context_ids)
        |> normalise(registry)
      end

    raise_on_duplicate_actions!(entries)
    raise_on_conflicts!(entries, contexts)

    %{entries: entries, groups: Enum.map(groups, &elem(&1, 1)), contexts: contexts}
  end

  @doc """
  Every pair of chords bound to different actions that one key press would match while both
  actions' contexts are active. `contexts` declares which contexts overlap.
  """
  @spec conflicts([map()], [context()]) :: [{map(), map(), map(), map(), [atom()]}]
  def conflicts(entries, contexts \\ []) do
    together = overlapping_pairs(contexts)
    indexed = Enum.with_index(entries)

    for {a, i} <- indexed,
        {b, j} <- indexed,
        i < j,
        context <- a.contexts,
        context_b <- b.contexts,
        context == context_b or MapSet.member?(together, {context, context_b}),
        chord_a <- a.chords,
        chord_b <- b.chords,
        collide?(chord_a, chord_b) do
      {a, chord_a, b, chord_b, Enum.uniq([context, context_b])}
    end
  end

  @doc "Whether some key press with some held modifiers matches both chords."
  @spec collide?(map(), map()) :: boolean()
  def collide?(a, b) do
    not MapSet.disjoint?(presses(a), presses(b)) and mods_overlap?(a, b) and
      alts_overlap?(a, b)
  end

  defp overlapping_pairs(contexts) do
    for context <- contexts,
        other <- context.overlaps,
        pair <- [{context.id, other}, {other, context.id}],
        into: MapSet.new(),
        do: pair
  end

  defp presses(%{code: nil, key: keys, shift: shift}),
    do: MapSet.new(for key <- keys, held <- shift_states(shift), do: {key, held})

  defp presses(%{code: code, shift: shift}) do
    {base, shifted} = code_characters(code)

    MapSet.new(
      for held <- shift_states(shift),
          key <- if(held, do: [base, shifted], else: [base]),
          do: {key, held}
    )
  end

  defp shift_states(:any), do: [false, true]
  defp shift_states(held), do: [held]

  defp code_characters("Key" <> letter), do: {String.downcase(letter), String.downcase(letter)}

  defp code_characters("Digit" <> digit), do: {digit, Map.fetch!(@shifted_digits, digit)}

  defp code_characters(code) do
    Map.get_lazy(@code_characters, code, fn ->
      named = String.downcase(code)
      {named, named}
    end)
  end

  defp mods_overlap?(%{modifiers: :any}, _b), do: true
  defp mods_overlap?(_a, %{modifiers: :any}), do: true
  defp mods_overlap?(%{mod: same}, %{mod: same}), do: true
  defp mods_overlap?(%{mod: a}, %{mod: b}), do: Enum.sort([a, b]) == [:command, :ctrl]

  defp alts_overlap?(a, b), do: ignores_alt?(a) or ignores_alt?(b) or a.alt == b.alt

  defp ignores_alt?(%{modifiers: policy}), do: policy in [:ignore_alt, :any]

  defp normalise(entry, registry) do
    %{enabled: true, suffix: nil, help_keys: nil}
    |> Map.merge(entry)
    |> Map.update!(:chords, &Enum.map(&1, fn chord -> lower_case_keys(chord) end))
    |> Map.put(:registry, registry)
  end

  defp lower_case_keys(chord),
    do: Map.update!(chord, :key, &Enum.map(&1, fn key -> String.downcase(key) end))

  defp declared!(registries, function, validate) do
    declared =
      for registry <- registries,
          declares?(registry, function),
          item <- apply(registry, function, []) do
        validate.(item, registry)
        {registry, item}
      end

    ids = Enum.map(declared, fn {_registry, item} -> declared_id(item) end)
    repeated = ids |> Enum.frequencies() |> Enum.filter(fn {_id, count} -> count > 1 end)

    if repeated != [] do
      raise CompileError,
        description:
          "SketchWeb.Shortcuts registries declare these #{function} more than once: " <>
            inspect(Enum.map(repeated, &elem(&1, 0)))
    end

    declared
  end

  defp declares?(registry, function),
    do:
      match?({:module, _}, Code.ensure_compiled(registry)) and
        function_exported?(registry, function, 0)

  defp declared_id(%{id: id}), do: id
  defp declared_id(group), do: group

  defp validate_group!(group, _registry) when is_atom(group) and not is_nil(group), do: :ok

  defp validate_group!(group, registry) do
    raise CompileError,
      description:
        "#{inspect(registry)} declares a shortcut group that is not an atom: #{inspect(group)}"
  end

  defp validate_context!(context, registry) do
    valid =
      is_map(context) and Enum.sort(Map.keys(context)) == Enum.sort(@context_keys) and
        is_atom(context.id) and is_binary(context.description) and is_list(context.overlaps) and
        Enum.all?(context.overlaps, &is_atom/1) and context.id not in context.overlaps

    if not valid do
      raise CompileError,
        description:
          "#{inspect(registry)} declares a malformed focus context #{inspect(context)}: it needs " <>
            "exactly #{inspect(@context_keys)}, an atom id, a description and overlaps naming other contexts"
    end
  end

  defp raise_on_unknown_overlaps!(contexts, context_ids) do
    unknown =
      for context <- contexts,
          other <- context.overlaps,
          other not in context_ids,
          do: {context.id, other}

    case unknown do
      [] ->
        :ok

      [{context, other} | _rest] ->
        raise CompileError,
          description:
            "Focus context #{inspect(context)} overlaps #{inspect(other)}, which no registry declares"
    end
  end

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

  defp raise_on_conflicts!(entries, contexts) do
    case conflicts(entries, contexts) do
      [] ->
        :ok

      conflicts ->
        raise CompileError,
          description:
            "SketchWeb.Shortcuts has duplicate chords (A23):\n" <>
              Enum.map_join(conflicts, "\n", &describe_conflict/1)
    end
  end

  defp describe_conflict({a, chord_a, b, chord_b, contexts}) do
    "  #{Enum.join(chord_a.keys, "+")} (#{a.action} in #{inspect(a.registry)}, #{inspect(a.contexts)}) and " <>
      "#{Enum.join(chord_b.keys, "+")} (#{b.action} in #{inspect(b.registry)}, #{inspect(b.contexts)}) " <>
      "both match while #{Enum.map_join(contexts, " and ", &inspect/1)} #{if length(contexts) == 1, do: "is", else: "are"} active"
  end

  defp validate_entry!(entry, registry, group_owners, context_ids) do
    keys = entry |> Map.keys() |> MapSet.new()
    missing = MapSet.difference(MapSet.new(@entry_keys), keys)
    unknown = MapSet.difference(keys, MapSet.new(@entry_keys ++ @optional_entry_keys))

    cond do
      MapSet.size(missing) > 0 ->
        malformed!(registry, entry, "misses #{inspect(MapSet.to_list(missing))}")

      MapSet.size(unknown) > 0 ->
        malformed!(registry, entry, "has unknown keys #{inspect(MapSet.to_list(unknown))}")

      Map.get(group_owners, entry.group) != registry ->
        malformed!(
          registry,
          entry,
          "has group #{inspect(entry.group)}, which #{inspect(registry)} does not declare in shortcut_groups/0"
        )

      not is_binary(entry.action) ->
        malformed!(registry, entry, "needs a string action")

      entry.contexts == [] or entry.contexts -- context_ids != [] ->
        malformed!(registry, entry, "needs contexts from #{inspect(context_ids)}")

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
        not is_boolean(chord.alt) or chord.modifiers not in @policies ->
        malformed!(registry, entry, "has a chord with an invalid mod, shift, alt or modifiers")

      chord.keys == [] ->
        malformed!(registry, entry, "has a chord without keys to show")

      true ->
        validate_policy!(chord, entry, registry)
    end
  end

  defp validate_policy!(chord, entry, registry) do
    if not policy_consistent?(chord) do
      malformed!(
        registry,
        entry,
        "has a chord whose modifiers policy #{inspect(chord.modifiers)} contradicts its mod, shift or alt"
      )
    end
  end

  defp policy_consistent?(%{modifiers: :exact}), do: true
  defp policy_consistent?(%{modifiers: :ignore_alt, alt: alt}), do: alt == false

  defp policy_consistent?(%{modifiers: :any} = chord),
    do: chord.mod == :none and chord.shift == :any and chord.alt == false

  @spec malformed!(module(), map(), String.t()) :: no_return()
  defp malformed!(registry, entry, problem) do
    raise CompileError,
      description: "#{inspect(registry)} shortcut #{inspect(Map.get(entry, :action))} #{problem}"
  end
end
