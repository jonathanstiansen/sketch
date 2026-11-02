defmodule Sketch.Architecture.BoardEventsTest do
  use ExUnit.Case, async: true

  alias Sketch.ArchitectureCheck
  alias SketchWeb.BoardEvents
  alias SketchWeb.BoardEvents.Contract

  @board_live "lib/sketch_web/live/board_live.ex"
  @fixtures "test/architecture/fixtures/files"

  defp contract do
    %{
      transient: BoardEvents.transient(),
      durable: BoardEvents.durable(),
      durable_broadcasts: BoardEvents.durable_broadcasts()
    }
  end

  defp allowlist(name),
    do: Enum.map(Map.fetch!(ArchitectureCheck.registry()[:allowlists], name), &elem(&1, 0))

  describe "BoardLive handles and relays only declared events (A10, CI requirement 12)" do
    test "application" do
      violations = ArchitectureCheck.board_event_violations(File.cwd!(), @board_live, contract())

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects an undeclared relay, handler or forward, a durable event that writes nothing, a direct broadcast and a payload that drifts from its handler" do
      violations =
        ArchitectureCheck.board_event_violations(
          Path.join(@fixtures, "board_events"),
          "lib/board_live.ex",
          contract()
        )

      assert violations |> Enum.map(&{&1.rule, &1.detail}) |> Enum.sort() == [
               {"A10",
                "\"commit\" is declared durable but never reaches Sketch.Canvas.commit_position"},
               {"A10", "forwards \"wave\", which SketchWeb.BoardEvents does not declare"},
               {"A10", "handle_event broadcasts directly; only broadcast_preview may"},
               {"A10", "relays \"laser\", which SketchWeb.BoardEvents does not declare"},
               {"A10",
                "relays \"laser\", which SketchWeb.BoardEvents does not declare with an example"},
               {"A10",
                "relays \"sneak\", which SketchWeb.BoardEvents does not declare with an example"},
               {"client_events",
                "\"commit\" requires [\"element_id\"] but declares [\"drag_id\", \"element_id\", \"x\", \"y\"]"},
               {"client_events",
                "\"cursor\" requires [\"x\"] but declares [\"seq\", \"x\", \"y\"]"},
               {"client_events", "handles \"poke\", which SketchWeb.BoardEvents does not declare"}
             ]
    end
  end

  describe "selection state never reaches an event, payload or broadcast (addendum D8)" do
    test "application" do
      violations = ArchitectureCheck.selection_broadcast_violations(File.cwd!(), @board_live)

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects selection state in a handler or payload" do
      violations =
        ArchitectureCheck.selection_broadcast_violations(
          Path.join(@fixtures, "board_events"),
          "lib/board_live.ex"
        )

      assert Enum.uniq(Enum.map(violations, &{&1.rule, &1.detail})) == [
               {"D8", "handle_event mentions selection state: selected"}
             ]
    end

    test "no declared event or field names selection state" do
      for event <- BoardEvents.all() do
        refute Contract.selection_state?(event.event), event.event

        for field <- Map.keys(event.payload) do
          refute Contract.selection_state?(Atom.to_string(field)), "#{event.event}.#{field}"
        end
      end
    end

    test "the contract refuses a field or an event that names selection state" do
      event = %{
        event: "cursor",
        relays_as: "cursor",
        payload: %{seq: :integer},
        example: %{"seq" => 1}
      }

      assert_raise CompileError, ~r/field :selected_ids: selection state is never pushed/, fn ->
        Contract.validate!([put_in(event.payload[:selected_ids], {:list, :string})], [])
      end

      assert_raise CompileError, ~r/field :marquee_box/, fn ->
        Contract.validate!([put_in(event.payload[:marquee_box], %{x: :integer})], [])
      end

      assert_raise CompileError, ~r/names selection state/, fn ->
        Contract.validate!([%{event | event: "selection_changed"}], [])
      end
    end
  end

  describe "the event contract is validated at compile time" do
    @cursor %{
      event: "cursor",
      relays_as: "cursor",
      payload: %{seq: :integer},
      example: %{"seq" => 1}
    }

    test "a transient event needs an example that fits its payload" do
      assert_raise CompileError, ~r/needs exactly the keys/, fn ->
        Contract.validate!([Map.delete(@cursor, :example)], [])
      end

      assert_raise CompileError, ~r/example that does not fit its payload: missing/, fn ->
        Contract.validate!([%{@cursor | example: %{}}], [])
      end

      assert_raise CompileError, ~r/example that does not fit its payload: undeclared/, fn ->
        Contract.validate!([%{@cursor | example: %{"seq" => 1, "extra" => 2}}], [])
      end

      assert_raise CompileError, ~r/seq is not a :integer/, fn ->
        Contract.validate!([%{@cursor | example: %{"seq" => "1"}}], [])
      end
    end

    test "an event is declared once and a durable event names what it writes" do
      assert_raise CompileError, ~r/more than once: \["cursor"\]/, fn ->
        Contract.validate!([@cursor, @cursor], [])
      end

      assert_raise CompileError, ~r/needs exactly the keys/, fn ->
        Contract.validate!([], [%{event: "commit", payload: %{}}])
      end
    end
  end

  describe "pushes go through the typed wrapper and only BoardLive broadcasts (CI requirement 12, A10)" do
    test "application" do
      violations =
        ArchitectureCheck.client_push_violations(
          File.cwd!(),
          allowlist(:client_push_paths),
          allowlist(:broadcast_paths)
        )

      assert violations == [], ArchitectureCheck.format_violations(violations)
    end

    test "rejects a raw pushEvent or pushEventTo and a broadcast from another module" do
      violations =
        ArchitectureCheck.client_push_violations(
          Path.join(@fixtures, "client_events"),
          allowlist(:client_push_paths),
          allowlist(:broadcast_paths)
        )

      assert violations |> Enum.map(&{&1.rule, &1.subject}) |> Enum.sort() == [
               {"A10", "lib/announcer.ex:5"},
               {"A10", "lib/announcer.ex:6"},
               {"client_events", "assets/js/hooks/raw.ts:1"},
               {"client_events", "assets/js/hooks/raw.ts:2"},
               {"client_events", "assets/js/hooks/raw.ts:3"}
             ]
    end

    test "only the typed wrapper may push and only BoardLive may broadcast" do
      assert allowlist(:client_push_paths) == ["assets/js/hooks/client_events.ts"]
      assert allowlist(:broadcast_paths) == [@board_live]
    end
  end
end
