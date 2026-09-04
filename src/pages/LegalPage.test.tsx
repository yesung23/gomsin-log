import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
    expect(screen.getByText(/최종 개정일: 2026-09-04 · 시행일: 2026-09-11/)).toBeInTheDocument();
    expect(screen.getByText(/시행일은 2026-09-11입니다/)).toBeInTheDocument();
    expect(screen.getByText(/서로 연결을 원하는 두 이용자가 1:1 비공개 공간/)).toBeInTheDocument();
    expect(screen.getByText(/군 복무 커플은 복무 디데이를 선택적으로 사용/)).toBeInTheDocument();
    expect(screen.getByText(/만 14세 이상만 가입/)).toBeInTheDocument();
    expect(screen.getByText(/군사기밀 또는 군 보안상/)).toBeInTheDocument();
    expect(screen.getByText(/고의 또는 중대한 과실/)).toBeInTheDocument();
    expect(screen.getByText(/중대하게 불리한 변경은 원칙적으로 30일 전/)).toBeInTheDocument();
    expect(screen.getByText(/신규 업로드는 사진만 가능하며, 기존에 등록된 영상·음성은 재생·조회할 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/일회성 운영 백업이 작성된 경우 해당 변경 검증 또는 작업 취소 후 7일 이내에 삭제됩니다/)).toBeInTheDocument();
    expect(screen.queryByText(/백업 정리 기간을 제외하고/)).not.toBeInTheDocument();
  });

  it('discloses processors, legacy media preservation, accurate operational backup and E2EE scope', () => {
    renderLegal('privacy');
    expect(screen.getByRole('heading', { name: '개인정보 처리방침' })).toBeInTheDocument();
    expect(screen.getByText(/최종 개정일: 2026-09-04 · 시행일: 2026-09-11/)).toBeInTheDocument();
    expect(screen.getByText(/시행일은 2026-09-11이며/)).toBeInTheDocument();
    expect(screen.getByText(/관계 유형\(군 복무\/일반\), 서비스 내부 멤버 구분값/)).toBeInTheDocument();
    expect(screen.getByText(/성별 응답\(선택\): 여성, 남성 또는 미응답/)).toBeInTheDocument();
    expect(screen.getByText(/성별 응답은 상대방에게 제공하지 않으며/)).toBeInTheDocument();
    expect(screen.getByText(/건강 기능이나 접근 권한을 결정하는 데 사용하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/주기 정보\(선택·민감 가능\)/)).toBeInTheDocument();
    expect(screen.getByText(/Supabase Inc/)).toBeInTheDocument();
    expect(screen.getByText(/Vercel Inc/)).toBeInTheDocument();
    expect(screen.getByText(/지도 캡처의 글자 인식\(OCR\)은 기기 안에서/)).toBeInTheDocument();
    expect(screen.getByText(/계정 삭제\(회원 탈퇴\)/)).toBeInTheDocument();
    expect(screen.getByText(/미디어\(선택\): 사진, 영상, 음성 및 파일명·종류·저장경로/)).toBeInTheDocument();
    expect(screen.getByText(/신규 업로드는 사진만 가능하며, 기존에 업로드된 영상·음성은 재생할 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/기존 영상·음성 원본의 촬영 시각, 기기 정보 또는 위치 관련 메타데이터는 자동 제거를 보장하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/정기 관리형 백업이나 시점 복구\(PITR\)는 운영하지 않으며/)).toBeInTheDocument();
    expect(screen.getByText(/일회성 운영 백업을 생성할 수 있습니다.*7일 이내에 삭제하고 확인 기록을 남깁니다/)).toBeInTheDocument();
    expect(screen.getByText(/서비스 전체나 사진·영상·음성 등 첨부 미디어에 일괄적인 종단간 암호화\(E2EE\)가 적용된 것은 아닙니다/)).toBeInTheDocument();
    expect(screen.getByText(/지원되는 iPhone native 앱에서 사용자가 기기 보호 설정을 완료한 기록 본문에만 선택적으로 종단간 암호화\(E2EE\)가 적용될 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/웹\/PWA 및 보호 미완료 기록 본문은 대상이 아니며, 사진·영상·음성 원본 파일은 비공개 Storage에 저장되지만 종단간 암호화가 적용되지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/제한된 운영 권한으로 장애 대응, 보안 사고 조사 또는 법적 의무 이행에 필요한 범위에서 접근할 기술적 가능성이 있습니다/)).toBeInTheDocument();
  });

  it('guards against regression of prohibited phrases across terms and privacy', () => {
    const { unmount } = renderLegal('terms');
    expect(document.body.textContent).not.toMatch(/백업 정리 기간/);
    expect(document.body.textContent).not.toMatch(/기록, 사진·영상·음성/);
    expect(document.body.textContent).not.toMatch(/2026-08-09/);
    expect(document.body.textContent).not.toMatch(/프로필\(필수\): 닉네임, 역할\(곰신\/군화\)/);
    unmount();

    renderLegal('privacy');
    expect(document.body.textContent).not.toMatch(/정해진 순환 주기/);
    expect(document.body.textContent).not.toMatch(/순환 주기에 따라 덮어씁니다/);
    expect(document.body.textContent).not.toMatch(/완전히 삭제합니다/);
    expect(document.body.textContent).not.toMatch(/종단간 암호화\(E2EE\)가 아닙니다/);
    expect(document.body.textContent).not.toMatch(/현재 서버에 저장되는 기록과 미디어는 서비스 수준의 종단간 암호화/);
    expect(document.body.textContent).not.toMatch(/2026-08-09/);
  });

  it('does not render bottom navigation or authenticated tabs on public legal pages', () => {
    renderLegal('terms');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '홈' })).not.toBeInTheDocument();
  });
});
