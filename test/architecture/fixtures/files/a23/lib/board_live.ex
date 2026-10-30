defmodule Fixture.BoardLive do
  def render(assigns) do
    ~H"""
    <div phx-window-keydown="undo" phx-key="z">
      <button aria-keyshortcuts="Shift+?">?</button>
      <button aria-keyshortcuts={SketchWeb.Shortcuts.aria_keyshortcuts("help")}>?</button>
    </div>
    """
  end
end
