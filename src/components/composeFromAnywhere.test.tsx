import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';

/**
 * Writing a record is one tap from every tab.
 *
 * PRODUCT_V3 §7.1 asks for a thirty-second capture and makes the 기록 tab's entry
 * point non-removable. It did not ask for the OTHER four tabs to be dead ends,
 * but they were: the composer existed on `/record` behind a floating CTA and on
 * Home inside a widget the user is free to delete, so from 일정, 우리, 마이 -- or
 * from a Home someone had tidied -- capturing a thought started with navigation.
 *
 * The button is deliberately NOT a sixth tab. §5 fixes the five, and the canonical
 * set is one of the things that must not drift. This is an action rather than a
 * place, so it floats over the bar instead of joining it.
 */

vi.mock('@/components/InstallPromptBanner', () => ({ InstallPromptBanner: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/SharedSyncBanner', () => ({ SharedSyncBanner: () => null }));

const { MobileShell } = await import('@/components/MobileShell');

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MobileShell>
        <p>본문</p>
      </MobileShell>
    </MemoryRouter>,
  );
}

const compose = () => screen.queryByRole('link', { name: '기록 남기기' });

describe('compose is reachable from every tab', () => {
  for (const path of ['/home', '/schedule', '/us', '/my']) {
    it(`offers it on ${path}`, () => {
      renderShell(path);
      expect(compose()).toBeInTheDocument();
    });
  }

  it('routes to the composer already open, not merely to the 기록 tab', () => {
    renderShell('/home');
    // Addressable rather than router state: §7.5 wants the same of a record, and
    // for the same reason -- a reload or a deep link has to be able to arrive here.
    expect(compose()).toHaveAttribute('href', '/record?compose=1');
  });
});

describe('it never competes with a screen that already pins one', () => {
  it('is withheld on /record, whose own CTA opens the same composer', () => {
    renderShell('/record');
    expect(compose()).not.toBeInTheDocument();
  });

  it('is withheld on a trip detail, which pins its own pair', () => {
    renderShell('/trips/abc');
    expect(compose()).not.toBeInTheDocument();
  });

  it('is still offered on the trips LIST, which pins nothing', () => {
    // A prefix match swallowed this one, and that is why the check is a predicate.
    // The list is an ordinary screen, and a thought worth recording can easily
    // arrive while reading back a trip -- making the screen most likely to prompt
    // a memory the one screen with no way to keep it.
    renderShell('/trips');
    expect(compose()).toBeInTheDocument();
  });
});

describe('the five tabs are still five', () => {
  it('does not become a sixth tab', () => {
    renderShell('/home');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(compose()).not.toHaveAttribute('role', 'tab');
  });
});

/**
 * One action, one name, everywhere it appears.
 *
 * The shell button and `/record`'s floating CTA open the same composer, and for a
 * while they called it two different things -- `기록 남기기` and `지금의 마음 남기기`.
 * A person who learns a control by its label on one screen should recognise it on
 * the next; two names for one action makes them look like two features, and the
 * evocative one had also drifted from what a record IS now that the feeling is a
 * separate question the composer asks afterwards.
 *
 * Checked in source rather than by rendering, because the third site is a dialog's
 * accessible name that only exists once the sheet is open.
 */
describe('the compose action has one name', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

  it('uses the same label in the shell, the CTA and the sheet it opens', () => {
    const shell = read('src/components/MobileShell.tsx');
    const record = read('src/pages/RecordPage.tsx');

    expect(shell).toContain('aria-label="기록 남기기"');
    expect(record).toContain('<span>기록 남기기</span>');
    expect(record).toContain('aria-label="기록 남기기"');
  });

  it('has no second name left for it', () => {
    for (const path of ['src/components/MobileShell.tsx', 'src/pages/RecordPage.tsx']) {
      expect(read(path)).not.toContain('지금의 마음 남기기');
    }
  });
});
