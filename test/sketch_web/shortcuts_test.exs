defmodule SketchWeb.ShortcutsTest do
  use ExUnit.Case, async: true

  import Phoenix.LiveViewTest

  alias SketchWeb.Shortcuts
  alias SketchWeb.Shortcuts.Aggregate

  @undo_again """
  defmodule SketchWeb.ShortcutsTest.UndoAgain do
    def shortcut_groups, do: [:again]

    def shortcuts do
      [
        %{
          group: :again,
          action: "export_again",
          label: "Export again",
          contexts: [:canvas],
          chords: [%{key: ["Z"], code: nil, mod: :ctrl, shift: false, alt: false, modifiers: :exact, keys: ["Ctrl", "Z"]}]
        }
      ]
    end
  end
  """

  defp chord(fields) do
    Map.merge(
      %{key: [], code: nil, mod: :none, shift: false, alt: false, modifiers: :exact, keys: ["K"]},
      Map.new(fields)
    )
  end

  defp registry(name, body) do
    module = Module.concat(SketchWeb.ShortcutsTest, name)
    Code.compile_string("defmodule #{inspect(module)} do\n#{body}\nend")
    module
  end

  defp context_registry(name, context, overlaps, chord) do
    registry(name, """
    def shortcut_groups, do: [:#{Macro.underscore(name)}]

    def shortcut_contexts,
      do: [%{id: #{inspect(context)}, description: "Something is selected", overlaps: #{inspect(overlaps)}}]

    def shortcuts do
      [%{group: :#{Macro.underscore(name)}, action: "#{Macro.underscore(name)}", label: "X",
         contexts: [#{inspect(context)}], chords: [#{inspect(chord)}]}]
    end
    """)
  end

  test "every registry's chords are aggregated, with no chord twice in contexts active at once (A23)" do
    assert Aggregate.conflicts(Shortcuts.all(), Shortcuts.contexts()) == []

    for registry <- Shortcuts.registries(), entry <- registry.shortcuts() do
      assert Shortcuts.get(entry.action).registry == registry
    end
  end

  test "groups and focus contexts are what the registries declare, each declared once" do
    declared_groups =
      for registry <- Shortcuts.registries(), group <- registry.shortcut_groups(), do: group

    assert Shortcuts.groups() == declared_groups
    assert Enum.map(Shortcuts.contexts(), & &1.id) == [:canvas, :editor]
    assert Shortcuts.get("duplicate").group == :clipboard

    for shortcut <- Shortcuts.all() do
      assert shortcut.group in shortcut.registry.shortcut_groups()
    end
  end

  test "a module whose shortcuts duplicate another registry's chord fails to compile (A23)" do
    error =
      assert_raise CompileError, fn ->
        Code.compile_string("""
        #{@undo_again}
        defmodule SketchWeb.ShortcutsTest.Aggregated do
          @shortcuts SketchWeb.Shortcuts.Aggregate.aggregate!([
            SketchWeb.FixedShortcuts,
            SketchWeb.HistoryActions,
            SketchWeb.ShortcutsTest.UndoAgain
          ])
          def all, do: @shortcuts
        end
        """)
      end

    assert Exception.message(error) =~ "undo in SketchWeb.HistoryActions"
    assert Exception.message(error) =~ "export_again in SketchWeb.ShortcutsTest.UndoAgain"
    assert Exception.message(error) =~ "both match while :canvas is active"
  end

  test "a new context that can be active with canvas fails to compile on a canvas chord, one that cannot compiles (A23)" do
    ctrl_z = chord(key: ["z"], mod: :command, keys: ["Ctrl/⌘", "Z"])
    overlapping = context_registry("SelectionOnly", :selection, [:canvas], ctrl_z)
    separate = context_registry("DialogOnly", :dialog, [], ctrl_z)

    error =
      assert_raise CompileError, fn ->
        Aggregate.aggregate!([SketchWeb.FixedShortcuts, SketchWeb.HistoryActions, overlapping])
      end

    assert Exception.message(error) =~ "undo in SketchWeb.HistoryActions, [:canvas]"

    assert Exception.message(error) =~
             "selection_only in SketchWeb.ShortcutsTest.SelectionOnly, [:selection]"

    aggregate =
      Aggregate.aggregate!([SketchWeb.FixedShortcuts, SketchWeb.HistoryActions, separate])

    assert Enum.map(aggregate.contexts, & &1.id) == [:canvas, :editor, :dialog]
  end

  test "groups and contexts are validated: owned by the entry's registry, declared once, overlapping known contexts" do
    stray =
      registry("StrayGroup", """
      def shortcuts, do: [%{group: :history, action: "stray", label: "X", contexts: [:canvas], chords: []}]
      """)

    twice = registry("HistoryTwice", "def shortcut_groups, do: [:history]\ndef shortcuts, do: []")

    unknown_overlap =
      registry("UnknownOverlap", """
      def shortcut_contexts, do: [%{id: :menu, description: "A menu is open", overlaps: [:nowhere]}]
      def shortcuts, do: []
      """)

    unknown_context =
      registry("UnknownContext", """
      def shortcut_groups, do: [:unknown_context]
      def shortcuts, do: [%{group: :unknown_context, action: "u", label: "U", contexts: [:nowhere], chords: []}]
      """)

    base = [SketchWeb.FixedShortcuts, SketchWeb.HistoryActions]

    assert_raise CompileError,
                 ~r/group :history, which SketchWeb.ShortcutsTest.StrayGroup does not declare/,
                 fn ->
                   Aggregate.aggregate!(base ++ [stray])
                 end

    assert_raise CompileError, ~r/shortcut_groups more than once: \[:history\]/, fn ->
      Aggregate.aggregate!(base ++ [twice])
    end

    assert_raise CompileError, ~r/:menu overlaps :nowhere, which no registry declares/, fn ->
      Aggregate.aggregate!(base ++ [unknown_overlap])
    end

    assert_raise CompileError, ~r/needs contexts from \[:canvas, :editor\]/, fn ->
      Aggregate.aggregate!(base ++ [unknown_context])
    end
  end

  test "a key and a physical code for the same key collide, and so do Ctrl and Ctrl/⌘" do
    by_code = chord(code: "KeyZ", mod: :command)
    by_key = chord(key: ["z"], mod: :ctrl, shift: :any)
    digit = chord(code: "Digit1", shift: true)
    any_one = chord(key: ["1"], shift: :any)

    entries = fn a, b, contexts ->
      [
        %{action: "a", contexts: [:canvas], chords: [a]},
        %{action: "b", contexts: contexts, chords: [b]}
      ]
    end

    assert [_] = Aggregate.conflicts(entries.(by_code, by_key, [:canvas]))
    assert [_] = Aggregate.conflicts(entries.(digit, any_one, [:canvas]))
    assert [] = Aggregate.conflicts(entries.(digit, any_one, [:editor]))
    assert [] = Aggregate.conflicts(entries.(digit, %{any_one | alt: true}, [:canvas]))
    assert [] = Aggregate.conflicts(entries.(by_code, %{by_key | mod: :none}, [:canvas]))
  end

  test "collisions follow the modifier policy and the characters a physical key types" do
    esc = fn fields -> chord([key: ["escape"]] ++ fields) end
    cancel = esc.(modifiers: :any, shift: :any)

    table = [
      {"Esc ignoring modifiers and Alt+Esc", cancel, esc.(alt: true), true},
      {"Esc ignoring modifiers and Ctrl/⌘+Shift+Esc", cancel, esc.(mod: :command, shift: true),
       true},
      {"Esc ignoring Alt and Alt+Esc", esc.(modifiers: :ignore_alt), esc.(alt: true), true},
      {"Esc ignoring Alt and Ctrl+Esc", esc.(modifiers: :ignore_alt), esc.(mod: :ctrl), false},
      {"exact Esc and Alt+Esc", esc.([]), esc.(alt: true), false},
      {"Esc ignoring modifiers and E", cancel, chord(key: ["e"]), false},
      {"Shift+Digit1 and the ! key", chord(code: "Digit1", shift: true),
       chord(key: ["!"], shift: :any), true},
      {"Digit1 without Shift and the ! key", chord(code: "Digit1"),
       chord(key: ["!"], shift: :any), false},
      {"the Space code and the space key", chord(code: "Space", shift: :any),
       chord(key: [" "], shift: :any), true}
    ]

    for {name, a, b, expected} <- table do
      assert Aggregate.collide?(a, b) == expected, name
      assert Aggregate.collide?(b, a) == expected, "#{name}, swapped"
    end
  end

  test "a chord whose modifier policy contradicts its fields fails to compile" do
    contradictions = [
      {"IgnoreAltWithAlt", chord(key: ["k"], alt: true, modifiers: :ignore_alt)},
      {"AnyWithCtrl", chord(key: ["k"], mod: :command, shift: :any, modifiers: :any)},
      {"UnknownPolicy", chord(key: ["k"], modifiers: :some)}
    ]

    for {name, chord} <- contradictions do
      module = context_registry(name, :"#{Macro.underscore(name)}_context", [], chord)

      assert_raise CompileError, ~r/modifiers/, fn ->
        Aggregate.aggregate!([SketchWeb.FixedShortcuts, module])
      end
    end
  end

  test "an action id declared twice fails to compile" do
    undo_again =
      registry("UndoIdAgain", """
      def shortcut_groups, do: [:undo_id_again]
      def shortcuts, do: [%{group: :undo_id_again, action: "undo", label: "Undo", contexts: [:canvas], chords: []}]
      """)

    assert_raise CompileError, ~r/action ids more than once: \["undo"\]/, fn ->
      Aggregate.aggregate!([SketchWeb.FixedShortcuts, SketchWeb.HistoryActions, undo_again])
    end
  end

  test "a malformed chord fails to compile" do
    Code.compile_string("""
    defmodule SketchWeb.ShortcutsTest.Malformed do
      def shortcut_groups, do: [:malformed]

      def shortcuts do
        [%{group: :malformed, action: "x", label: "X", contexts: [:canvas], chords: [%{key: ["x"], mod: :none}]}]
      end
    end
    """)

    assert_raise CompileError, ~r/exactly the keys/, fn ->
      Aggregate.aggregate!([SketchWeb.FixedShortcuts, SketchWeb.ShortcutsTest.Malformed])
    end
  end

  test "the shortcuts help renders every aggregated entry and nothing else" do
    html = render_component(&SketchWeb.Toolbar.shortcuts_help/1, %{})
    rows = html |> LazyHTML.from_fragment() |> LazyHTML.query("dd[id^=shortcut-]")

    assert Enum.map(rows, &(&1 |> LazyHTML.attribute("id") |> hd())) ==
             Enum.map(Shortcuts.all(), &"shortcut-#{&1.action}")

    for shortcut <- Shortcuts.all(), keys <- Shortcuts.help_keys(shortcut), key <- keys do
      assert html =~ key
    end
  end
end
