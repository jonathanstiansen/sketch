defmodule SketchWeb.Elements do
  @moduledoc """
  The element renderers (ADR 0004) and the one wrapper every rendered element shares.

  A kind is rendered here once its spec has left `Sketch.Canvas.Kinds.Legacy`; until then
  `SketchWeb.BoardLive` draws it with its old clause. This module fails to compile unless its
  renderers cover exactly the kinds outside `Legacy`, so a kind cannot move without a renderer or
  gain a renderer while it is still legacy.
  """
  use Phoenix.Component

  alias SketchWeb.Elements.{Diamond, Ellipse, Rectangle}

  @renderers [rectangle: Rectangle, diamond: Diamond, ellipse: Ellipse]

  @kinds Keyword.keys(@renderers)
  @expected Sketch.Canvas.element_kinds() -- Sketch.Canvas.legacy_kinds()

  if Enum.sort(@kinds) != Enum.sort(@expected) or length(Enum.uniq(@kinds)) != length(@kinds) do
    raise CompileError,
      description:
        "SketchWeb.Elements must render exactly the kinds outside Sketch.Canvas.Kinds.Legacy: " <>
          "expected #{inspect(@expected)}, has renderers for #{inspect(@kinds)}"
  end

  @renderer_map Map.new(@renderers)

  @doc "The kinds rendered by a renderer here, in registry order."
  @spec kinds() :: [atom()]
  def kinds, do: Enum.filter(Sketch.Canvas.element_kinds(), &is_map_key(@renderer_map, &1))

  @doc "The children a kind's renderer draws for a shape in local coordinates."
  @spec render_children(atom(), SketchWeb.ElementRenderer.local_shape()) :: [
          SketchWeb.ElementRenderer.svg_node()
        ]
  def render_children(kind, shape), do: Map.fetch!(@renderer_map, kind).render(shape)

  attr :dom_id, :string, required: true
  attr :element, :map, required: true

  @doc """
  One element: a wrapper translated to the element's box, with the kind's children inside it.
  `data-x`, `data-y`, `data-width` and `data-height` are the committed box; `x`, `y`, `width`
  and `height` are the box on screen, which the canvas hook changes while an element is dragged
  or previewed.
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
      data-version={@element.version}
      x={@element.x}
      y={@element.y}
      width={@element.width}
      height={@element.height}
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
    %{width: element.width, height: element.height, points: element.points, text: element.text}
  end

  defp points_attribute([]), do: nil
  defp points_attribute(points), do: Enum.map_join(points, " ", &"#{&1.x},#{&1.y}")

  defp text_attribute(""), do: nil
  defp text_attribute(text), do: text
end
