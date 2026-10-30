import type { ElementKind } from "../generated/manifest"
import { appliesTo, isStyleProperty, type ElementStyle } from "../elements/style"

export class StylePanel {
  constructor(private readonly panel: HTMLElement | null) {}

  show(kind: ElementKind | undefined, style: ElementStyle): void {
    if (this.panel === null) return
    this.panel.hidden = kind === undefined
    if (kind === undefined) return
    for (const group of this.panel.querySelectorAll<HTMLElement>("[data-style-property]")) {
      const property = group.dataset.styleProperty
      if (!isStyleProperty(property)) continue
      group.hidden = !appliesTo(kind, property)
      for (const button of group.querySelectorAll<HTMLElement>("[data-style-value]")) {
        button.setAttribute("aria-pressed", String(button.dataset.styleValue === style[property]))
      }
    }
  }
}
