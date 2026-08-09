import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { LegalPage } = await import('@/pages/LegalPage');

function renderLegal(doc: 'terms' | 'privacy') {
  return render(
    <MemoryRouter initialEntries={[`/legal/${doc}`]}>
      <Routes>
        <Route path="/legal/:doc" element={<LegalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LegalPage', () => {
  it('states the real service boundaries and fair liability terms', () => {
    renderLegal('terms');
    expect(screen.getByRole('heading', { name: '서비스 이용약관' })).toBeInTheDocument();
    expect(screen.getByText(/만 14세 이상만 가입/)).toBeInTheDocument();
    expect(screen.getByText(/군사기밀 또는 군 보안상/)).toBeInTheDocument();
    expect(screen.getByText(/고의 또는 중대한 과실/)).toBeInTheDocument();
    expect(screen.getByText(/중대하게 불리한 변경은 원칙적으로 30일 전/)).toBeInTheDocument();
  });

  it('discloses processors, local OCR, deletion and the current non-E2EE boundary', () => {
    renderLegal('privacy');
    expect(screen.getByRole('heading', { name: '개인정보 처리방침' })).toBeInTheDocument();
    expect(screen.getByText(/Supabase Inc/)).toBeInTheDocument();
    expect(screen.getByText(/Vercel Inc/)).toBeInTheDocument();
    expect(screen.getByText(/지도 캡처의 글자 인식\(OCR\)은 기기 안에서/)).toBeInTheDocument();
    expect(screen.getByText(/계정 삭제\(회원 탈퇴\)/)).toBeInTheDocument();
    expect(screen.getByText(/종단간 암호화\(E2EE\)가 아닙니다/)).toBeInTheDocument();
  });
});
