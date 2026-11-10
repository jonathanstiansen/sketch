import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { git, languages, limits, measureCommits, stats, type FunctionMeasure, type Language, type Measurement } from "./measure.ts"

const marker = "<!-- complexity-report -->"
const listFrom = 6

const { values: options } = parseArgs({
  options: {
    base: { type: "string" },
    head: { type: "string", default: "HEAD" },
    pr: { type: "string" },
    out: { type: "string" },
    post: { type: "boolean", default: false },
  },
})

function gh(...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" }).trim()
}

function prBaseBranch(): string {
  try {
    return gh("pr", "view", ...(options.pr === undefined ? [] : [options.pr]), "--json", "baseRefName", "--jq", ".baseRefName")
  } catch {
    return "main"
  }
}

function baseCommit(): string {
  return options.base ?? git("merge-base", options.head, `origin/${prBaseBranch()}`)
}

function byFunction(functions: FunctionMeasure[]): Map<string, FunctionMeasure> {
  const most = new Map<string, FunctionMeasure>()
  for (const fn of functions) {
    const key = `${fn.file}#${fn.name}`
    const held = most.get(key)
    if (held === undefined || fn.complexity > held.complexity) most.set(key, fn)
  }
  return most
}

interface Change {
  language: Language
  fn: FunctionMeasure
  before: number | undefined
}

function grown(language: Language, base: FunctionMeasure[], head: FunctionMeasure[]): Change[] {
  const before = byFunction(base)
  return [...byFunction(head)]
    .map(([key, fn]) => ({ language, fn, before: before.get(key)?.complexity }))
    .filter(({ fn, before }) => fn.complexity >= listFrom && (before === undefined || fn.complexity > before))
}

function change(from: number, to: number, digits = 0): string {
  return from === to ? to.toFixed(digits) : `${from.toFixed(digits)} → ${to.toFixed(digits)}`
}

function summaryRow(language: Language, base: FunctionMeasure[], head: FunctionMeasure[]): string {
  const [b, h] = [stats(language, base), stats(language, head)]
  const cells = [
    change(b.functions, h.functions),
    change(b.mean, h.mean, 2),
    change(b.p90, h.p90),
    change(b.max, h.max),
    change(b.overLimit, h.overLimit),
  ]
  return `| ${language} | ${cells.join(" | ")} |`
}

function changeRow({ language, fn, before }: Change): string {
  const score = before === undefined ? `${fn.complexity}, new` : `${before} → ${fn.complexity}`
  const overLimit = fn.complexity > limits[language] ? ` (over ${limits[language]})` : ""
  return `| \`${fn.file}:${fn.line}\` ${fn.name} | ${score}${overLimit} |`
}

function render(base: string, head: string, measuredBase: Measurement, measuredHead: Measurement): string {
  const changes = languages
    .flatMap((language) => grown(language, measuredBase[language], measuredHead[language]))
    .sort((a, b) => b.fn.complexity - a.fn.complexity)
  const changeSection =
    changes.length === 0
      ? [`No function scoring ${listFrom} or more is new or got more complex.`]
      : ["| Function | Complexity |", "|---|---:|", ...changes.map(changeRow)]
  return [
    marker,
    "## Complexity change",
    "",
    `Mean cyclomatic complexity per function, base \`${base.slice(0, 7)}\` → head \`${head.slice(0, 7)}\`. Limits: Elixir ${limits.Elixir}, TypeScript ${limits.TypeScript}.`,
    "",
    "| Language | Functions | Mean | p90 | Max | Over limit |",
    "|---|---:|---:|---:|---:|---:|",
    ...languages.map((language) => summaryRow(language, measuredBase[language], measuredHead[language])),
    "",
    `### New or more complex functions scoring ${listFrom} or more`,
    "",
    ...changeSection,
    "",
  ].join("\n")
}

function post(body: string): void {
  const pr = options.pr ?? gh("pr", "view", "--json", "number", "--jq", ".number")
  const repo = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
  const scratch = mkdtempSync(join(tmpdir(), "complexity-report-"))
  try {
    const bodyFile = join(scratch, "body.md")
    writeFileSync(bodyFile, body)
    const existing = gh(
      "api", `repos/${repo}/issues/${pr}/comments`, "--paginate",
      "--jq", `.[] | select(.body | contains("${marker}")) | .id`,
    ).split("\n")[0]
    if (existing) {
      gh("api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing}`, "-F", `body=@${bodyFile}`)
    } else {
      gh("api", `repos/${repo}/issues/${pr}/comments`, "-F", `body=@${bodyFile}`)
    }
    console.error(`Posted the complexity report to ${repo}#${pr}.`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const base = git("rev-parse", baseCommit())
const head = git("rev-parse", options.head)
const measured = measureCommits([base, head])
const empty: Measurement = { Elixir: [], TypeScript: [] }
const report = render(base, head, measured.get(base) ?? empty, measured.get(head) ?? empty)

if (options.out !== undefined) writeFileSync(options.out, report)
if (options.post) post(report)
console.log(report)
