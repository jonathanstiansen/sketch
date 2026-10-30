export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export async function readClipboardText(): Promise<string | undefined> {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return undefined
  }
}

export function lineMeasurer(fontSize: number, fontFamily: string): (line: string) => number {
  const context = document.createElement("canvas").getContext("2d")
  if (context === null) return (line) => line.length * fontSize
  context.font = `${String(fontSize)}px ${fontFamily}`
  return (line) => context.measureText(line).width
}
