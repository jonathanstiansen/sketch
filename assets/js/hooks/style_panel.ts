import { isStyleProperty } from "../elements/style"
import { propertyState, type Styled } from "./selection_logic"

export class StylePanel {
  constructor(private readonly panel: HTMLElement | null) {}

  show(elements: readonly Styled[]): void {
    if (this.panel === null) return
    const hint = this.panel.querySelector<HTMLElement>("[data-style-hint]")
    if (hint !== null) hint.hidden = elements.length > 0
    for (const group of this.panel.querySelectorAll<HTMLElement>("[data-style-property]")) {
      const property = group.dataset.styleProperty
      if (!isStyleProperty(property)) continue
      const state = propertyState(elements, property)
      group.hidden = !state.applies
      group.toggleAttribute("data-mixed", state.mixed)
      for (const button of group.querySelectorAll<HTMLElement>("[data-style-value]")) {
        button.setAttribute("aria-pressed", String(button.dataset.styleValue === state.value))
      }
    }
  }
}
