import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ListRow, RowGroup } from '@/components/ui/List';

/**
 * `data-*` 가 실제로 DOM 에 붙는가.
 *
 * TypeScript 는 JSX 의 하이픈 붙은 속성을 검사하지 않는다. `ListRow` 가 그것을 받아
 * 넘기지 않던 동안, 쓰는 쪽의 `data-trip-row={index}` 는 **타입 검사를 통과하고 화면에는
 * 아무것도 붙지 않았다.** 손가락 좌표로 줄을 찾는 여행 순서 바꾸기가 그 표식을 못 찾아
 * 아무 일도 하지 않았고, 그때 이 저장소의 3,100개 테스트는 전부 초록이었다.
 *
 * 이 파일은 그 침묵을 막는다. 통과시키는 것을 그만두면 여기서 걸린다.
 */
describe('ListRow 는 data-* 를 DOM 까지 넘긴다', () => {
  it('붙인 표식이 실제로 문서에 있다', () => {
    const { container } = render(
      <RowGroup>
        <ListRow data-trip-row={0}>첫째</ListRow>
        <ListRow data-trip-row={1}>둘째</ListRow>
      </RowGroup>,
    );
    const rows = container.querySelectorAll('[data-trip-row]');
    expect(rows).toHaveLength(2);
    expect(rows[1].getAttribute('data-trip-row')).toBe('1');
  });

  /*
    `closest()` 로 찾을 수 있어야 한다 -- 좌표 아래에 잡히는 것은 줄 안쪽의 글자나
    버튼이고, 거기서 위로 올라가 줄을 찾기 때문이다. 표식이 줄이 아니라 안쪽 요소에
    붙으면 이 방법이 못 쓴다.
  */
  it('줄 안쪽에서 위로 올라가면 찾힌다', () => {
    const { container } = render(
      <RowGroup>
        <ListRow data-trip-row={3}><span data-testid="inner">안쪽</span></ListRow>
      </RowGroup>,
    );
    const inner = container.querySelector('[data-testid="inner"]')!;
    expect(inner.closest('[data-trip-row]')?.getAttribute('data-trip-row')).toBe('3');
  });

  it('안 붙이면 없다', () => {
    const { container } = render(<RowGroup><ListRow>표식 없음</ListRow></RowGroup>);
    expect(container.querySelector('[data-trip-row]')).toBeNull();
  });
});
