import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { ShopPage } = await import('./ShopPage');

function renderShop() {
  return render(
    <MemoryRouter initialEntries={['/shop']}>
      <ShopPage />
    </MemoryRouter>,
  );
}

describe('ShopPage (다꾸 상점 화면)', () => {
  beforeEach(() => {
    navigate.mockReset();
  });

  it('화면이 렌더링되고 헤더와 정직한 안내 카드가 표시된다', () => {
    renderShop();
    expect(screen.getByRole('heading', { name: '다꾸 상점' })).toBeInTheDocument();
    expect(screen.getByText('아직 결제를 열지 않았어요 · 준비 중')).toBeInTheDocument();
    expect(screen.getByText(/기본 스티커 12종은 일기장 지면에서 언제든 무료로/)).toBeInTheDocument();
  });

  it('세 가지 카테고리(스티커, 다꾸 테마, 책 만들기) 탭이 제공된다', () => {
    renderShop();
    const tablist = screen.getByRole('tablist', { name: '상품 카테고리' });
    expect(tablist).toBeInTheDocument();

    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual([
      '전체',
      '스티커',
      '다꾸 테마',
      '책 만들기',
    ]);
  });

  it('카테고리 탭 클릭 시 해당 카테고리 상품만 필터링된다', async () => {
    const user = userEvent.setup();
    renderShop();

    // 스티커 탭 클릭
    await user.click(screen.getByRole('tab', { name: '스티커' }));
    expect(screen.getByText('군화·곰신 일상 스티커 팩 (후보)')).toBeInTheDocument();
    expect(screen.queryByText('빈티지 크라프트지 테마 (미리보기)')).not.toBeInTheDocument();
    expect(screen.queryByText('우리의 한 달 기억책 (상품 후보)')).not.toBeInTheDocument();

    // 다꾸 테마 탭 클릭
    await user.click(screen.getByRole('tab', { name: '다꾸 테마' }));
    expect(screen.getByText('빈티지 크라프트지 테마 (미리보기)')).toBeInTheDocument();
    expect(screen.queryByText('군화·곰신 일상 스티커 팩 (후보)')).not.toBeInTheDocument();
    expect(screen.queryByText('우리의 한 달 기억책 (상품 후보)')).not.toBeInTheDocument();

    // 책 만들기 탭 클릭
    await user.click(screen.getByRole('tab', { name: '책 만들기' }));
    expect(screen.getByText('우리의 한 달 기억책 (상품 후보)')).toBeInTheDocument();
    expect(screen.queryByText('군화·곰신 일상 스티커 팩 (후보)')).not.toBeInTheDocument();
    expect(screen.queryByText('빈티지 크라프트지 테마 (미리보기)')).not.toBeInTheDocument();
  });

  it('모든 상품에 결제 대신 준비 중 상태가 정직하게 표시되고 버튼이 비활성화된다', () => {
    renderShop();
    const readyButtons = screen.getAllByRole('button', { name: /준비 중$/ });
    expect(readyButtons.length).toBeGreaterThanOrEqual(8);
    for (const btn of readyButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it('가짜 가격이나 결제 버튼이 노출되지 않는다', () => {
    renderShop();
    expect(screen.queryByText(/₩|\d+원/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /결제|구매하기|구독/ })).not.toBeInTheDocument();
  });

  it('확정되지 않은 상품 사양이나 배송/제작 확정 약속 카피가 노출되지 않는다', () => {
    renderShop();
    expect(
      screen.queryByText(/배송해 드려요|프리미엄 하드커버|맞춤 각인|실물 & 디지털 선택 가능|24종|20종|16종/),
    ).not.toBeInTheDocument();
  });

  it('뒤로 가기 버튼이 일기장(/diary)으로 돌아간다', async () => {
    const user = userEvent.setup();
    renderShop();

    const backBtn = screen.getByRole('button', { name: '일기장으로 돌아가기' });
    expect(backBtn).toBeInTheDocument();
    await user.click(backBtn);
    expect(navigate).toHaveBeenCalledWith('/diary');
  });
});
