import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import type TypeScript from "typescript"
import type { FunctionMeasure } from "./measure.ts"

const require = createRequire(new URL("../../assets/package.json", import.meta.url))
const ts = require("typescript") as typeof TypeScript

const excludedPath = /(^|\/)(node_modules|vendor|generated)\/|\.d\.ts$/
const sourceFile = /\.(ts|js)$/

const branchKinds = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
])

const branchOperators = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])

function isFunction(node: TypeScript.Node): node is TypeScript.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

function isBranch(node: TypeScript.Node): boolean {
  return branchKinds.has(node.kind) || (ts.isBinaryExpression(node) && branchOperators.has(node.operatorToken.kind))
}

function functionComplexity(fn: TypeScript.FunctionLikeDeclaration): number {
  let complexity = 1
  const visit = (node: TypeScript.Node): void => {
    if (isFunction(node)) return
    if (isBranch(node)) complexity += 1
    ts.forEachChild(node, visit)
  }
  if (fn.body !== undefined) ts.forEachChild(fn.body, visit)
  return complexity
}

function ownName(node: TypeScript.Node): string | undefined {
  const named = node as { name?: TypeScript.Node }
  if (named.name !== undefined && !ts.isComputedPropertyName(named.name)) return named.name.getText()
  if (ts.isConstructorDeclaration(node)) return "constructor"
  const parent = node.parent as TypeScript.Node | undefined
  const namesFunction =
    parent !== undefined &&
    (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))
  return namesFunction ? parent.name.getText() : undefined
}

function qualifiedName(fn: TypeScript.FunctionLikeDeclaration): string {
  const names: string[] = [ownName(fn) ?? "(anonymous)"]
  for (let node = fn.parent as TypeScript.Node | undefined; node !== undefined; node = node.parent) {
    const name = isFunction(node) || ts.isClassLike(node) ? ownName(node) : undefined
    if (name !== undefined) names.unshift(name)
  }
  return names.join(".")
}

function fileFunctions(path: string, file: string): FunctionMeasure[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)
  const found: FunctionMeasure[] = []
  const visit = (node: TypeScript.Node): void => {
    if (isFunction(node) && node.body !== undefined) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      found.push({ file, name: qualifiedName(node), line, complexity: functionComplexity(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function sourceFiles(root: string): string[] {
  const dir = join(root, "assets", "js")
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .map((path) => join(dir, path))
      .filter((path) => sourceFile.test(path) && !excludedPath.test(relative(dir, path)))
  } catch {
    return []
  }
}

export function measure(root: string): FunctionMeasure[] {
  return sourceFiles(root).flatMap((path) => fileFunctions(path, relative(root, path)))
}
