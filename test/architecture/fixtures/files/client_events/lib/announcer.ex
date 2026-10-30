defmodule Sketch.ArchitectureFixtures.Announcer do
  @moduledoc false

  def announce(topic, payload) do
    SketchWeb.Endpoint.broadcast(topic, "announce", payload)
    Phoenix.PubSub.broadcast(Sketch.PubSub, topic, payload)
  end
end
