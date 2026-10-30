defmodule Sketch.Canvas.Viewer do
  @moduledoc """
  The anonymous identity of one open board view (ADR 0007): a random id assigned when the
  LiveView mounts, and a display name and colour derived from that id alone, so every browser
  shows the same label for the same viewer. Nothing is stored. The colour is a stroke colour
  token of the style registry (ADR 0006), so it follows the light and dark themes.
  """

  @adjectives ~w(Amber Brisk Calm Daring Eager Fuzzy Gentle Hasty Jolly Keen Lively Mellow Nimble Plucky Quiet Rapid Sunny Tidy Witty Zesty)
  @animals ~w(Badger Beaver Crane Dolphin Falcon Gecko Heron Ibex Jackal Koala Lemur Marmot Newt Otter Panda Quokka Raven Stoat Tapir Walrus)
  @colors Sketch.Canvas.Style.tokens(:stroke_color)

  @type t :: %{id: String.t(), name: String.t(), color: atom()}

  @doc "A fresh viewer with a random id."
  @spec new() :: t()
  def new do
    8 |> :crypto.strong_rand_bytes() |> Base.url_encode64(padding: false) |> from_id()
  end

  @doc "The viewer whose identity the id determines."
  @spec from_id(String.t()) :: t()
  def from_id(id) do
    %{id: id, name: name(id), color: pick(@colors, {id, :color})}
  end

  @doc "How many distinct names there are."
  @spec name_count() :: pos_integer()
  def name_count, do: length(@adjectives) * length(@animals)

  defp name(id), do: "#{pick(@adjectives, {id, :adjective})} #{pick(@animals, {id, :animal})}"

  defp pick(list, key), do: Enum.at(list, :erlang.phash2(key, length(list)))
end
