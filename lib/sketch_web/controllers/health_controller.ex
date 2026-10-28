defmodule SketchWeb.HealthController do
  use SketchWeb, :controller

  def show(conn, _params) do
    case Sketch.Canvas.database_reachable() do
      {:ok, true} -> send_resp(conn, 200, "ok")
      {:error, _error} -> send_resp(conn, 503, "database unreachable")
    end
  end
end
