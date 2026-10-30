import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { format } from "../js/elements/hand_drawn.ts"
import { randomOutputs } from "../js/elements/random.ts"

interface RandomCase {
  seed: number
  outputs: number[]
}

interface FormatCase {
  hundredths: number
  text: string
}

const fixture = JSON.parse(readFileSync(new URL("fixtures/random_parity.json", import.meta.url), "utf8")) as {
  random: RandomCase[]
  format: FormatCase[]
}

void test("the random parity fixture covers seed 0 and the largest seed (mix sketch.gen.render_fixtures)", () => {
  const seeds = fixture.random.map(({ seed }) => seed)
  assert.ok(seeds.includes(0) && seeds.includes(2_147_483_647), JSON.stringify(seeds))
})

void test("the client random source returns the same outputs as the server for every fixture seed", () => {
  for (const { seed, outputs } of fixture.random) {
    assert.deepEqual(randomOutputs(seed, outputs.length), outputs, `seed ${String(seed)}`)
  }
})

void test("the client prints every fixture hundredths value like the server", () => {
  assert.ok(fixture.format.length > 0)
  for (const { hundredths, text } of fixture.format) {
    assert.equal(format(hundredths), text, `hundredths ${String(hundredths)}`)
  }
})
