defmodule SketchWeb.PageController do
  use SketchWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
