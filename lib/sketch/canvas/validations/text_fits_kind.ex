defmodule Sketch.Canvas.Validations.TextFitsKind do
  @moduledoc """
  Validates an element's text against its kind with `Geometry.text_fits_kind?/2`: text kinds need
  non-blank text and every other kind empty text. In an atomic update the kind is the stored one.
  """
  use Ash.Resource.Validation

  import Ash.Expr

  alias Ash.Error.Changes.InvalidAttribute
  alias Sketch.Canvas.Geometry

  @message "does not fit the element's kind"

  @impl true
  def init(opts) do
    if is_list(opts[:kinds]),
      do: {:ok, opts},
      else: {:error, "kinds must be the list of element kinds"}
  end

  @impl true
  def validate(changeset, _opts, _context) do
    kind = Ash.Changeset.get_attribute(changeset, :kind)
    text = Ash.Changeset.get_attribute(changeset, :text)

    if is_atom(kind) and is_binary(text) and not Geometry.text_fits_kind?(kind, text),
      do: {:error, error(text)},
      else: :ok
  end

  @impl true
  def atomic(changeset, opts, _context) do
    case literal_text(changeset) do
      {:ok, text} ->
        allowed_kinds = Enum.filter(opts[:kinds], &Geometry.text_fits_kind?(&1, text))

        {:atomic, [:kind, :text], expr(^atomic_ref(:kind) not in ^allowed_kinds),
         expr(error(^InvalidAttribute, %{field: :text, message: ^@message}))}

      :unchanged ->
        :ok

      :expression ->
        {:not_atomic, "text must be a literal value"}
    end
  end

  @impl true
  def describe(_opts), do: [message: @message, vars: []]

  defp literal_text(changeset) do
    case Keyword.fetch(changeset.atomics, :text) do
      {:ok, text} when is_binary(text) -> {:ok, text}
      {:ok, _expression} -> :expression
      :error -> changeset.attributes |> Map.fetch(:text) |> unchanged_if_missing()
    end
  end

  defp unchanged_if_missing({:ok, text}), do: {:ok, text}
  defp unchanged_if_missing(:error), do: :unchanged

  defp error(text), do: InvalidAttribute.exception(field: :text, value: text, message: @message)
end
