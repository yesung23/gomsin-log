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

  it('leaves no blanket suppression behind in the file it cleaned', () => {
    expect(read('src/components/widgets/PartnerDayTimelineWidget.tsx'))
      .not.toContain('eslint-disable');
  });

  it('keeps the react-refresh rule the second warning came from', () => {
    /*
      The other file this suite cleaned was `AttachmentMedia.tsx`, deleted in
      Phase 0 once it had been out of every production path for some time. Its
      assertion went with it, so what is pinned here now is the RULE rather than
      one file's compliance with it: as long as react-refresh is configured and
      lint fails on the first warning (asserted above), a module that exports both
      a component and a plain helper cannot land again.

      `RecordMediaGallery` is the surface that inherited the deleted component's
      job, and it keeps `attachmentUnavailableCopy` module-private for exactly
      this reason.
    */
    expect(read('eslint.config.js')).toContain('react-refresh');
    expect(read('src/components/media/RecordMediaGallery.tsx'))
      .not.toContain('export function attachmentUnavailableCopy');
  });
});
