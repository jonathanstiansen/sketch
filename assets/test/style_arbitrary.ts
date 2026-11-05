import fc from "fast-check"
import { STYLE_PROPERTIES, STYLE_TOKENS, type StyleProperty, type StyleToken } from "../js/generated/manifest.ts"
import type { ElementStyle } from "../js/elements/style.ts"

export const anyStyle: fc.Arbitrary<ElementStyle> = fc.record(
  Object.fromEntries(STYLE_PROPERTIES.map((property) => [property, fc.constantFrom(...STYLE_TOKENS[property])])) as {
    [P in StyleProperty]: fc.Arbitrary<StyleToken<P>>
  },
  { noNullPrototype: true },
)
