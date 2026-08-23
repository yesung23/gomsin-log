/**
 * 목록에서 하나를 집어 다른 자리에 놓았을 때, **무엇의 순서를 어떻게 바꿔 적을지.**
 *
 * ## 왜 꺼냈는가
 *
 * 앞의 판은 이웃과 자리를 맞바꾸는 것뿐이라 두 개의 `sortOrder` 만 건드리면 됐다.
 * 끌어 옮기기는 다르다 -- 첫째를 넷째 자리에 놓으면 그 사이의 것들이 전부 한 칸씩
 * 당겨진다. 화면 안에서 계산하면 이것을 실행해 확인할 방법이 없고, 순서가 틀리는
 * 결함은 **저장된 뒤에야 보인다.**
 *
 * ## 왜 자리를 다시 매기지 않고 최소만 바꾸는가
 *
 * 전부 0..N 으로 다시 매기면 한 번 끌 때마다 목록 전체가 쓰기 대상이 된다. 그러면
 * 상대가 동시에 다른 항목을 고치고 있을 때 그 변경까지 덮어쓴다. 실제로 자리가
 * 달라지는 것들만 골라 낸다.
 */
export interface Ordered {
  id: string;
  sortOrder: number;
}

/**
 * `from` 번째를 `to` 번째 자리로 옮긴 뒤, **바뀐 것만** 새 `sortOrder` 와 함께 돌려준다.
 *
 * 순서 값 자체는 목록이 원래 갖고 있던 값들을 자리에 다시 배분한다. 새 숫자를
 * 만들어 내지 않으므로 다른 날의 항목이나 시간이 박힌 항목과 값이 충돌하지 않는다.
 */
export function moveWithinList<T extends Ordered>(
  list: readonly T[],
  from: number,
  to: number,
): Array<{ id: string; sortOrder: number }> {
  if (from === to) return [];
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return [];

  const slots = list.map((item) => item.sortOrder);
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  const changes: Array<{ id: string; sortOrder: number }> = [];
  next.forEach((item, index) => {
    if (item.sortOrder !== slots[index]) changes.push({ id: item.id, sortOrder: slots[index] });
  });
  return changes;
}

/** 옮긴 뒤의 목록. 화면이 저장을 기다리지 않고 먼저 그리기 위한 것. */
export function movedList<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * **최종 순서**를 받아 바뀐 것만 돌려준다.
 *
 * 끄는 동안 화면은 여러 번 다시 배열된다. 매 움직임마다 `from`/`to` 를 원본 기준으로
 * 유지하려 하면 미리보기와 원본 사이에서 인덱스가 어긋난다 -- 이미 옮겨진 목록 위의
 * 세 번째와 원본의 세 번째는 다른 것이다. 그래서 끄는 동안에는 **아이디 순서**만 들고
 * 있다가, 놓을 때 그 순서를 원래 있던 자리 값들에 배분한다.
 *
 * 목록에 없는 아이디나 빠진 아이디가 있으면 아무것도 바꾸지 않는다. 부분적으로 맞는
 * 순서를 저장하면 화면과 저장된 값이 조용히 갈라진다.
 */
export function reorderByIds<T extends Ordered>(
  list: readonly T[],
  finalIds: readonly string[],
): Array<{ id: string; sortOrder: number }> {
  if (finalIds.length !== list.length) return [];
  const byId = new Map(list.map((item) => [item.id, item]));
  if (finalIds.some((id) => !byId.has(id))) return [];

  const slots = list.map((item) => item.sortOrder);
  const changes: Array<{ id: string; sortOrder: number }> = [];
  finalIds.forEach((id, index) => {
    const item = byId.get(id)!;
    if (item.sortOrder !== slots[index]) changes.push({ id, sortOrder: slots[index] });
  });
  return changes;
}
