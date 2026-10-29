export function strict(kind: string): boolean {
  return kind === "diamond"
}
export function negated(shape: { kind: string }): boolean {
  return shape.kind !== 'line'
}
export function reversed(kind: string): boolean {
  return "arrow" === kind
}
export function dataset(element: HTMLElement, expected: string): boolean {
  return element.dataset.kind === expected
}
export const NOTES = '#elements [data-kind="note"]'
export function unrelated(nextKind: string, kindName: string): boolean {
  return nextKind === "diamond" || kindName === "info"
}
