defmodule SketchWeb.BoardEvents do
  @moduledoc """
  Every event a board view accepts from its client, in one contract.

  `transient/0` lists the relay-only events (A10): `SketchWeb.BoardLive` forwards them to the other
  views of the board and never touches the database. Each declares the event it is relayed as, its
  payload and a valid example, and the A10 test sends every example and asserts zero Repo queries,
  so a new relay event cannot skip that test. `SketchWeb.BoardLive` generates its forwarding from
  `relayed_events/0`.

  `durable/0` lists the events that write, each naming the `Sketch.Canvas` action it reaches.

  `mix sketch.gen.manifest` emits the payloads as `ClientEventPayloads`, and every push on the
  client goes through `pushClientEvent`, typed from it. `SketchWeb.BoardEvents.Contract` rejects a
  field that names selection state (addendum D8). A source-policy test fails if `BoardLive` handles
  or relays an event that is not declared here (CI requirement 12).
  """

  alias SketchWeb.BoardEvents.Contract

  @element_id "11111111-2222-4333-8444-555555555555"
  @other_element_id "66666666-7777-4888-9999-000000000000"
  @drag_id "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

  @box %{x: :integer, y: :integer, width: :integer, height: :integer}
  @style Map.new(
           Sketch.Canvas.style_properties(),
           &{&1, {:optional, {:style_token, &1}}}
         )
  @live_shape %{points: {:optional, :points}, text: {:optional, :string}}

  @example_box %{"x" => 10, "y" => 20, "width" => 120, "height" => 80}

  @transient [
    %{
      event: "preview",
      relays_as: "preview",
      payload:
        Map.merge(@box, @live_shape)
        |> Map.merge(%{
          element_id: :string,
          drag_id: :string,
          seq: :integer,
          base_version: :integer
        }),
      example:
        Map.merge(@example_box, %{
          "element_id" => @element_id,
          "drag_id" => @drag_id,
          "seq" => 1,
          "base_version" => 0
        })
    },
    %{
      event: "drag_cancel",
      relays_as: "drag_cancel",
      payload: %{element_id: :string, drag_id: :string},
      example: %{"element_id" => @element_id, "drag_id" => @drag_id}
    },
    %{
      event: "group_preview",
      relays_as: "group_preview",
      payload: %{
        drag_id: :string,
        seq: :integer,
        elements:
          {:list,
           Map.merge(@box, %{element_id: :string, base_version: :integer, points: :points})}
      },
      example: %{
        "drag_id" => @drag_id,
        "seq" => 1,
        "elements" => [
          Map.merge(@example_box, %{
            "element_id" => @element_id,
            "base_version" => 0,
            "points" => []
          })
        ]
      }
    },
    %{
      event: "group_cancel",
      relays_as: "group_cancel",
      payload: %{drag_id: :string, element_ids: {:list, :string}},
      example: %{"drag_id" => @drag_id, "element_ids" => [@element_id, @other_element_id]}
    },
    %{
      event: "draw_preview",
      relays_as: "draw_preview",
      payload:
        @box
        |> Map.merge(@live_shape)
        |> Map.merge(@style)
        |> Map.merge(%{kind: :kind, drag_id: :string, seq: :integer, seed: {:optional, :integer}}),
      example:
        Map.merge(@example_box, %{
          "kind" => "rectangle",
          "drag_id" => @drag_id,
          "seq" => 1,
          "seed" => 7
        })
    },
    %{
      event: "draw_cancel",
      relays_as: "draw_end",
      payload: %{drag_id: :string},
      example: %{"drag_id" => @drag_id}
    },
    %{
      event: "cursor",
      relays_as: "cursor",
      payload: %{x: :integer, y: :integer, seq: :integer},
      example: %{"x" => 10, "y" => 20, "seq" => 1}
    },
    %{
      event: "cursor_leave",
      relays_as: "cursor_leave",
      payload: %{seq: :integer},
      example: %{"seq" => 2}
    }
  ]

  @durable [
    %{
      event: "create_element",
      writes: :create_element,
      payload:
        @box
        |> Map.merge(@live_shape)
        |> Map.merge(@style)
        |> Map.merge(%{kind: :kind, drag_id: :string, seed: {:optional, :integer}})
    },
    %{event: "erase", writes: :erase_element, payload: %{element_ids: {:list, :string}}},
    %{
      event: "commit",
      writes: :commit_position,
      payload: %{element_id: :string, drag_id: :string, x: :integer, y: :integer}
    },
    %{
      event: "commit_shape",
      writes: :commit_shape,
      payload: Map.merge(@box, Map.merge(@live_shape, %{element_id: :string, drag_id: :string}))
    },
    %{
      event: "commit_style",
      writes: :commit_style,
      payload: Map.merge(@style, %{element_id: :string})
    }
  ]

  @durable_broadcasts ~w(create commit_position commit_shape commit_style erase)

  @presence_broadcasts ~w(presence_diff)

  :ok = Contract.validate!(@transient, @durable)

  @relayed @transient |> Enum.map(& &1.relays_as) |> Enum.uniq()

  @doc "The relay-only events: each is forwarded to the other views and never persisted (A10)."
  @spec transient() :: [Contract.event()]
  def transient, do: @transient

  @doc "The events that write through a `Sketch.Canvas` action."
  @spec durable() :: [Contract.event()]
  def durable, do: @durable

  @doc "Every event a client may push, with its payload."
  @spec all() :: [Contract.event()]
  def all, do: @transient ++ @durable

  @doc "The event names `BoardLive` forwards from the board topic to its client (A10)."
  @spec relayed_events() :: [String.t()]
  def relayed_events, do: @relayed

  @doc "The event names `Ash.Notifier.PubSub` publishes on the board topic after a commit (A11)."
  @spec durable_broadcasts() :: [String.t()]
  def durable_broadcasts, do: @durable_broadcasts

  @doc """
  The event names `SketchWeb.Presence` publishes on the board topic when a viewer joins, leaves or
  changes its metadata (addendum D14). `BoardLive` updates its viewer list from them.
  """
  @spec presence_broadcasts() :: [String.t()]
  def presence_broadcasts, do: @presence_broadcasts
end
