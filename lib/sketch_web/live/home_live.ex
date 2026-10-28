defmodule SketchWeb.HomeLive do
  use SketchWeb, :live_view

  @impl true
  def mount(_params, _session, socket), do: {:ok, socket}

  @impl true
  def handle_event("new-board", _params, socket) do
    case Sketch.Canvas.create_board() do
      {:ok, board} -> {:noreply, push_navigate(socket, to: ~p"/b/#{board.id}")}
      {:error, _error} -> {:noreply, put_flash(socket, :error, "Could not create board")}
    end
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <div class="flex flex-col items-center gap-4 p-16">
        <h1 class="text-3xl font-semibold">Sketch</h1>
        <button id="new-board" class="btn btn-primary" phx-click="new-board">New board</button>
      </div>
    </Layouts.app>
    """
  end
end
