import type { ElementKind } from "../generated/manifest"
import { appliesTo, isStyleProperty, type ElementStyle } from "../elements/style"

export class StylePanel {
  constructor(private readonly panel: HTMLElement | null) {}

  show(kind: ElementKind | undefined, style: ElementStyle): void {
    if (this.panel === null) return
    const hint = this.panel.querySelector<HTMLElement>("[data-style-hint]")
    if (hint !== null) hint.hidden = kind !== undefined
    for (const group of this.panel.querySelectorAll<HTMLElement>("[data-style-property]")) {
      const property = group.dataset.styleProperty
      if (!isStyleProperty(property)) continue
      group.hidden = kind === undefined || !appliesTo(kind, property)
      for (const button of group.querySelectorAll<HTMLElement>("[data-style-value]")) {
        button.setAttribute("aria-pressed", String(button.dataset.styleValue === style[property]))
      }
    }
  }
}
