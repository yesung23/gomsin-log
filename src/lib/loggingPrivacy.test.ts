import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse } from '@typescript-eslint/parser';

const SOURCE_ROOTS = [
  resolve(process.cwd(), 'src'),
  resolve(process.cwd(), 'supabase/functions'),
];
const RAW_IDENTIFIER_NAMES = new Set([
  'body',
  'content',
  'data',
  'detail',
  'e',
  'err',
  'error',
  'file',
  'filename',
  'message',
  'path',
  'payload',
  'record',
  'result',
  'stack',
  'thrown',
  'token',
  'url',
]);
const RAW_PROPERTY_NAMES = new Set([
  'body',
  'content',
  'data',
  'details',
  'email',
  'error',
  'hint',
  'id',
  'message',
  'name',
  'path',
  'payload',
  'scope',
  'stack',
  'token',
  'url',
  'user',
]);
const SAFE_SCALAR_PROPERTY_NAMES = new Set(['code', 'kind', 'reason', 'stage', 'status']);

type AstNode = {
  type?: string;
  [key: string]: unknown;
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(?:ts|tsx)$/.test(entry)) return [];
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry) || /_test\.(?:ts|tsx)$/.test(entry)) return [];
    return [path];
  });
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string';
}

function propertyName(node: AstNode): string | undefined {
  const property = node.property;
  if (!isAstNode(property)) return undefined;
  if (property.type === 'Identifier') return property.name as string;
  if (property.type === 'Literal' && typeof property.value === 'string') return property.value;
  return undefined;
}

function calleeName(node: AstNode): string | undefined {
  const callee = node.callee;
  if (!isAstNode(callee)) return undefined;
  if (callee.type === 'Identifier') return callee.name as string;
  return undefined;
}

function containsSensitiveValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (!isAstNode(value)) return false;

  // This helper returns a bounded enum, not the original error object.
  if (value.type === 'CallExpression' && calleeName(value) === 'classifyServerError') return false;
  if (value.type === 'Identifier') {
    const name = value.name as string;
    return RAW_IDENTIFIER_NAMES.has(name) || /(?:error|exception)$/i.test(name);
  }

  if (value.type === 'MemberExpression') {
    const name = propertyName(value);
    if (name && RAW_PROPERTY_NAMES.has(name)) return true;
    if (name && SAFE_SCALAR_PROPERTY_NAMES.has(name)) return false;
  }

  return Object.entries(value).some(([key, child]) => {
    if (key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') return false;
    return containsSensitiveValue(child);
  });
}

function consoleViolations(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const ast = parse(source, {
    ecmaFeatures: { jsx: true },
    ecmaVersion: 'latest',
    filePath: path,
    loc: true,
    range: true,
    sourceType: 'module',
  }) as unknown as AstNode;
  const violations: string[] = [];

  function visit(node: unknown): void {
    if (!isAstNode(node)) {
      if (Array.isArray(node)) node.forEach(visit);
      return;
    }

    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (isAstNode(callee) && callee.type === 'MemberExpression') {
        const object = callee.object;
        const method = propertyName(callee);
        if (isAstNode(object) && object.type === 'Identifier' && object.name === 'console'
          && method && ['debug', 'error', 'info', 'log', 'warn'].includes(method)) {
          const args = Array.isArray(node.arguments) ? node.arguments as unknown[] : [];
          // The first argument is not automatically safe: JSON.stringify can
          // wrap a detail object there and still send every field to the
          // platform logger. Inspect every argument so that wrapper changes
          // cannot turn this guard false-green.
          for (const argument of args) {
            if (containsSensitiveValue(argument)) {
              const line = (node.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 0;
              violations.push(`${relative(process.cwd(), path)}:${line}: console.${method} receives raw data`);
              break;
            }
          }
        }
      }
    }

    Object.entries(node).forEach(([key, child]) => {
      if (key !== 'loc' && key !== 'range' && key !== 'tokens' && key !== 'comments') visit(child);
    });
  }

  visit(ast);
  return violations;
}

describe('console logging privacy boundary', () => {
  it('never sends raw errors, response payloads, file names, paths, or server messages to console', () => {
    const violations = SOURCE_ROOTS.flatMap((root) => sourceFiles(root).flatMap(consoleViolations));
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
