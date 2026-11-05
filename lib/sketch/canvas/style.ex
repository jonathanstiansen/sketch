defmodule Sketch.Canvas.Style do
  @moduledoc """
  The style registry (ADR 0006): the style properties of an element, in panel order, each with
  its tokens in panel order and a default, the first token unless `@defaults` names another. A token is a name, never a colour;
  `assets/css/app.css` gives each colour token a light and a dark theme value. `auto` is the kind's
  own fill. A stroke width token has a nominal width in pixels, used by single strokes, and a
  sketch width, used by the two passes of a hand-drawn outline (ADR 0005). A dashed or dotted style
  has a dash pattern per width. A sloppiness level has a roughness that scales the hand-drawn
  jitter (addendum D16). The element attributes, their validations and CHECK constraints,
  the kind specs' `style` lists and the client manifest derive from here.
  """

  @properties [
    stroke_color: [:ink, :red, :green, :blue, :orange],
    fill_color: [:auto, :none, :red, :green, :blue, :yellow],
    stroke_width: [:thin, :bold, :extra_bold],
    stroke_style: [:solid, :dashed, :dotted],
    sloppiness: [:architect, :artist, :cartoonist]
  ]

  @defaults %{sloppiness: :artist}

  @labels %{
    stroke_color: "Stroke",
    fill_color: "Background",
    stroke_width: "Stroke width",
    stroke_style: "Stroke style",
    sloppiness: "Sloppiness",
    ink: "Ink",
    red: "Red",
    green: "Green",
    blue: "Blue",
    orange: "Orange",
    yellow: "Yellow",
    auto: "Default",
    none: "None",
    thin: "Thin",
    bold: "Bold",
    extra_bold: "Extra bold",
    solid: "Solid",
    dashed: "Dashed",
    dotted: "Dotted",
    architect: "Architect",
    artist: "Artist",
    cartoonist: "Cartoonist"
  }

  @widths %{
    thin: %{stroke: 2, sketch: "1.5"},
    bold: %{stroke: 4, sketch: "3"},
    extra_bold: %{stroke: 6, sketch: "4.5"}
  }

  @roughness %{architect: 0, artist: 100, cartoonist: 200}

  @dash_arrays %{
    dashed: %{thin: "8 6", bold: "12 9", extra_bold: "16 12"},
    dotted: %{thin: "0 5", bold: "0 8", extra_bold: "0 11"}
  }

  @names Keyword.keys(@properties)

  for {property, tokens} <- @properties,
      token <- [property | tokens],
      not is_map_key(@labels, token) do
    raise CompileError, description: "Sketch.Canvas.Style has no label for #{inspect(token)}"
  end

  if Enum.sort(Map.keys(@widths)) != Enum.sort(@properties[:stroke_width]) do
    raise CompileError, description: "every stroke width needs pixel widths"
  end

  if Enum.sort(Map.keys(@roughness)) != Enum.sort(@properties[:sloppiness]) do
    raise CompileError, description: "every sloppiness needs a roughness"
  end

  for {property, default} <- @defaults,
      default not in Keyword.fetch!(@properties, property) do
    raise CompileError, description: "#{inspect(default)} is not a #{property} token"
  end

  non_solid_styles = @properties[:stroke_style] -- [:solid]

  if Enum.sort(Map.keys(@dash_arrays)) != Enum.sort(non_solid_styles) or
       Enum.any?(
         Map.values(@dash_arrays),
         &(Enum.sort(Map.keys(&1)) != Enum.sort(Map.keys(@widths)))
       ) do
    raise CompileError, description: "every non-solid stroke style needs a dash pattern per width"
  end

  @type property :: atom()
  @type t :: %{required(property()) => atom()}

  @doc "The style properties, in panel order."
  @spec properties() :: [property()]
  def properties, do: @names

  @doc "A property's tokens, in panel order."
  @spec tokens(property()) :: [atom(), ...]
  def tokens(property), do: Keyword.fetch!(@properties, property)

  @doc "A property's default: its first token unless the registry names another."
  @spec default(property()) :: atom()
  def default(property), do: Map.get_lazy(@defaults, property, fn -> hd(tokens(property)) end)

  @doc "Every property's default: the look of an element drawn before styling existed."
  @spec defaults() :: t()
  def defaults, do: Map.new(@names, &{&1, default(&1)})

  @doc "The label of a property or a token, as the properties panel shows it."
  @spec label(atom()) :: String.t()
  def label(name), do: Map.fetch!(@labels, name)

  @doc "A stroke width's nominal width in pixels, used by single strokes."
  @spec stroke_px(atom()) :: pos_integer()
  def stroke_px(width), do: @widths |> Map.fetch!(width) |> Map.fetch!(:stroke)

  @doc "A stroke width's width for each of the two passes of a hand-drawn outline."
  @spec sketch_px(atom()) :: String.t()
  def sketch_px(width), do: @widths |> Map.fetch!(width) |> Map.fetch!(:sketch)

  @doc """
  How far a sloppiness level moves hand-drawn strokes from the exact shape, in percent of the
  artist's jitter (ADR 0005): 0 draws clean lines.
  """
  @spec roughness(atom()) :: non_neg_integer()
  def roughness(sloppiness), do: Map.fetch!(@roughness, sloppiness)

  @doc "Every token's data that the client needs, by property: pixel widths and roughness."
  @spec token_data() :: %{property() => %{atom() => map()}}
  def token_data do
    %{
      stroke_width: @widths,
      sloppiness:
        Map.new(@roughness, fn {token, roughness} -> {token, %{roughness: roughness}} end)
    }
  end

  @doc "The `stroke-dasharray` of a stroke style at a width, or `nil` for a solid stroke."
  @spec dash_array(atom(), atom()) :: String.t() | nil
  def dash_array(:solid, _width), do: nil
  def dash_array(style, width), do: @dash_arrays |> Map.fetch!(style) |> Map.fetch!(width)

  @doc "The token of `property` that `value` names, as a client sends it, or `:error`."
  @spec cast_token(property(), term()) :: {:ok, atom()} | :error
  def cast_token(property, value) when is_binary(value) do
    case Enum.find(tokens(property), &(Atom.to_string(&1) == value)) do
      nil -> :error
      token -> {:ok, token}
    end
  end

  def cast_token(_property, _value), do: :error

  @doc "The style of an element: its value for every property."
  @spec of(map()) :: t()
  def of(element), do: Map.new(@names, &{&1, Map.fetch!(element, &1)})
end
