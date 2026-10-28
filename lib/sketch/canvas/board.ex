defmodule Sketch.Canvas.Board do
  @moduledoc """
  A shared canvas identified by a random UUID.
  """
  use Ash.Resource,
    otp_app: :sketch,
    domain: Sketch.Canvas,
    data_layer: AshPostgres.DataLayer

  postgres do
    table "boards"
    repo Sketch.Repo
  end

  actions do
    defaults [:read]

    create :create

    action :database_reachable, :boolean do
      run fn _input, _context ->
        with {:ok, _exists} <- Ash.exists(__MODULE__), do: {:ok, true}
      end
    end
  end

  attributes do
    uuid_primary_key :id

    create_timestamp :inserted_at
  end
end
