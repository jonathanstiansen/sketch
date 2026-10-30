const INCREMENT = 0x6d2b79f5

export class Random {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + INCREMENT) >>> 0
    const state = this.state
    let t = Math.imul(state ^ (state >>> 15), state | 1) >>> 0
    t = ((t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t) >>> 0
    return (t ^ (t >>> 14)) >>> 0
  }

  offset(amplitude: number): number {
    return (this.next() % (2 * amplitude + 1)) - amplitude
  }
}

export function randomOutputs(seed: number, count: number): number[] {
  const random = new Random(seed)
  return Array.from({ length: count }, () => random.next())
}
