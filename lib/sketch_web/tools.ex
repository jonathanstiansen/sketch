defmodule SketchWeb.Tools do
  @moduledoc """
  The toolbar tools, in toolbar order (ADR 0004): each tool's id, label, shortcut keys (a letter,
  then a digit if it has one), icon paths and the element kind it creates, if any. The toolbar
  renders from this list and `mix sketch.gen.manifest` copies it to the client; the shortcuts reach
  the client through `SketchWeb.Shortcuts` (A23).
  """

  @type t :: %{
          id: String.t(),
          label: String.t(),
          keys: [String.t(), ...],
          icon: [String.t(), ...],
          creates: atom() | nil,
          enabled: boolean()
        }

  @tools [
    %{
      id: "hand",
      label: "Hand",
      keys: ["H"],
      creates: nil,
      icon: [
        "M18 11V6a2 2 0 0 0-4 0v1",
        "M14 10V4a2 2 0 0 0-4 0v2",
        "M10 10.5V6a2 2 0 0 0-4 0v8",
        "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
      ]
    },
    %{
      id: "selection",
      label: "Selection",
      keys: ["V", "1"],
      creates: nil,
      icon: [
        "M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"
      ]
    },
    %{
      id: "rectangle",
      label: "Rectangle",
      keys: ["R", "2"],
      creates: :rectangle,
      icon: ["M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"]
    },
    %{
      id: "diamond",
      label: "Diamond",
      keys: ["D", "3"],
      creates: :diamond,
      icon: ["M12 3l9 9-9 9-9-9z"]
    },
    %{
      id: "ellipse",
      label: "Ellipse",
      keys: ["O", "4"],
      creates: :ellipse,
      icon: ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"]
    },
    %{
      id: "arrow",
      label: "Arrow",
      keys: ["A", "5"],
      creates: :arrow,
      icon: ["M5 19L19 5", "M9 5h10v10"]
    },
    %{id: "line", label: "Line", keys: ["L", "6"], creates: :line, icon: ["M5 19L19 5"]},
    %{
      id: "draw",
      label: "Draw",
      keys: ["P", "7"],
      creates: :freedraw,
      icon: [
        "M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"
      ]
    },
    %{
      id: "text",
      label: "Text",
      keys: ["T", "8"],
      creates: :text,
      icon: ["M4 7V4h16v3", "M9 20h6", "M12 4v16"]
    },
    %{
      id: "note",
      label: "Note",
      keys: ["N", "9"],
      creates: :note,
      icon: [
        "M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z",
        "M15 3v4a2 2 0 0 0 2 2h4"
      ]
    },
    %{
      id: "eraser",
      label: "Eraser",
      keys: ["E", "0"],
      creates: nil,
      icon: [
        "M7 21l-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21",
        "M22 21H7",
        "M5 11l9 9"
      ]
    }
  ]

  @tools Enum.map(@tools, &Map.put_new(&1, :enabled, true))

  @unknown_kinds for %{id: id, creates: kind} <- @tools,
                     kind != nil,
                     kind not in Sketch.Canvas.element_kinds(),
                     do: {id, kind}

  if @unknown_kinds != [] do
    raise CompileError,
      description:
        "SketchWeb.Tools creates kinds that are not in Sketch.Canvas.element_kinds(): #{inspect(@unknown_kinds)}"
  end

  @default_tool "selection"

  @doc "The shortcut groups this registry owns (A23)."
  @spec shortcut_groups() :: [atom()]
  def shortcut_groups, do: [:tool]

  @spec all() :: [t()]
  def all, do: @tools

  @doc """
  The tools' keyboard shortcuts for `SketchWeb.Shortcuts` (A23). The letter matches the typed
  character in either case; the digit matches the physical number-row key without Shift, so
  Shift+1 stays free for zoom to fit on every layout.
  """
  @spec shortcuts() :: [map()]
  def shortcuts do
    for %{keys: [letter | digits]} = tool <- @tools do
      %{
        group: :tool,
        action: tool.id,
        label: tool.label,
        contexts: [:canvas],
        enabled: tool.enabled,
        chords: [letter_chord(letter) | Enum.map(digits, &digit_chord/1)]
      }
    end
  end

  defp letter_chord(letter),
    do: %{
      key: [letter],
      code: nil,
      mod: :none,
      shift: :any,
      alt: false,
      modifiers: :exact,
      keys: [letter]
    }

  defp digit_chord(digit),
    do: %{
      key: [],
      code: "Digit" <> digit,
      mod: :none,
      shift: false,
      alt: false,
      modifiers: :exact,
      keys: [digit]
    }

  @press %{button: :primary, target: :any, space: false, shift: :any, alt: :any, mod: :any}

  @doc "What a press does with a tool that does not select: pan, draw, type or erase (A23)."
  @spec pointer_gestures() :: [SketchWeb.Shortcuts.Aggregate.gesture()]
  def pointer_gestures do
    {typed, drawn} =
      @tools
      |> Enum.filter(& &1.creates)
      |> Enum.split_with(&click_to_type?/1)

    Enum.map(
      [
        %{action: "pan", motion: :drag, tools: ["hand"]},
        %{action: "draw", motion: :drag, tools: Enum.map(drawn, & &1.id)},
        %{action: "text", motion: :click, tools: Enum.map(typed, & &1.id)},
        %{action: "erase", motion: :drag, tools: ["eraser"]}
      ],
      &Map.merge(@press, &1)
    )
  end

  defp click_to_type?(%{creates: kind}) do
    spec = Enum.find(Sketch.Canvas.kind_specs(), &(&1.id == kind))
    spec.draw_gesture == :click_to_type
  end

  @doc "The tool selected when a board opens and after Esc."
  @spec default_id() :: String.t()
  def default_id, do: @default_tool
end
