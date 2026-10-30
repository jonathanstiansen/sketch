defmodule SketchWeb.HandDrawn.Random do
  @moduledoc """
  The mulberry32 generator (ADR 0005): a 32-bit state that advances by a fixed odd increment and
  is mixed into one unsigned 32-bit output per step. `assets/js/elements/random.ts` is the same
  generator in TypeScript; `assets/test/fixtures/random_parity.json` forces them equal. Every
  operation is masked to 32 bits so it matches `Math.imul` and `>>> 0`.
  """
  import Bitwise

  @mask 0xFFFFFFFF
  @increment 0x6D2B79F5

  @opaque t :: non_neg_integer()

  @spec new(non_neg_integer()) :: t()
  def new(seed), do: seed &&& @mask

  @doc "The next unsigned 32-bit output and the advanced state."
  @spec next(t()) :: {non_neg_integer(), t()}
  def next(state) do
    state = state + @increment &&& @mask
    t = imul(bxor(state, state >>> 15), state ||| 1)
    t = bxor(t + imul(bxor(t, t >>> 7), t ||| 61) &&& @mask, t)
    {bxor(t, t >>> 14), state}
  end

  @doc "A uniform-ish integer in `-amplitude..amplitude` and the advanced state."
  @spec offset(t(), non_neg_integer()) :: {integer(), t()}
  def offset(state, amplitude) do
    {value, state} = next(state)
    {rem(value, 2 * amplitude + 1) - amplitude, state}
  end

  @doc "The first `count` outputs from `seed`."
  @spec take(non_neg_integer(), non_neg_integer()) :: [non_neg_integer()]
  def take(seed, count) do
    {values, _state} = Enum.map_reduce(1..count//1, new(seed), fn _step, state -> next(state) end)
    values
  end

  defp imul(a, b), do: a * b &&& @mask
end
