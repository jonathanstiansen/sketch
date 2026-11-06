import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { RENDERERS } from "../js/elements/index.ts"
import { attributeString, type LocalShape, type SvgNode } from "../js/elements/renderer.ts"
import { ELEMENT_KINDS, STYLE_DEFAULTS } from "../js/generated/manifest.ts"

interface NormalizedNode {
  tag: string
  attrs: Record<string, string>
  children?: NormalizedNode[]
  text?: string
}

interface ParityCase {
  shape: Omit<LocalShape, "style"> & { style: Partial<LocalShape["style"]> }
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

void test("the parity fixture covers every element kind (mix sketch.gen.render_fixtures)", () => {
  assert.deepEqual(Object.keys(fixture).sort(), [...ELEMENT_KINDS].sort())
})

for (const kind of ELEMENT_KINDS) {
  void test(`the ${kind} client renderer draws the same node tree as the server renderer for every fixture shape`, () => {
    const cases = fixture[kind] ?? []
    assert.ok(cases.length > 0, `no fixture cases for ${kind}`)
    for (const { shape, children } of cases) {
      const styled = { ...shape, style: { ...STYLE_DEFAULTS, ...shape.style } }
      assert.deepEqual(normalize(RENDERERS[kind](styled)), children, JSON.stringify(shape))
    }
  })
}
