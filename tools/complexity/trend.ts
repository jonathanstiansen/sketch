import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { git, languages, measureCommits, measureRoots, stats, type Language, type Measurement } from "./measure.ts"

const csvPath = "docs/metrics/complexity.csv"
const svgPath = "docs/metrics/complexity.svg"
const header = "commit,date,language,functions,mean,p90,max,over_limit"
const colors: Record<Language, string> = { Elixir: "#7c5cbf", TypeScript: "#2f74c0" }

interface Snapshot {
  commit: string
  date: string
  language: Language
  functions: number
  mean: number
  p90: number
  max: number
  overLimit: number
}

function commitDate(commit: string): string {
  return git("show", "-s", "--format=%cI", commit)
}

function snapshots(commit: string, measurement: Measurement): Snapshot[] {
  const date = commitDate(commit)
  return languages.map((language) => ({ commit, date, language, ...stats(language, measurement[language]) }))
}

function readSnapshots(): Snapshot[] {
  if (!existsSync(csvPath)) return []
  return readFileSync(csvPath, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [commit = "", date = "", language = "", functions, mean, p90, max, overLimit] = line.split(",")
      return {
        commit,
        date,
        language: language as Language,
        functions: Number(functions),
        mean: Number(mean),
        p90: Number(p90),
        max: Number(max),
        overLimit: Number(overLimit),
      }
    })
}

function toCsv(snapshots: Snapshot[]): string {
  const rows = snapshots.map((s) =>
    [s.commit, s.date, s.language, s.functions, s.mean.toFixed(2), s.p90, s.max, s.overLimit].join(","),
  )
  return [header, ...rows].join("\n") + "\n"
}

function merge(existing: Snapshot[], fresh: Snapshot[]): Snapshot[] {
  const replaced = new Set(fresh.map(({ commit }) => commit))
  return [...existing.filter(({ commit }) => !replaced.has(commit)), ...fresh].sort(
    (a, b) => a.date.localeCompare(b.date) || languages.indexOf(a.language) - languages.indexOf(b.language),
  )
}

function niceCeiling(value: number): number {
  const step = 0.5
  return Math.max(step * 4, Math.ceil((value * 1.15) / step) * step)
}

function renderSvg(snapshots: Snapshot[]): string {
  const width = 760
  const height = 340
  const left = 48
  const right = 40
  const top = 44
  const bottom = 40
  const commits = [...new Set(snapshots.map(({ commit }) => commit))]
  const yMax = niceCeiling(Math.max(...snapshots.map(({ mean }) => mean), 1))
  const x = (index: number): number =>
    left + (commits.length < 2 ? 0 : (index / (commits.length - 1)) * (width - left - right))
  const y = (value: number): number => top + (1 - value / yMax) * (height - top - bottom)
  const commitIndex = new Map(commits.map((commit, index) => [commit, index]))
  const dateOf = new Map(snapshots.map(({ commit, date }) => [commit, date.slice(0, 10)]))

  const gridLines = Array.from({ length: Math.round(yMax / 0.5) + 1 }, (_, step) => step * 0.5).map(
    (value) =>
      `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/>` +
      `<text class="label" x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${value.toFixed(1)}</text>`,
  )

  const minLabelGap = 80
  const firstOfEachDay = commits
    .map((commit, index) => ({ date: dateOf.get(commit) ?? "", index }))
    .filter(({ date, index }) => index === 0 || date !== dateOf.get(commits[index - 1] ?? ""))
  const spacedDays = firstOfEachDay.reduce<{ date: string; index: number }[]>((kept, day) => {
    const previous = kept.at(-1)
    return previous === undefined || x(day.index) - x(previous.index) >= minLabelGap ? [...kept, day] : kept
  }, [])
  const dateLabels = spacedDays.map(
    ({ date, index }) =>
      `<text class="label" x="${x(index)}" y="${height - bottom + 18}" text-anchor="start">${date.slice(5)}</text>`,
  )

  const series = languages.map((language) => {
    const points = snapshots
      .filter((s) => s.language === language && s.functions > 0)
      .map((s) => `${x(commitIndex.get(s.commit) ?? 0).toFixed(1)},${y(s.mean).toFixed(1)}`)
    return `<polyline fill="none" stroke="${colors[language]}" stroke-width="2" points="${points.join(" ")}"/>`
  })

  const latest = (language: Language): Snapshot | undefined =>
    snapshots.filter((s) => s.language === language).at(-1)
  const legend = languages.map((language, index) => {
    const value = latest(language)?.mean.toFixed(2) ?? "–"
    const lx = left + index * 190
    return (
      `<rect x="${lx}" y="14" width="14" height="4" fill="${colors[language]}"/>` +
      `<text class="title" x="${lx + 20}" y="20">${language} ${value}</text>`
    )
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="12">
<style>
  .background { fill: #ffffff; }
  .grid { stroke: #e3e5e8; }
  .label { fill: #5b6170; }
  .title { fill: #1f2328; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    .background { fill: #0d1117; }
    .grid { stroke: #2a2f37; }
    .label { fill: #9198a1; }
    .title { fill: #e6edf3; }
  }
</style>
<rect class="background" width="${width}" height="${height}" rx="6"/>
<text class="label" x="${width - right}" y="20" text-anchor="end">Mean cyclomatic complexity per function</text>
${gridLines.join("\n")}
${dateLabels.join("\n")}
${series.join("\n")}
${legend.join("\n")}
</svg>
`
}

function write(snapshots: Snapshot[]): void {
  mkdirSync("docs/metrics", { recursive: true })
  writeFileSync(csvPath, toCsv(snapshots))
  writeFileSync(svgPath, renderSvg(snapshots))
}

function record(): void {
  const commit = git("rev-parse", "--short=7", "HEAD")
  const measured = measureRoots([process.cwd()]).get(process.cwd())
  if (measured !== undefined) write(merge(readSnapshots(), snapshots(commit, measured)))
}

function backfill(): void {
  const existing = readSnapshots()
  const known = new Set(existing.map(({ commit }) => commit))
  const missing = git("rev-list", "--first-parent", "--reverse", "--abbrev-commit", "--abbrev=7", "HEAD")
    .split("\n")
    .filter((commit) => !known.has(commit))
  const fresh = [...measureCommits(missing)].flatMap(([commit, measured]) => snapshots(commit, measured))
  write(merge(existing, fresh))
}

const commands: Record<string, () => void> = { record, backfill }
const command = commands[process.argv[2] ?? ""]
if (command === undefined) {
  console.error("Usage: node tools/complexity/trend.ts record|backfill")
  process.exit(2)
}
command()
