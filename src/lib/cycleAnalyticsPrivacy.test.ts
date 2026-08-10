import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Cycle Analytics Privacy Guard', () => {
  const forbiddenFields = [
    'symptom',
    'flow',
    'pain',
    'note',
    'periodDate',
    'startDate',
    'endDate',
  ];

  it('ensures cycle analytics track calls never transmit raw health data fields', () => {
    const srcDir = resolve(process.cwd(), 'src');

    function scanFiles(dir: string): string[] {
      const entries = readdirSync(dir, { withFileTypes: true });
      let files: string[] = [];
      for (const entry of entries) {
        const res = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(scanFiles(res));
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
          files.push(res);
        }
      }
      return files;
    }

    const sourceFiles = scanFiles(srcDir);
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf8');
      // Match analytics track / logEvent calls
      const matches = content.match(/track\s*\(\s*['"][^'"]+cycle[^'"]*['"]\s*,\s*\{[^}]*\}\s*\)/gi);
      if (matches) {
        for (const match of matches) {
          for (const forbidden of forbiddenFields) {
            if (new RegExp(`\\b${forbidden}\\b`, 'i').test(match)) {
              violations.push(`${file}: ${match}`);
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
