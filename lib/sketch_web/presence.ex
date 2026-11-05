defmodule SketchWeb.Presence do
  @moduledoc """
  Who has each board open (addendum D14, ADR 0012). Every `SketchWeb.BoardLive` view tracks its
  viewer on the board topic with its name, colour and whether its pointer is on the canvas, so
  the header can list everyone and a leave is noticed when the view's process exits.
  """
  use Phoenix.Presence, otp_app: :sketch, pubsub_server: Sketch.PubSub
end
