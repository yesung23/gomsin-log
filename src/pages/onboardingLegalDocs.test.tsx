import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';

/**
 * The two documents a user is asked to agree to before an account exists.
 *
 * They used to be `<a href="/legal/terms" target="_blank">`. In the packaged app the
 * WebView origin is `capacitor://localhost` (iOS) / `https://localhost` (Android), so
 * `target="_blank"` handed that origin to the system browser and Safari showed a
 * `https://localhost` connection failure. The required consent documents were
 * unreachable on the exact platform the store submission is for, and the attempt took
 * the user out of onboarding.
 *
 * These tests assert the fix from both directions: the documents must be readable
 * in-app, and reading one must never be mistaken for consenting to it.
 */

const signInWithGoogle = vi.fn(async () => ({ error: null }));
const signInWithApple = vi.fn(async () => ({ error: null }));
const signInWithEmail = vi.fn(async () => ({ error: null }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  authRepository: { signInWithGoogle, signInWithApple, signInWithEmail },
  fetchAuthProviderAvailability: async () => ({ google: true, apple: true, email: true }),
  createCoupleInvitation: vi.fn(),
  consumeCoupleInvitation: vi.fn(),
  fetchMyCoupleState: vi.fn(),
  regenerateCoupleInvitation: vi.fn(),
  saveCoupleAnniversary: vi.fn(),
  supabase: null,
}));

function makeState(): AppState {
  return {
    setupComplete: false,
    onboardingStep: 0,
    authenticatedUser: undefined,
    profile: {
      id: '', myName: '', role: 'gomsin',
      couple: {
        coupleId: '', partnerName: '', anniversaryDate: '',
        coupleCode: '', connected: false, status: 'pending',
      },
      military: {} as never,
      contact: {} as never,
    },
    records: [], events: [], trips: [],
    widgetLayout: [], hasSeenInstallPrompt: true, theme: 'light',
  };
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: makeState(),
    isReady: true,
    updateProfile: vi.fn(),
    setSetupComplete: vi.fn(),
    setOnboardingStep: vi.fn(),
    recoverExpiredSession: vi.fn(),
  }),
}));

const { OnboardingPage } = await import('@/pages/OnboardingPage');

function renderLanding() {
  return render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
}

const termsTrigger = () => screen.getByRole('button', { name: '서비스 이용약관' });
const privacyTrigger = () => screen.getByRole('button', { name: '개인정보 처리방침' });
const ageBox = () => screen.getByRole('checkbox', { name: /만 14세/ });
const legalBox = () => screen.getByRole('checkbox', { name: /이용약관/ });
const sheet = () => screen.getByTestId('legal-document-sheet');

/** The same selector the sheet's focus trap uses. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

beforeEach(() => {
  signInWithGoogle.mockClear();
  signInWithApple.mockClear();
});

describe('the consent documents never leave the app', () => {
  it('offers no target="_blank" escape to the system browser', () => {
    renderLanding();

    // The whole consent row, not just the two controls: a stray anchor anywhere in
    // it would reintroduce the https://localhost dead end.
    for (const el of document.querySelectorAll('a')) {
      expect(el).not.toHaveAttribute('target', '_blank');
    }
    expect(document.querySelector('a[href="/legal/terms"]')).toBeNull();
    expect(document.querySelector('a[href="/legal/privacy"]')).toBeNull();
  });

  it('opens each document as an in-app dialog rather than navigating', async () => {
    const user = userEvent.setup();
    renderLanding();
    expect(screen.queryByTestId('legal-document-sheet')).not.toBeInTheDocument();

    await user.click(termsTrigger());
    expect(sheet()).toHaveAttribute('data-legal-doc', 'terms');
    expect(within(sheet()).getByText(/제1조 \(목적과 운영자\)/)).toBeInTheDocument();
    expect(within(sheet()).getByText(/만 14세 이상만 가입/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '서비스 이용약관 닫기' }));
    expect(screen.queryByTestId('legal-document-sheet')).not.toBeInTheDocument();

    await user.click(privacyTrigger());
    expect(sheet()).toHaveAttribute('data-legal-doc', 'privacy');
    expect(within(sheet()).getByText(/1\. 개인정보처리자와 방침의 범위/)).toBeInTheDocument();
    expect(within(sheet()).getByText(/Supabase Inc/)).toBeInTheDocument();
  });

  it('closes on Escape as well as on the close button', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(termsTrigger());
    expect(sheet()).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('legal-document-sheet')).not.toBeInTheDocument();
  });
});

describe('reading a document does not change what the user has agreed to', () => {
  it('keeps both checkboxes exactly as they were across open and close', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(ageBox());
    expect(ageBox()).toBeChecked();
    expect(legalBox()).not.toBeChecked();

    await user.click(termsTrigger());
    // Opening must not tick the enclosing label's checkbox.
    expect(legalBox()).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '서비스 이용약관 닫기' }));

    expect(ageBox()).toBeChecked();
    expect(legalBox()).not.toBeChecked();

    await user.click(privacyTrigger());
    expect(legalBox()).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '개인정보 처리방침 닫기' }));

    expect(ageBox()).toBeChecked();
    expect(legalBox()).not.toBeChecked();
  });

  it('preserves an already-given agreement rather than resetting the wizard', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(ageBox());
    await user.click(legalBox());
    expect(legalBox()).toBeChecked();

    await user.click(termsTrigger());
    await user.click(screen.getByRole('button', { name: '서비스 이용약관 닫기' }));

    expect(ageBox()).toBeChecked();
    expect(legalBox()).toBeChecked();
  });

  it('does not let a read stand in for consent at the sign-in gate', async () => {
    const user = userEvent.setup();
    renderLanding();
    const google = await screen.findByRole('button', { name: /Google로 계속하기/ });

    await user.click(termsTrigger());
    await user.click(screen.getByRole('button', { name: '서비스 이용약관 닫기' }));
    await user.click(privacyTrigger());
    await user.click(screen.getByRole('button', { name: '개인정보 처리방침 닫기' }));

    // Both documents read, neither box ticked: the gate must still be shut.
    expect(google).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('위 두 항목에 동의하면 로그인할 수 있어요.')).toBeInTheDocument();
    await user.click(google);
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  /**
   * A button inside a `<label>` is safe only by the spec clause that a label does
   * nothing for events targeted at interactive descendants. That is one behaviour, in
   * one clause, standing between "read the terms" and "silently agree to the terms" --
   * and it is not a rule this screen needs to depend on. The structural guarantee is
   * cheaper: the buttons are siblings of the label, not descendants of it.
   */
  it('puts no interactive control inside any label', () => {
    renderLanding();

    for (const label of Array.from(document.querySelectorAll('label'))) {
      const nested = label.querySelectorAll(
        'button, a[href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      expect(nested, `label "${label.textContent}" contains interactive content`).toHaveLength(0);

      // The only control a label may contain is its own checkbox.
      for (const input of Array.from(label.querySelectorAll('input'))) {
        expect(input.getAttribute('type')).toBe('checkbox');
      }
    }
  });

  it('keeps the document buttons outside the consent label', () => {
    renderLanding();
    expect(termsTrigger().closest('label')).toBeNull();
    expect(privacyTrigger().closest('label')).toBeNull();
  });

  it('keeps the sentence itself a tap target for the checkbox', async () => {
    const user = userEvent.setup();
    renderLanding();
    expect(legalBox()).not.toBeChecked();

    // The text either side of the buttons still belongs to the checkbox.
    await user.click(screen.getByText('을 확인하고 동의합니다.'));
    expect(legalBox()).toBeChecked();
  });

  it('does not toggle the checkbox when a document is opened by keyboard', async () => {
    const user = userEvent.setup();
    renderLanding();
    expect(legalBox()).not.toBeChecked();

    termsTrigger().focus();
    await user.keyboard('{Enter}');
    expect(sheet()).toHaveAttribute('data-legal-doc', 'terms');
    expect(legalBox()).not.toBeChecked();
    await user.keyboard('{Escape}');

    privacyTrigger().focus();
    await user.keyboard(' ');
    expect(sheet()).toHaveAttribute('data-legal-doc', 'privacy');
    expect(legalBox()).not.toBeChecked();
  });

  it('offers no agree control inside the document itself', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(termsTrigger());

    const buttons = within(sheet()).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('서비스 이용약관 닫기');
    expect(within(sheet()).queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('the document sheet is usable by everyone', () => {
  it('gives both checkbox controls and each legal document action a 44px hit area', () => {
    renderLanding();

    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toHaveClass('h-11', 'w-11');
    }
    for (const trigger of [termsTrigger(), privacyTrigger()]) {
      expect(trigger).toHaveClass('min-h-11', 'min-w-11');
    }
  });

  it('is a labelled modal dialog naming the document it shows', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(privacyTrigger());

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('개인정보 처리방침');
  });

  it('gives the close control a 44px target and moves focus to it on open', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(termsTrigger());

    const close = screen.getByRole('button', { name: '서비스 이용약관 닫기' });
    // `min-h-11` / `min-w-11` is the 44px floor this codebase uses for tap targets.
    expect(close).toHaveClass('min-h-11', 'min-w-11');
    expect(close).toHaveFocus();
  });

  it('returns focus to the link that opened the document', async () => {
    const user = userEvent.setup();
    renderLanding();
    const trigger = termsTrigger();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '서비스 이용약관 닫기' }));

    expect(termsTrigger()).toHaveFocus();
    expect(termsTrigger()).toBe(trigger);
  });

  /**
   * `aria-modal="true"` is a promise, and without a focus trap the markup does not keep
   * it: Tab walks out of the dialog and into the consent checkboxes and the sign-in
   * buttons behind it. That is the one place a stray keystroke must not land, because
   * the whole point of the sheet is that reading is not consenting.
   */
  it('keeps Tab on the close button when it is the only focusable element', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(termsTrigger());

    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: '서비스 이용약관 닫기' });
    expect(close).toHaveFocus();

    /*
      The contact block renders a `mailto:` link only when VITE_PRIVACY_CONTACT_EMAIL is
      configured, and `.env` is gitignored and machine-local -- so the dialog holds one
      focusable element on a bare checkout and two on a configured one. Stripping the
      others makes THIS test the single-element case on every machine, instead of
      quietly testing something different depending on who runs it.
    */
    for (const el of focusablesIn(dialog)) {
      if (el !== close) el.remove();
    }
    expect(focusablesIn(dialog)).toEqual([close]);

    close.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it('never lets Tab reach a background control while the dialog is open', async () => {
    const user = userEvent.setup();
    renderLanding();
    const google = await screen.findByRole('button', { name: /Google로 계속하기/ });
    await user.click(termsTrigger());

    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }

    expect(document.activeElement).not.toBe(google);
    expect(document.activeElement).not.toBe(ageBox());
    expect(document.activeElement).not.toBe(legalBox());
    expect(document.activeElement).not.toBe(privacyTrigger());
  });

  it('pulls focus back in when a tap on the document text blurs to the body', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(termsTrigger());
    const dialog = screen.getByRole('dialog');

    // Long prose: tapping a paragraph is ordinary use, and it leaves focus on <body>.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(dialog).not.toContainElement(document.activeElement as HTMLElement);

    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '서비스 이용약관 닫기' }),
    );
  });

  /**
   * With a single focusable element first === last, so the wrap is degenerate and
   * "focus never moves" would pass a trap that does not actually cycle. Adding a second
   * element proves the real first <-> last wrap, and keeps working as the document
   * grows controls -- the `mailto:` contact link, or anything after it.
   */
  it('cycles first <-> last when the document holds more than one focusable', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(termsTrigger());

    const dialog = screen.getByRole('dialog');
    const scroller = dialog.querySelector('.overflow-y-auto');
    expect(scroller).not.toBeNull();

    // Appended so there are at least two on every machine, whatever `.env` holds.
    const injected = document.createElement('button');
    injected.type = 'button';
    injected.textContent = '연락처';
    scroller?.appendChild(injected);

    const focusable = focusablesIn(dialog);
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(first).toBe(screen.getByRole('button', { name: '서비스 이용약관 닫기' }));
    expect(last).toBe(injected);

    first.focus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    await user.tab();
    expect(first).toHaveFocus();

    injected.remove();
  });

  it('still closes on Escape and still returns focus with the trap installed', async () => {
    const user = userEvent.setup();
    renderLanding();
    const trigger = privacyTrigger();

    await user.click(trigger);
    await user.tab();
    await user.tab({ shift: true });
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('legal-document-sheet')).not.toBeInTheDocument();
    expect(privacyTrigger()).toHaveFocus();
    expect(privacyTrigger()).toBe(trigger);
  });

  it('respects the safe area and scrolls the document, not the page', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(termsTrigger());

    expect(sheet()).toHaveClass('pt-[env(safe-area-inset-top,0px)]');

    // A long document must scroll inside the sheet so the close control cannot be
    // pushed off-screen by clause twelve.
    const scroller = sheet().querySelector('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller).toHaveClass('flex-1', 'pb-[max(env(safe-area-inset-bottom,0px),1.5rem)]');
    expect(within(sheet()).getByText(/제12조 \(약관 변경과 분쟁\)/)).toBeInTheDocument();
  });
});
