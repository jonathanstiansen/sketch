import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import type { ShortcutChord } from "../js/generated/manifest.ts"
import { matchesChord, type ShortcutInput } from "../js/hooks/shortcuts.ts"
import { usKey } from "./key_press.ts"

const fixture = JSON.parse(readFileSync(new URL("fixtures/shortcut_parity.json", import.meta.url), "utf8")) as {
  chords: ShortcutChord[]
  collisions: string
}

const CODES = ["KeyA", "KeyB", "Digit1", "Digit2", "Space", "Escape", "Enter"] as const
const CHARACTERS_ON_OTHER_KEYS = ["a", "1", "!", " ", "Escape"] as const
const BOOLEANS = [false, true] as const

function keysTyped(code: string, shiftKey: boolean): string[] {
  return shiftKey ? [...new Set([usKey(code, true), usKey(code, false)])] : [usKey(code, false)]
}

function withModifiers(code: string, key: string, shiftKey: boolean): ShortcutInput[] {
  return BOOLEANS.flatMap((ctrlKey) => BOOLEANS.flatMap((metaKey) => BOOLEANS.map((altKey) => ({ key, code, ctrlKey, metaKey, shiftKey, altKey }))))
}

const PHYSICAL_PRESSES = CODES.flatMap((code) => BOOLEANS.flatMap((shiftKey) => keysTyped(code, shiftKey).flatMap((key) => withModifiers(code, key, shiftKey))))
const OTHER_LAYOUT_PRESSES = CHARACTERS_ON_OTHER_KEYS.flatMap((key) => BOOLEANS.flatMap((shiftKey) => withModifiers("", key, shiftKey)))
const PRESSES: readonly ShortcutInput[] = [...PHYSICAL_PRESSES, ...OTHER_LAYOUT_PRESSES]

interface Pair {
  readonly a: number
  readonly b: number
  readonly collides: boolean
}

const PAIRS: readonly Pair[] = fixture.chords.flatMap((_chord, a) =>
  fixture.chords.slice(a).map((_other, offset) => ({ a, b: a + offset, collides: false })),
).map((pair, index) => ({ ...pair, collides: fixture.collisions[index] === "1" }))

const MATCHED: readonly (readonly boolean[])[] = fixture.chords.map((chord) => PRESSES.map((press) => matchesChord(chord, press)))

function chord(index: number): ShortcutChord {
  const found = fixture.chords[index]
  if (found === undefined) throw new Error(`no chord ${String(index)}`)
  return found
}

function describe({ a, b }: Pair): string {
  return `${JSON.stringify(chord(a))} and ${JSON.stringify(chord(b))}`
}

void test("the fixture has a server verdict for every pair of chords", () => {
  assert.equal(fixture.collisions.length, PAIRS.length)
  assert.match(fixture.collisions, /^[01]+$/)
})

void test("a press the client matches with both chords of a pair is one the server calls a collision (A23)", () => {
  fc.assert(
    fc.property(fc.constantFrom(...PAIRS), fc.constantFrom(...PRESSES), (pair, press) => {
      const both = matchesChord(chord(pair.a), press) && matchesChord(chord(pair.b), press)
      assert.ok(!both || pair.collides, `${JSON.stringify(press)} matches ${describe(pair)}, which the server lets coexist`)
    }),
    { seed: 1, numRuns: 20_000 },
  )
})

void test("the server calls a pair a collision exactly when some press matches both chords on the client", () => {
  for (const pair of PAIRS) {
    const left = MATCHED[pair.a] ?? []
    const right = MATCHED[pair.b] ?? []
    const shared = PRESSES.some((_press, index) => left[index] === true && right[index] === true)
    assert.equal(shared, pair.collides, `${describe(pair)}: client ${shared ? "matches a press with both" : "matches no press with both"}`)
  }
})
