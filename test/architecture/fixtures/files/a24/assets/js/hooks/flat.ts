export function flat(style: Record<string, string>): Record<string, string> {
  const { stroke_color, fill_color, stroke_width } = style
  return { stroke_color, fill_color, stroke_width }
}
