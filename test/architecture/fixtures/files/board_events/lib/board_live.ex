defmodule Sketch.ArchitectureFixtures.BoardLive do
  @moduledoc false

  def handle_event("laser", %{"x" => x}, socket) do
    broadcast_preview(socket, "laser", %{x: x})
  end

  def handle_event("poke", _params, socket), do: {:noreply, socket}

  def handle_event("cursor", %{"x" => x}, socket) do
    broadcast_preview(socket, "cursors", %{x: x})
  end

  def handle_event("commit", %{"element_id" => id}, socket) do
    socket |> broadcast_preview("cursors", %{id: id})
  end

  def handle_event("sneak", %{"selected" => selected}, socket) do
    SketchWeb.Endpoint.broadcast_from(self(), "board", "cursor", %{selected: selected})
    {:noreply, socket}
  end

  def handle_info(%Phoenix.Socket.Broadcast{event: "wave", payload: payload}, socket) do
    {:noreply, push_event(socket, "wave", payload)}
  end

  defp broadcast_preview(socket, event, payload) do
    :ok = SketchWeb.Endpoint.broadcast_from(self(), "board", event, payload)
    {:noreply, socket}
  end
end
