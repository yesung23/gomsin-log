import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architectural boundaries for the E2EE layer.
 *
 * `AGENTS.md` §4 puts crypto below the repository layer and states that
 * presentation must not need to understand encryption internals. These tests
 * make that mechanical rather than aspirational, because the boundary is what
 * lets an independent reviewer read `src/crypto/**` on its own and lets a later
 * platform correction stay inside one directory.
 */

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments before scanning for forbidden constructs.
 *
 * Without this the checks fail on their own documentation — `suite.ts` says
 * "`Math.random` is never acceptable", which is prose asserting the rule, not a
 * violation of it.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const cryptoFiles = walk(resolve(ROOT, 'src/crypto'));
const productionCryptoFiles = cryptoFiles.filter(
  (f) => !f.includes('.test.') && !f.includes(`${'/'}testing${'/'}`),
);

describe('src/crypto stays pure', () => {
  it('has files to check', () => {
    expect(productionCryptoFiles.length).toBeGreaterThan(10);
  });

  it('imports no React, Supabase, store or repository module', () => {
    const forbidden = [
      /from ['"]react/,
      /from ['"]@supabase/,
      /from ['"]@\/lib\//,
      /from ['"]\.\.\/\.\.\/lib\//,
      /from ['"]@\/components\//,
      /from ['"]@\/pages\//,
    ];
    for (const file of productionCryptoFiles) {
      const source = code(file);
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${relative(ROOT, file)} must not import ${pattern}`).toBe(false);
      }
    }
  });

  it('keeps randomness in exactly one module', () => {
    // Every key, nonce and secret comes from one place, so an audit of
    // randomness is an audit of one file.
    const offenders = productionCryptoFiles.filter((file) => {
      if (file.endsWith('suite.ts')) return false;
      return /getRandomValues|Math\.random/.test(code(file));
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('never uses Math.random anywhere', () => {
    for (const file of cryptoFiles) {
      expect(/Math\.random/.test(code(file)), `${relative(ROOT, file)}`).toBe(false);
    }
  });
});

describe('presentation does not reach into crypto', () => {
  const uiDirs = ['src/components', 'src/pages', 'src/features'];

  it('no component, page or feature imports src/crypto', () => {
    for (const dir of uiDirs) {
      const full = resolve(ROOT, dir);
      let files: string[];
      try {
        files = walk(full);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.includes('.test.')) continue;
        const source = code(file);
        expect(
          /from ['"]@\/crypto\//.test(source),
          `${relative(ROOT, file)} imports crypto directly; go through a use case`,
        ).toBe(false);
      }
    }
  });
});

describe('Phase 1A encrypts no content', () => {
  it('no application module imports the content envelope', () => {
    // GLE1 is a format definition in Phase 1A. Phase 1B is where record text
    // starts using it, and this test is the tripwire for doing that early.
    const libFiles = walk(resolve(ROOT, 'src/lib')).filter((f) => !f.includes('.test.'));
    for (const file of libFiles) {
      expect(/from ['"]@\/crypto\/gle1/.test(code(file)), `${relative(ROOT, file)}`).toBe(false);
    }
  });

  it('the record write path is untouched by Phase 1A', () => {
    const records = readFileSync(resolve(ROOT, 'src/lib/records.ts'), 'utf8');
    expect(records).not.toMatch(/@\/crypto/);
    expect(records).not.toMatch(/cipher_format/);
  });

  it('the cycle write path is untouched by Phase 1A', () => {
    const cycle = readFileSync(resolve(ROOT, 'src/lib/cycle.ts'), 'utf8');
    expect(cycle).not.toMatch(/@\/crypto/);
  });
});

describe('no key material can reach a log', () => {
  it('crypto modules never console.log', () => {
    for (const file of productionCryptoFiles) {
      expect(/console\.(log|info|warn|error|debug)/.test(code(file)), `${relative(ROOT, file)}`).toBe(false);
    }
  });
});
