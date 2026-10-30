defmodule SketchWeb.BoardEvents.Contract do
  @moduledoc """
  Validates the event declarations of `SketchWeb.BoardEvents` at compile time.

  A payload is a map of field name to type. A type is `:integer`, `:string`, `:kind`, `:points`,
  `{:style_token, property}`, `{:list, type}`, a nested payload, or `{:optional, type}` at the top
  of a field. `mix sketch.gen.manifest` turns these into `ClientEventPayloads`, the type of every
  client push, so a field that is not declared here cannot be pushed.

  It raises a `CompileError` when an event repeats, an entry is malformed, an example does not fit
  its payload, or a field names selection state, which is local UI state and never leaves the
  client (addendum D8).
  """

  @transient_keys [:event, :relays_as, :payload, :example]
  @durable_keys [:event, :writes, :payload]
  @scalars [:integer, :string, :kind, :points]
  @selection_state ~r/select|marquee/i

  @type event :: %{
          required(:event) => String.t(),
          required(:payload) => map(),
          optional(:relays_as) => String.t(),
          optional(:example) => map(),
          optional(:writes) => atom()
        }

  @spec validate!([event()], [event()]) :: :ok
  def validate!(transient, durable) do
    Enum.each(transient, &validate_entry!(&1, @transient_keys))
    Enum.each(durable, &validate_entry!(&1, @durable_keys))
    Enum.each(transient, &validate_example!/1)
    raise_on_repeats!(transient ++ durable)
  end

  @doc "Whether a selection-state name appears in `name` (addendum D8)."
  @spec selection_state?(String.t()) :: boolean()
  def selection_state?(name), do: Regex.match?(@selection_state, name)

  defp validate_entry!(entry, keys) do
    actual = entry |> Map.keys() |> Enum.sort()

    if actual != Enum.sort(keys) do
      malformed!(entry, "needs exactly the keys #{inspect(keys)}, has #{inspect(actual)}")
    end

    if selection_state?(entry.event) do
      malformed!(entry, "names selection state, which is never pushed (addendum D8)")
    end

    validate_payload!(entry.payload, entry)
  end

  defp validate_payload!(payload, entry) do
    if not is_map(payload), do: malformed!(entry, "needs a map payload")

    for {field, type} <- payload do
      if selection_state?(Atom.to_string(field)) do
        malformed!(
          entry,
          "has field #{inspect(field)}: selection state is never pushed or broadcast (addendum D8)"
        )
      end

      validate_type!(unwrap_optional(type), entry)
    end
  end

  defp unwrap_optional({:optional, type}), do: type
  defp unwrap_optional(type), do: type

  defp validate_type!(type, _entry) when type in @scalars, do: :ok
  defp validate_type!({:style_token, property}, _entry) when is_atom(property), do: :ok
  defp validate_type!({:list, type}, entry), do: validate_type!(type, entry)
  defp validate_type!(payload, entry) when is_map(payload), do: validate_payload!(payload, entry)
  defp validate_type!(type, entry), do: malformed!(entry, "has unknown type #{inspect(type)}")

  defp validate_example!(entry) do
    case example_problem(entry.example, entry.payload) do
      nil -> :ok
      problem -> malformed!(entry, "has an example that does not fit its payload: #{problem}")
    end
  end

  defp example_problem(example, payload) when is_map(example) do
    declared = Map.new(payload, fn {field, type} -> {Atom.to_string(field), type} end)
    required = for {field, type} <- declared, not match?({:optional, _}, type), do: field

    undeclared = Map.keys(example) -- Map.keys(declared)
    missing = required -- Map.keys(example)

    cond do
      undeclared != [] -> "undeclared #{inspect(undeclared)}"
      missing != [] -> "missing #{inspect(missing)}"
      true -> Enum.find_value(example, &field_problem(&1, declared))
    end
  end

  defp example_problem(example, _payload), do: "#{inspect(example)} is not a map"

  defp field_problem({field, value}, declared) do
    type = declared |> Map.fetch!(field) |> unwrap_optional()
    if fits?(value, type), do: nil, else: "#{field} is not a #{inspect(type)}"
  end

  defp fits?(value, :integer), do: is_integer(value)
  defp fits?(value, type) when type in [:string, :kind], do: is_binary(value)
  defp fits?(value, {:style_token, _property}), do: is_binary(value)
  defp fits?(value, :points), do: is_list(value)
  defp fits?(value, {:list, type}), do: is_list(value) and Enum.all?(value, &fits?(&1, type))

  defp fits?(value, payload) when is_map(payload),
    do: is_nil(example_problem(value, payload))

  defp raise_on_repeats!(entries) do
    repeated =
      entries
      |> Enum.frequencies_by(& &1.event)
      |> Enum.filter(fn {_event, count} -> count > 1 end)
      |> Enum.map(&elem(&1, 0))

    if repeated != [] do
      raise CompileError,
        description: "SketchWeb.BoardEvents declares these more than once: #{inspect(repeated)}"
    end

    :ok
  end

  @spec malformed!(map(), String.t()) :: no_return()
  defp malformed!(entry, problem) do
    raise CompileError,
      description: "SketchWeb.BoardEvents entry #{inspect(entry[:event])} #{problem}"
  end
end
