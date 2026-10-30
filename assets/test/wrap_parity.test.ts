import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { wrapText } from "../js/hooks/canvas_logic.ts"

interface WrapCase {
  text: string
  max_width: number
  char_width: number
  lines: string[]
}

const cases = JSON.parse(readFileSync(new URL("fixtures/wrap_parity.json", import.meta.url), "utf8")) as WrapCase[]

void test("the wrap parity fixture has cases (mix sketch.gen.render_fixtures)", () => {
  assert.ok(cases.length > 0)
})

void test("the client wraps every fixture text into the same lines as the server", () => {
  for (const { text, max_width: maxWidth, char_width: charWidth, lines } of cases) {
    assert.deepEqual(wrapText(text, maxWidth, charWidth), lines, JSON.stringify({ text, maxWidth, charWidth }))
  }
})
