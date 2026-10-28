defmodule Sketch.Repo do
  use AshPostgres.Repo,
    otp_app: :sketch

  @impl true
  def installed_extensions do
    ["ash-functions"]
  end

  @impl true
  def prefer_transaction? do
    false
  end

  @impl true
  def all_tenants, do: []

  @impl true
  def min_pg_version do
    %Version{major: 18, minor: 0, patch: 0}
  end
end
