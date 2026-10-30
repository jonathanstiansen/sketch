defmodule SketchWeb.ShortcutsTest do
  use ExUnit.Case, async: true

  import Phoenix.LiveViewTest

  alias SketchWeb.Shortcuts
  alias SketchWeb.Shortcuts.Aggregate

  @undo_again """
  defmodule SketchWeb.ShortcutsTest.UndoAgain do
    def shortcuts do
      [
        %{
          group: :export,
          action: "export_again",
          label: "Export again",
          contexts: [:canvas],
          chords: [%{key: ["Z"], code: nil, mod: :ctrl, shift: false, alt: false, keys: ["Ctrl", "Z"]}]
        }
      ]
    end
  end
  """

  test "every registry's chords are aggregated, with no chord twice in one focus context (A23)" do
    assert Aggregate.conflicts(Shortcuts.all()) == []

    for registry <- Shortcuts.registries(), entry <- registry.shortcuts() do
      assert Shortcuts.get(entry.action).registry == registry
    end
  end

  test "a module whose shortcuts duplicate another registry's chord fails to compile (A23)" do
    error =
      assert_raise CompileError, fn ->
        Code.compile_string("""
        #{@undo_again}
        defmodule SketchWeb.ShortcutsTest.Aggregated do
          @shortcuts SketchWeb.Shortcuts.Aggregate.aggregate!([
            SketchWeb.HistoryActions,
            SketchWeb.ShortcutsTest.UndoAgain
          ])
          def all, do: @shortcuts
        end
        """)
      end

    assert Exception.message(error) =~ "undo in SketchWeb.HistoryActions"
    assert Exception.message(error) =~ "export_again in SketchWeb.ShortcutsTest.UndoAgain"
    assert Exception.message(error) =~ "canvas context"
  end

  test "a key and a physical code for the same key collide, and so do Ctrl and Ctrl/⌘" do
    by_code = %{key: [], code: "KeyZ", mod: :command, shift: false, alt: false, keys: ["Z"]}
    by_key = %{key: ["z"], code: nil, mod: :ctrl, shift: :any, alt: false, keys: ["Z"]}
    digit = %{key: [], code: "Digit1", mod: :none, shift: true, alt: false, keys: ["1"]}
    any_one = %{key: ["1"], code: nil, mod: :none, shift: :any, alt: false, keys: ["1"]}

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

  test "an action id declared twice fails to compile" do
    assert_raise CompileError, ~r/action ids more than once/, fn ->
      Aggregate.aggregate!([SketchWeb.HistoryActions, SketchWeb.HistoryActions])
    end
  end

  test "a malformed chord fails to compile" do
    Code.compile_string("""
    defmodule SketchWeb.ShortcutsTest.Malformed do
      def shortcuts do
        [%{group: :tool, action: "x", label: "X", contexts: [:canvas], chords: [%{key: ["x"], mod: :none}]}]
      end
    end
    """)

    assert_raise CompileError, ~r/exactly the keys/, fn ->
      Aggregate.aggregate!([SketchWeb.ShortcutsTest.Malformed])
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
