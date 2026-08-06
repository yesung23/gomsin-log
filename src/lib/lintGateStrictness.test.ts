import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Bug condition:
 *   isBugCondition(repo) = the lint gate reports warnings and exits 0.
 *
 * `npm run lint` was `eslint .`, which exits 0 for any number of warnings. The
 * handoff document claimed "ESLint 오류·경고 0" and CI printed a green tick for
 * `npm run lint`, while the tree actually carried two warnings:
 *
 *   src/components/AttachmentMedia.tsx:15         react-refresh/only-export-components
 *   src/components/widgets/PartnerDayTimelineWidget.tsx:76
 *                                                 unused eslint-disable directive
 *
 * Both arrived in already-merged work. Neither is cosmetic:
 *
 *   - the react-refresh warning means editing that module full-reloads the app
 *     instead of hot-updating it, which is exactly the feedback loop the warning
 *     exists to protect;
 *   - an unused `eslint-disable react-hooks/exhaustive-deps` is a suppression that
 *     no longer suppresses anything. Left in place it silently covers the NEXT
 *     dependency mistake in that hook.
 *
 * A gate that cannot fail is not a gate, so the count is now enforced by the
 * command rather than by a sentence in a document.
 */

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

describe('the lint gate can actually fail', () => {
  it('fails the command on the first warning', () => {
    expect(scripts.lint).toBe('eslint . --max-warnings 0');
  });

  it('is part of the gate that CI and the handoff both name', () => {
    // If `verify` stopped chaining lint, the strictness above would be unreachable
    // from the one command contributors are told to run.
    expect(scripts.verify).toContain('npm run lint');
    expect(read('.github/workflows/v1-product-excellence-audit-pr-validation.yml'))
      .toContain('run: npm run lint');
  });

  it('keeps the flat config reporting unused suppressions', () => {
    // ESLint 9 reports unused disable directives by default; an explicit
    // `linterOptions.reportUnusedDisableDirectives: 'off'` would make the
    // strictness above pass over exactly the second warning it was added for.
    expect(read('eslint.config.js')).not.toContain('reportUnusedDisableDirectives');
  });

  it('leaves no blanket suppression behind in the two files it cleaned', () => {
    expect(read('src/components/widgets/PartnerDayTimelineWidget.tsx'))
      .not.toContain('eslint-disable');
    // The helper stays in the component file but is no longer exported, so the
    // module exports components only and Fast Refresh works again.
    expect(read('src/components/AttachmentMedia.tsx'))
      .not.toContain('export function attachmentUnavailableCopy');
  });
});
