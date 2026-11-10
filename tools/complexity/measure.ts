import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { measure as measureTypeScript } from "./typescript.ts"

export const limits = { Elixir: 9, TypeScript: 10 } as const
export type Language = keyof typeof limits
export const languages = Object.keys(limits) as Language[]

export interface FunctionMeasure {
  file: string
  name: string
  line: number
  complexity: number
}

export type Measurement = Record<Language, FunctionMeasure[]>

export interface Stats {
  functions: number
  mean: number
  p90: number
  max: number
  overLimit: number
}

const bigOutput = 256 * 1024 * 1024

export function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: bigOutput }).trim()
}

export function stats(language: Language, functions: FunctionMeasure[]): Stats {
  const sorted = functions.map(({ complexity }) => complexity).sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  const at = (share: number): number => sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0
  return {
    functions: sorted.length,
    mean: sorted.length === 0 ? 0 : Math.round((total / sorted.length) * 100) / 100,
    p90: at(0.9),
    max: at(1),
    overLimit: sorted.filter((value) => value > limits[language]).length,
  }
}

function measureElixir(roots: string[]): Map<string, FunctionMeasure[]> {
  const output = execFileSync("mix", ["run", "--no-start", "tools/complexity/elixir.exs", ...roots], {
    encoding: "utf8",
    maxBuffer: bigOutput,
  })
  const lines = output.split("\n").filter((line) => line.startsWith("{"))
  const results = lines.map((line) => JSON.parse(line) as { root: string; functions: FunctionMeasure[] })
  return new Map(results.map(({ root, functions }) => [root, functions]))
}

export function measureRoots(roots: string[]): Map<string, Measurement> {
  const elixir = measureElixir(roots)
  return new Map(roots.map((root) => [root, { Elixir: elixir.get(root) ?? [], TypeScript: measureTypeScript(root) }]))
}

function pathExists(commit: string, path: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}:${path}`], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function extract(commit: string, into: string): string {
  const root = join(into, commit)
  mkdirSync(root)
  const paths = ["lib", "assets/js"].filter((path) => pathExists(commit, path))
  if (paths.length > 0) {
    const archive = execFileSync("git", ["archive", "--format=tar", commit, "--", ...paths], { maxBuffer: bigOutput })
    execFileSync("tar", ["-x", "-C", root], { input: archive })
  }
  return root
}

export function measureCommits(commits: string[]): Map<string, Measurement> {
  const scratch = mkdtempSync(join(tmpdir(), "complexity-"))
  try {
    const roots = commits.map((commit) => [commit, extract(commit, scratch)] as const)
    const measured = measureRoots(roots.map(([, root]) => root))
    return new Map(roots.map(([commit, root]) => [commit, measured.get(root) ?? { Elixir: [], TypeScript: [] }]))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
