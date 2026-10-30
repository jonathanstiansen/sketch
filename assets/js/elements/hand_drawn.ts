import type { Point } from "../hooks/canvas_logic.ts"
import { Random } from "./random.ts"

const SCALE = 100
const HALF_SCALE = SCALE / 2
const END_DIVISOR = 50
const MAX_END = 200
const BOW_DIVISOR = 25
const MAX_BOW = 300
const KAPPA = 5523
const KAPPA_SCALE = 10_000
export const MAX_JITTER = MAX_END + MAX_BOW + div(MAX_BOW, 2)

type Pair = readonly [number, number]

interface Direction {
  readonly dx: number
  readonly dy: number
  readonly span: number
}

interface Curve {
  readonly anchors: readonly Pair[]
  readonly leaving: readonly Pair[]
  readonly arriving: readonly Pair[]
  readonly amplitude: number
}

function div(a: number, b: number): number {
  return Math.trunc(a / b)
}

export function format(value: number): string {
  if (value < 0) return `-${format(-value)}`
  const whole = String(div(value, SCALE))
  const fraction = value % SCALE
  return fraction === 0 ? whole : `${whole}.${String(fraction).padStart(2, "0")}`
}

function pair([x, y]: Pair): string {
  return `${format(x)} ${format(y)}`
}

function add([x, y]: Pair, [dx, dy]: Pair): Pair {
  return [x + dx, y + dy]
}

function normal({ dx, dy, span }: Direction, bow: number): Pair {
  return span === 0 ? [0, 0] : [div(-dy * bow, span), div(dx * bow, span)]
}

function stroke([x0, y0]: Pair, [x1, y1]: Pair, direction: Direction, endAmplitude: number, bowAmplitude: number, random: Random): string {
  const sx = x0 + random.offset(endAmplitude)
  const sy = y0 + random.offset(endAmplitude)
  const ex = x1 + random.offset(endAmplitude)
  const ey = y1 + random.offset(endAmplitude)
  const bow = random.offset(bowAmplitude)
  const extra = random.offset(div(bowAmplitude, 2))
  const [nx1, ny1] = normal(direction, bow)
  const [nx2, ny2] = normal(direction, bow + extra)
  const c1: Pair = [sx + div(ex - sx, 3) + nx1, sy + div(ey - sy, 3) + ny1]
  const c2: Pair = [sx + div(2 * (ex - sx), 3) + nx2, sy + div(2 * (ey - sy), 3) + ny2]
  return `M ${pair([sx, sy])} C ${pair(c1)} ${pair(c2)} ${pair([ex, ey])}`
}

function edge(start: Pair, finish: Pair, random: Random): string[] {
  const dx = finish[0] - start[0]
  const dy = finish[1] - start[1]
  const span = Math.max(Math.abs(dx), Math.abs(dy))
  const direction = { dx, dy, span }
  const endAmplitude = Math.min(div(span, END_DIVISOR), MAX_END)
  const bowAmplitude = Math.min(div(span, BOW_DIVISOR), MAX_BOW)
  const first = stroke(start, finish, direction, endAmplitude, bowAmplitude, random)
  const second = stroke(start, finish, direction, endAmplitude, bowAmplitude, random)
  return [first, second]
}

function outline(vertices: readonly Pair[], seed: number): string {
  const random = new Random(seed)
  return vertices
    .flatMap((start, index) => {
      const finish = vertices[(index + 1) % vertices.length] ?? start
      return edge(start, finish, random)
    })
    .join(" ")
}

export function rectangle(width: number, height: number, seed: number): string {
  const w = width * SCALE
  const h = height * SCALE
  return outline([[0, 0], [w, 0], [w, h], [0, h]], seed)
}

export function diamond(width: number, height: number, seed: number): string {
  const w = width * SCALE
  const h = height * SCALE
  const midX = width * HALF_SCALE
  const midY = height * HALF_SCALE
  return outline([[midX, 0], [w, midY], [midX, h], [0, midY]], seed)
}

export function line(start: Point, finish: Point, seed: number): string {
  return edge([start.x * SCALE, start.y * SCALE], [finish.x * SCALE, finish.y * SCALE], new Random(seed)).join(" ")
}

function closedCurve({ anchors, leaving, arriving, amplitude }: Curve, random: Random): string {
  const jittered = anchors.map(([x, y]): Pair => {
    const jx = x + random.offset(amplitude)
    const jy = y + random.offset(amplitude)
    return [jx, jy]
  })
  const segments = leaving.map((out, index) => {
    const from = jittered[index] ?? [0, 0]
    const to = jittered[index + 1] ?? from
    const into = arriving[index] ?? [0, 0]
    return `C ${pair(add(from, out))} ${pair(add(to, into))} ${pair(to)}`
  })
  return `M ${pair(jittered[0] ?? [0, 0])} ${segments.join(" ")}`
}

export function ellipse(width: number, height: number, seed: number): string {
  const rx = width * HALF_SCALE
  const ry = height * HALF_SCALE
  const kx = div(rx * KAPPA, KAPPA_SCALE)
  const ky = div(ry * KAPPA, KAPPA_SCALE)
  const curve: Curve = {
    anchors: [[2 * rx, ry], [rx, 2 * ry], [0, ry], [rx, 0], [2 * rx, ry]],
    leaving: [[0, ky], [-kx, 0], [0, -ky], [kx, 0]],
    arriving: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
    amplitude: Math.min(div(Math.max(rx, ry), BOW_DIVISOR), MAX_BOW),
  }
  const random = new Random(seed)
  const first = closedCurve(curve, random)
  const second = closedCurve(curve, random)
  return `${first} ${second}`
}
