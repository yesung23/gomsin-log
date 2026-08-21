import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

describe('the Deno type-check gate covers every edge function', () => {
  /*
    Same failure shape as the lint gate above, one layer over.

    `check:edge` does not take a directory; it names each file. That is a gate
    whose coverage is a list someone has to remember to extend, and the cost of
    forgetting is invisible: the new function is simply never type-checked, the
    command still exits 0, and CI still prints a green tick for "Deno Edge
    Function validation".

    Edge functions are where the service key lives. A file that ships without a
    type check there is not the same risk as an unchecked component.

    So the list is checked against the tree. Adding a function now fails this
    test until the gate is told about it, which is the moment the author is
    already in `supabase/functions/` and can fix it in one line.
  */
  const edgeSources = execFileSync('git', ['ls-files', 'supabase/functions'], {
    encoding: 'utf8',
    cwd: process.cwd(),
  })
    .split('\n')
    .filter((file) => file.endsWith('.ts') && !file.endsWith('_test.ts'));

  it('finds edge sources to check in the first place', () => {
    // Guards the assertion below: an empty list would make it vacuously true,
    // and a `git ls-files` that silently returns nothing is exactly how such a
    // test starts passing for the wrong reason.
    expect(edgeSources.length).toBeGreaterThan(5);
  });

  it('names every one of them', () => {
    const missing = edgeSources.filter((file) => !scripts['check:edge'].includes(file));
    expect(missing).toEqual([]);
  });
});

describe('the push client has no function that only its own tests call', () => {
  /*
    Third time for this shape, so it gets a gate.

      - `listenForPushTaps` was written, tested, and never wired. Tapping a
        notification did nothing.
      - `clearOwnUnseen` was written, tested, and never wired. Reading everything
        in the app did not stop tomorrow's notification about it.
      - `EmotionChipEditor` was rendered nowhere and kept alive by a theme-token
        list, still carrying the §13 violation its replacement was written to fix.

    All three passed every gate this repository has, because a suite that imports
    a function proves the function works, never that anything calls it. The push
    client is scoped here rather than the whole tree: every export in these two
    modules exists to be invoked at a specific moment in a lifecycle, so one with
    no production caller is a moment that silently does not happen.
  */
  const MODULES = ['src/lib/pushTokens.ts', 'src/lib/pushNotifications.ts']

  const sources = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8', cwd: process.cwd() })
    .split('\n')
    .filter((file) => (file.endsWith('.ts') || file.endsWith('.tsx'))
      && !file.includes('.test.')
      && !file.startsWith('src/test/'))

  for (const module of MODULES) {
    const exported = [...read(module).matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1])

    it(`finds exports to check in ${module}`, () => {
      // Guards the assertion below: an empty list would make it vacuous, and a
      // renamed export keyword is exactly how that would happen unnoticed.
      expect(exported.length).toBeGreaterThan(0)
    })

    it(`every export of ${module} is called from production code`, () => {
      /*
        The module's own file counts, minus its definitions.

        The first version excluded it, and immediately flagged `pushSupported` --
        which is called twice inside the module and is simply not part of the
        public surface. That is a different thing from "nothing calls this", and
        conflating them would have made the gate a nuisance that gets deleted.

        An import alone is not a call either: requiring the name followed by `(`
        is what separates wiring from a type-only or re-export reference.
      */
      const unwired = exported.filter((name) => !sources.some((file) => {
        /*
          Comments are stripped first. Without that, commenting a call OUT still
          satisfied the gate -- verified by mutation, where disconnecting
          `clearOwnUnseen` left this green. A check that a disabled call
          satisfies is checking that someone typed the name, which is the class
          of test this file exists to argue against.
        */
        const stripped = read(file)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        const text = file === module
          ? stripped.replace(new RegExp(`export (?:async )?function ${name}\\b`, 'g'), '')
          : stripped
        return new RegExp(`\\b${name}\\s*\\(`).test(text)
      }))
      expect(unwired).toEqual([])
    })
  }
})
