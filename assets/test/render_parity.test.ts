import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { RENDERERS } from "../js/elements/index.ts"
import { attributeString, type LocalShape, type SvgNode } from "../js/elements/renderer.ts"
import { MIGRATED_KINDS } from "../js/generated/manifest.ts"

interface NormalizedNode {
  tag: string
  attrs: Record<string, string>
  children?: NormalizedNode[]
  text?: string
}

interface ParityCase {
  shape: LocalShape
  children: NormalizedNode[]
}

const fixture = JSON.parse(readFileSync(new URL("fixtures/render_parity.json", import.meta.url), "utf8")) as Record<
  string,
  ParityCase[]
>

function normalize(nodes: readonly SvgNode[]): NormalizedNode[] {
  return nodes.map(({ tag, attrs, children = [], text }) => ({
    tag,
    attrs: Object.fromEntries(Object.entries(attrs).map(([name, value]) => [name, attributeString(value)])),
    ...(children.length > 0 ? { children: normalize(children) } : {}),
    ...(text === undefined || text === "" ? {} : { text }),
  }))
}

void test("the parity fixture covers exactly the kinds with a renderer (mix sketch.gen.render_fixtures)", () => {
  assert.deepEqual(Object.keys(fixture).sort(), [...MIGRATED_KINDS].sort())
})

for (const kind of MIGRATED_KINDS) {
  void test(`the ${kind} client renderer draws the same node tree as the server renderer for every fixture shape`, () => {
    const cases = fixture[kind] ?? []
    assert.ok(cases.length > 0, `no fixture cases for ${kind}`)
    for (const { shape, children } of cases) {
      assert.deepEqual(normalize(RENDERERS[kind](shape)), children, JSON.stringify(shape))
    }
  })
}
