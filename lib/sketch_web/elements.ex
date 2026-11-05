defmodule SketchWeb.Elements do
  @moduledoc """
  The element renderers (ADR 0004) and the one wrapper every rendered element shares.

  This module fails to compile unless its renderers cover exactly the kinds in
  `Sketch.Canvas.Kinds`, so a kind cannot be added without a renderer.
  """
  use Phoenix.Component

  alias SketchWeb.Elements.{Arrow, Diamond, Ellipse, Freedraw, Line, Note, Rectangle, Text}

  @renderers [
    rectangle: Rectangle,
    diamond: Diamond,
    ellipse: Ellipse,
    arrow: Arrow,
    freedraw: Freedraw,
    line: Line,
    text: Text,
    note: Note
  ]

  @kinds Keyword.keys(@renderers)
  @expected Sketch.Canvas.element_kinds()

  if Enum.sort(@kinds) != Enum.sort(@expected) or length(Enum.uniq(@kinds)) != length(@kinds) do
    raise CompileError,
      description:
        "SketchWeb.Elements must render exactly the kinds in Sketch.Canvas.Kinds: " <>
          "expected #{inspect(@expected)}, has renderers for #{inspect(@kinds)}"
  end

  @renderer_map Map.new(@renderers)

  @doc "The children a kind's renderer draws for a shape in local coordinates."
  @spec render_children(atom(), SketchWeb.ElementRenderer.local_shape()) :: [
          SketchWeb.ElementRenderer.svg_node()
        ]
  def render_children(kind, shape), do: Map.fetch!(@renderer_map, kind).render(shape)

  attr :dom_id, :string, required: true
  attr :element, :map, required: true

  @doc """
  One element: a wrapper translated to the element's box, with the kind's children inside it.
  `data-x`, `data-y`, `data-width`, `data-height` and `data-points` are the committed shape;
  `data-seed` is the seed of its hand-drawn strokes (ADR 0005), and one `data-<property>` per
  property of `Sketch.Canvas.style_properties/0` its style tokens (ADR 0006). `x`, `y`, `width`, `height` and
  `live-points` are the shape on screen, which the canvas hook changes while an element is
  dragged or previewed. The live shape stays outside `data-*`
  because LiveView still merges `data-*` attributes into an element a gesture has claimed.
  """
  def element(assigns) do
    assigns =
      assign(assigns,
        children: render_children(assigns.element.kind, local_shape(assigns.element))
      )

    ~H"""
    <g
      id={@dom_id}
      data-element={@element.id}
      data-kind={@element.kind}
      data-x={@element.x}
      data-y={@element.y}
      data-width={@element.width}
      data-height={@element.height}
      data-points={points_attribute(@element.points)}
      data-text={text_attribute(@element.text)}
      data-seed={@element.seed}
      {style_attributes(@element)}
      data-version={@element.version}
      x={@element.x}
      y={@element.y}
      width={@element.width}
      height={@element.height}
      live-points={points_attribute(@element.points)}
      transform={"translate(#{@element.x} #{@element.y})"}
      class="cursor-grab touch-none"
    >
      <.svg_node :for={node <- @children} node={node} />
    </g>
    """
  end

  attr :node, :map, required: true

  defp svg_node(%{node: %{children: [_ | _]}} = assigns) do
    ~H"""
    <.dynamic_tag tag_name={@node.tag} {@node.attrs}>
      <.svg_node :for={child <- @node.children} node={child} />
    </.dynamic_tag>
    """
  end

  defp svg_node(%{node: %{text: _text}} = assigns) do
    ~H"""
    <.dynamic_tag tag_name={@node.tag} {@node.attrs}>{@node.text}</.dynamic_tag>
    """
  end

  defp svg_node(assigns) do
    ~H"""
    <.dynamic_tag tag_name={@node.tag} {@node.attrs} />
    """
  end

  defp local_shape(element) do
    %{
      width: element.width,
      height: element.height,
      points: element.points,
      text: element.text,
      seed: element.seed,
      style: Map.new(Sketch.Canvas.style_properties(), &{&1, Map.fetch!(element, &1)})
    }
  end

  defp points_attribute([]), do: nil
  defp points_attribute(points), do: Enum.map_join(points, " ", &"#{&1.x},#{&1.y}")

  defp style_attributes(element) do
    Enum.map(Sketch.Canvas.style_properties(), fn property ->
      {"data-#{String.replace(Atom.to_string(property), "_", "-")}",
       Map.fetch!(element, property)}
    end)
  end

  defp text_attribute(""), do: nil
  defp text_attribute(text), do: text
end
