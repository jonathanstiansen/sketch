defmodule SketchWeb.Shortcuts.Aggregate do
  @moduledoc """
  Collects the keyboard shortcuts, groups and focus contexts of every registry into one aggregate
  for `SketchWeb.Shortcuts` (A23) and raises a `CompileError` when two actions share a chord in
  focus contexts that can be active at once, when an action id, group or context is declared
  twice, when an entry names a group its registry does not declare or a context no registry
  declares, when an entry, chord, context or pointer gesture is malformed, when an entry without
  chords is written by hand, or when two pointer gestures can match one input.

  A registry is a module with a `shortcuts/0` function returning entries, and optionally
  `shortcut_groups/0` (the groups it owns), `shortcut_contexts/0` (the focus contexts it declares)
  and `pointer_gestures/0` (what a press or wheel on the canvas does):

      %{
        group: :history,           # one of the groups this registry declares in shortcut_groups/0
        action: "undo",            # unique across every registry
        label: "Undo",
        contexts: [:canvas],       # focus contexts some registry declares in shortcut_contexts/0
        chords: [chord, ...],      # at least one; a chordless help row comes from a pointer gesture
        enabled: true,             # optional, default true
        suffix: nil                # optional help text after the keys, for example "+ drag"
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

  A pointer gesture is one row of the table `pointerAction` on the client reads, so the action and
  its help come from one declaration:

      %{
        action: "toggle",          # what the canvas hook does; actions may repeat across gestures
        motion: :click,            # :click, :drag or :wheel, what the help calls it
        button: :primary,          # :primary, :middle or :wheel
        tools: ["selection"],      # tool ids from SketchWeb.Tools, or :all
        target: :element,          # :element, :empty, :handle or :any
        space: false,              # Space held: true, false or :any
        shift: true,               # true, false or :any
        alt: false,                # true, false or :any
        mod: :any,                 # :command (Ctrl or Command held) or :any
        help: %{                   # optional: a help row, with keys derived from the fields above
          group: :selection,
          action: "toggle_selected",
          label: "Add to or remove from the selection",
          contexts: [:canvas]
        }
      }

  Two gestures overlap when one input satisfies both, which fails compilation.
  """

  @mods [:none, :command, :ctrl]
  @policies [:exact, :ignore_alt, :any]
  @entry_keys [:group, :action, :label, :contexts, :chords]
  @optional_entry_keys [:enabled, :suffix]
  @chord_keys [:key, :code, :mod, :shift, :alt, :modifiers, :keys]
  @context_keys [:id, :description, :overlaps]
  @gesture_keys [:action, :motion, :button, :tools, :target, :space, :shift, :alt, :mod]
  @gesture_help_keys [:group, :action, :label, :contexts]
  @motion_words %{click: "click", drag: "drag", wheel: "wheel or pinch"}
  @buttons [:primary, :middle, :wheel]
  @targets [:element, :empty, :handle, :any]

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
  @type gesture :: %{
          required(:action) => String.t(),
          required(:motion) => :click | :drag | :wheel,
          required(:button) => :primary | :middle | :wheel,
          required(:tools) => [String.t()] | :all,
          required(:target) => :element | :empty | :handle | :any,
          required(:space) => boolean() | :any,
          required(:shift) => boolean() | :any,
          required(:alt) => boolean() | :any,
          required(:mod) => :command | :any,
          optional(:help) => map(),
          optional(:registry) => module()
        }
  @type t :: %{
          entries: [map()],
          groups: [atom()],
          contexts: [context()],
          gestures: [gesture()]
        }

  @doc """
  The normalised entries of `registries` in order, each tagged with its registry, with the groups,
  focus contexts and pointer gestures the registries declare. A registry's gesture help rows come
  before its chords.
  """
  @spec aggregate!([module()]) :: t()
  def aggregate!(registries) do
    groups = declared!(registries, :shortcut_groups, &validate_group!/2)
    contexts = declared!(registries, :shortcut_contexts, &validate_context!/2)
    group_owners = Map.new(groups, fn {registry, group} -> {group, registry} end)
    contexts = Enum.map(contexts, &elem(&1, 1))
    context_ids = Enum.map(contexts, & &1.id)

    raise_on_unknown_overlaps!(contexts, context_ids)

    gestures = gestures!(registries)
    raise_on_overlapping_gestures!(gestures)

    entries =
      for registry <- registries,
          entry <- gesture_help_entries(gestures, registry) ++ registry.shortcuts() do
        entry
        |> validate_entry!(registry, group_owners, context_ids)
        |> normalise(registry)
      end

    raise_on_duplicate_actions!(entries)
    raise_on_handwritten_chordless!(entries)
    raise_on_conflicts!(entries, contexts)

    %{
      entries: Enum.map(entries, &Map.delete(&1, :from_gesture)),
      groups: Enum.map(groups, &elem(&1, 1)),
      contexts: contexts,
      gestures: gestures
    }
  end

  @doc "Whether one input satisfies both gestures."
  @spec gestures_overlap?(gesture(), gesture()) :: boolean()
  def gestures_overlap?(a, b) do
    a.button == b.button and not disjoint_tools?(a, b) and
      Enum.all?([:target, :space, :shift, :alt, :mod], &field_overlaps?(a[&1], b[&1]))
  end

  defp disjoint_tools?(a, b), do: MapSet.disjoint?(MapSet.new(a.tools), MapSet.new(b.tools))

  defp field_overlaps?(same, same), do: true
  defp field_overlaps?(:any, _other), do: true
  defp field_overlaps?(_other, :any), do: true
  defp field_overlaps?(_a, _b), do: false

  defp gestures!(registries) do
    for registry <- registries,
        declares?(registry, :pointer_gestures),
        gesture <- registry.pointer_gestures() do
      gesture |> validate_gesture!(registry) |> expand_tools() |> Map.put(:registry, registry)
    end
  end

  defp expand_tools(%{tools: :all} = gesture),
    do: %{gesture | tools: Enum.map(SketchWeb.Tools.all(), & &1.id)}

  defp expand_tools(gesture), do: gesture

  defp validate_gesture!(gesture, registry) do
    problem =
      if gesture |> Map.keys() |> List.delete(:help) |> Enum.sort() == Enum.sort(@gesture_keys),
        do: gesture_field_problem(gesture),
        else: "needs exactly the keys #{inspect(@gesture_keys)} and optionally :help"

    if problem do
      raise CompileError,
        description:
          "#{inspect(registry)} has a malformed pointer gesture #{inspect(gesture)}: #{problem}"
    end

    gesture
  end

  defp gesture_field_problem(gesture) do
    [
      {is_binary(gesture.action), "needs a string action"},
      {is_map_key(@motion_words, gesture.motion),
       "needs a motion from #{inspect(Map.keys(@motion_words))}"},
      {gesture.button in @buttons, "needs a button from #{inspect(@buttons)}"},
      {gesture.target in @targets, "needs a target from #{inspect(@targets)}"},
      {gesture_tools?(gesture.tools), "needs tools: :all or a list of tool ids"},
      {unknown_tools(gesture.tools) == [],
       "names tools SketchWeb.Tools does not declare: #{inspect(unknown_tools(gesture.tools))}"},
      {Enum.all?([gesture.space, gesture.shift, gesture.alt], &(&1 in [true, false, :any])),
       "needs space, shift and alt to be true, false or :any"},
      {gesture.mod in [:command, :any], "needs mod to be :command or :any"},
      {gesture_help?(gesture), "needs help with exactly the keys #{inspect(@gesture_help_keys)}"}
    ]
    |> Enum.find_value(fn {valid, problem} -> if not valid, do: problem end)
  end

  defp gesture_tools?(tools), do: tools == :all or (is_list(tools) and tools != [])

  defp unknown_tools(tools) when is_list(tools),
    do: tools -- Enum.map(SketchWeb.Tools.all(), & &1.id)

  defp unknown_tools(_all_or_invalid), do: []

  defp gesture_help?(%{help: help}),
    do: is_map(help) and Enum.sort(Map.keys(help)) == Enum.sort(@gesture_help_keys)

  defp gesture_help?(_without_help), do: true

  defp raise_on_overlapping_gestures!(gestures) do
    indexed = Enum.with_index(gestures)

    overlaps =
      for {a, i} <- indexed, {b, j} <- indexed, i < j, gestures_overlap?(a, b), do: {a, b}

    case overlaps do
      [] ->
        :ok

      [{a, b} | _rest] ->
        raise CompileError,
          description:
            "Pointer gestures #{inspect(a.action)} in #{inspect(a.registry)} and " <>
              "#{inspect(b.action)} in #{inspect(b.registry)} match the same input (A23): " <>
              "#{inspect(Map.delete(a, :registry))} and #{inspect(Map.delete(b, :registry))}"
    end
  end

  defp gesture_help_entries(gestures, registry) do
    for %{registry: ^registry, help: help} = gesture <- gestures do
      {keys, suffix} = help_text(gesture)
      Map.merge(help, %{chords: [], suffix: suffix, from_gesture: keys})
    end
  end

  defp help_text(gesture) do
    motion = Map.fetch!(@motion_words, gesture.motion)

    case modifier_keys(gesture) do
      [] -> {[String.capitalize(motion)], target_phrase(gesture.target)}
      keys -> {keys, ["+ #{motion}", target_phrase(gesture.target)] |> join_words()}
    end
  end

  defp modifier_keys(gesture) do
    mod = if gesture.mod == :command, do: ["Ctrl/⌘"], else: []
    shift = if gesture.shift == true, do: ["Shift"], else: []
    alt = if gesture.alt == true, do: ["Alt"], else: []
    space = if gesture.space == true, do: ["Space"], else: []
    mod ++ space ++ shift ++ alt
  end

  defp target_phrase(:empty), do: "on empty canvas"
  defp target_phrase(:handle), do: "on a handle"
  defp target_phrase(_any_or_element), do: nil

  defp join_words(words), do: words |> Enum.reject(&is_nil/1) |> Enum.join(" ")

  defp raise_on_handwritten_chordless!(entries) do
    case Enum.filter(entries, &(&1.chords == [] and not is_list(&1.from_gesture))) do
      [] ->
        :ok

      [entry | _rest] ->
        raise CompileError,
          description:
            "#{inspect(entry.registry)} entry #{inspect(entry.action)} has no chords; a chordless " <>
              "help row must come from a pointer gesture's help in pointer_gestures/0, so it " <>
              "cannot drift from what the gesture does"
    end
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
    %{enabled: true, suffix: nil, from_gesture: nil}
    |> Map.merge(entry)
    |> Map.update!(:chords, &Enum.map(&1, fn chord -> lower_case_keys(chord) end))
    |> Map.put(:help_keys, entry[:from_gesture])
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
    keys = entry |> Map.delete(:from_gesture) |> Map.keys() |> MapSet.new()
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
