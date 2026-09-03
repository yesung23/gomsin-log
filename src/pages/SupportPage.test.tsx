import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { SupportPage } from '@/pages/SupportPage';
import { App } from '@/App';
import type { AppState } from '@/types';

const { mockState, mockStoreState } = vi.hoisted(() => {
  const state = {
    setupComplete: false,
    authenticatedUser: null as { id: string; email?: string } | null,
    profile: { id: 'u1', role: 'gomsin', couple: { connected: false } },
    onboardingStep: 0,
    records: [],
    events: [],
    trips: [],
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as unknown as AppState;

  const store = {
    state,
    isReady: true,
    authSyncUnavailable: false,
    authSyncReason: null,
    authSyncStage: null,
    accountDeletionRecovery: false,
    signOut: vi.fn(),
    retryAccountDeletion: vi.fn(),
  };

  return { mockState: state, mockStoreState: store };
});

vi.mock('@/lib/useStore', () => ({
  useStore: () => mockStoreState,
}));

vi.mock('@/lib/pushNotifications', () => ({
  listenForPushTaps: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@/lib/handwritingPreference', () => ({
  applyHandwritingAttribute: vi.fn(),
  loadHandwritingEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/components/NotificationReentryBridge', () => ({
  NotificationReentryBridge: () => null,
}));

vi.mock('@/pages/HomePage', () => ({
  HomePage: () => <div data-testid="home-page">HOME_PAGE</div>,
}));

vi.mock('@/pages/OnboardingPage', () => ({
  OnboardingPage: () => <div data-testid="onboarding-landing">ONBOARDING_LANDING</div>,
}));

describe('SupportPage Component', () => {
  it('renders contact email and 44px mailto CTA when contactEmail is provided', () => {
    render(
      <MemoryRouter>
        <SupportPage contactEmail="support@gomsinlog.app" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '고객지원' })).toBeInTheDocument();
    expect(screen.getByText('support@gomsinlog.app')).toBeInTheDocument();

    const mailtoLink = screen.getByRole('link', { name: /이메일로 문의하기/ });
    expect(mailtoLink).toBeInTheDocument();
    expect(mailtoLink).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:support@gomsinlog.app'),
    );
    expect(mailtoLink.className).toMatch(/min-h-11/);
    expect(mailtoLink.className).toMatch(/min-w-\[44px\]/);
    expect(mailtoLink.className).toMatch(/bg-coral-fill/);
    expect(mailtoLink.className).toMatch(/text-coral-fill-foreground/);
    expect(mailtoLink.className).not.toMatch(/\bbg-coral(?![\w/-])/);
    expect(mailtoLink.className).not.toMatch(/\btext-white\b/);
  });

  it('renders clear setup guidance and no personal data collection form when contactEmail is empty', () => {
    render(
      <MemoryRouter>
        <SupportPage contactEmail="" />
      </MemoryRouter>,
    );

    expect(screen.getByText('문의처 설정 안내')).toBeInTheDocument();
    expect(screen.getByText(/고객지원 문의처\(이메일\)가 아직 설정되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /이메일로 문의하기/ })).not.toBeInTheDocument();

    // YAGNI & privacy: strictly no form inputs or textareas collecting personal data
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('input')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('renders all four core support scopes and realistic response guidance', () => {
    render(
      <MemoryRouter>
        <SupportPage contactEmail="help@example.com" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '1. 로그인 및 커플 연결' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2. 기록 및 사진' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3. 계정 삭제 및 탈퇴' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '4. 개인정보 문의 및 권리 행사' })).toBeInTheDocument();

    // Realistic response policy without exaggeration
    expect(screen.getByText(/접수된 문의는 운영자가 순차적으로 확인 후 회신해 드립니다/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/24시간 365일 실시간/);
    expect(document.body.textContent).not.toMatch(/즉시 처리/);

    // Honest support copy: do not blame connection/internet without classification
    expect(screen.getByText(/오류가 발생한 단계나 진단 코드만 지원 문의로 전달/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/네트워크 연결 상태/);
    expect(document.body.textContent).not.toMatch(/인터넷 연결/);
    expect(screen.getByText(/앱이 다시 연결되면 서버 전송을 재시도/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/자동으로 서버와 동기화됩니다/);
    expect(screen.getByText(/일부 운영 백업은 개인정보 처리방침에 적힌 제한된 기간 뒤 삭제/)).toBeInTheDocument();

    // Honest unlink copy: blocks new server query/sync without false remote-revocation claims
    expect(screen.getByText(/서버에서 새로운 공유 기록 조회 및 실시간 동기화 접근이 즉시 차단/)).toBeInTheDocument();
    expect(screen.getByText(/이미 다운로드되거나 보관된 기존 데이터 사본을 원격으로 회수하거나 삭제하는 것은 아닙니다/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/상대방 기기의 기존 사본까지 완전히 삭제/);
  });

  it('warns users never to send sensitive records in email', () => {
    render(
      <MemoryRouter>
        <SupportPage contactEmail="help@example.com" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '개인정보 및 보안 유의사항' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /보안과 개인정보 보호를 위해 비밀번호, 민감한 개인 기록·일기 내용, 건강·생리 정보, 부대 위치나 군사기밀 등 민감한 원자료를 이메일 본문이나 첨부파일로 보내지 마세요/,
      ),
    ).toBeInTheDocument();
  });

  it('provides accessible links to privacy policy and terms of service with 44px min touch targets', () => {
    render(
      <MemoryRouter>
        <SupportPage contactEmail="help@example.com" />
      </MemoryRouter>,
    );

    const privacyLink = screen.getByRole('link', { name: /개인정보 처리방침/ });
    const termsLink = screen.getByRole('link', { name: /서비스 이용약관/ });

    expect(privacyLink).toBeInTheDocument();
    expect(privacyLink).toHaveAttribute('href', '/legal/privacy');
    expect(privacyLink.className).toMatch(/min-h-11/);
    expect(privacyLink.className).toMatch(/min-w-\[44px\]/);

    expect(termsLink).toBeInTheDocument();
    expect(termsLink).toHaveAttribute('href', '/legal/terms');
    expect(termsLink.className).toMatch(/min-h-11/);
    expect(termsLink.className).toMatch(/min-w-\[44px\]/);
  });

  it('does not render bottom navigation or false tab semantics on public /support', () => {
    render(
      <MemoryRouter>
        <SupportPage contactEmail="help@example.com" />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('navigation', { name: '하단 내비게이션' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('renders bottom navigation with five destination links and no tab roles by default', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <MobileShell>
          <div>인증 화면 본문</div>
        </MobileShell>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: '하단 내비게이션' });
    const links = within(navigation).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute('aria-label')))
      .toEqual(['홈', '찾기', '일기장', '일정', '우리']);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});

describe('SupportPage App Router Integration', () => {
  beforeEach(() => {
    mockStoreState.accountDeletionRecovery = false;
    mockStoreState.authSyncUnavailable = false;
    mockState.setupComplete = false;
    mockState.authenticatedUser = null;
  });

  it('allows unauthenticated and incomplete onboarding users to reach /support directly', async () => {
    mockState.setupComplete = false;
    mockState.authenticatedUser = null;

    render(
      <MemoryRouter initialEntries={['/support']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '고객지원' })).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-landing')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '하단 내비게이션' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('allows authenticated users to reach /support directly', async () => {
    mockState.setupComplete = true;
    mockState.authenticatedUser = { id: 'u1', email: 'user@example.com' };

    render(
      <MemoryRouter initialEntries={['/support']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '고객지원' })).toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
  });

  it('remains reachable during accountDeletionRecovery', async () => {
    mockStoreState.accountDeletionRecovery = true;

    render(
      <MemoryRouter initialEntries={['/support']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '고객지원' })).toBeInTheDocument();
  });

  it('remains reachable during authSyncUnavailable', async () => {
    mockStoreState.authSyncUnavailable = true;
    mockStoreState.authSyncReason = 'server';
    mockStoreState.authSyncStage = 'init';

    render(
      <MemoryRouter initialEntries={['/support']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '고객지원' })).toBeInTheDocument();
  });
});
