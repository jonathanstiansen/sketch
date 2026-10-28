defmodule SketchWeb.HealthControllerTest do
  use SketchWeb.ConnCase, async: true

  test "reports ok while the database is reachable", %{conn: conn} do
    conn = get(conn, ~p"/healthz")

    assert response(conn, 200) == "ok"
  end
end
