/**
 * 프리뷰가 쓰는 가짜 커플.
 *
 * 짧은 문장, 긴 문장, 줄바꿈이 있는 문장을 섞었다. 손글씨는 한 줄에서는 예쁘고 다섯
 * 줄에서 지치는 서체이므로, 다섯 줄짜리가 하나 반드시 있어야 기기에서 판단이 선다.
 *
 * 사진은 넣지 않는다 -- 프리뷰에 실제 미디어가 없고, 이 셸이 답해야 하는 질문은
 * 글이 화면의 주인공일 때 가장 정확하게 나온다.
 */

export interface PreviewRecord {
  id: string;
  userId: string;
  date: string;
  time: string;
  log: string;
  isPrivate?: boolean;
  /**
   * 사진이 붙었는가.
   *
   * 처음에는 화면에서 `index % 2` 로 정했는데, 그러면 같은 기록이 자리에 따라 사진이
   * 있었다 없었다 한다. 사진 유무는 **기록의 성질**이므로 데이터가 정해야 하고, 그래야
   * 사진 없는 스토리가 어떻게 보이는지도 제대로 확인된다.
   */
  hasPhoto?: boolean;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const TODAY = daysAgo(0);

export const FIXTURE_RECORDS: PreviewRecord[] = [
  { id: 'p-1', userId: 'partner-fixture', date: daysAgo(2), time: '08:20', log: '아침에 일어나서 학교에 갔어' },
  {
    id: 'p-2', userId: 'partner-fixture', date: daysAgo(1), time: '13:05',
    hasPhoto: true,
    log: '점심은 친구랑 같이 먹었고 오후에는 도서관에서 공부했어\n시험이 다음 주라서 요즘 계속 여기 있어',
  },
  {
    id: 'p-3', userId: 'partner-fixture', date: daysAgo(1), time: '21:40',
    log: '오늘은 좀 지쳤어 컨디션이 안 좋아서 일찍 누웠어 그래도 하루는 남겨 두고 자려고',
  },
  { id: 'p-4', userId: 'partner-fixture', date: TODAY, time: '09:12', log: '오늘 시험 끝났어 생각보다 잘 봤어' },
  { id: 'p-4b', userId: 'partner-fixture', date: TODAY, time: '12:20', hasPhoto: true, log: '오늘 점심' },
  {
    id: 'p-5', userId: 'partner-fixture', date: TODAY, time: '14:30',
    log: '어제 꿈에 네가 나왔는데 진짜 웃겼어\n무슨 내용이었는지는 잘 기억이 안 나는데 일어나서 한참 웃었어\n요즘 이런 날이 많다\n별거 아닌데도 자꾸 생각나서\n다음 주에 면회 갈게 그때까지 힘내자',
  },
  { id: 'p-6', userId: 'partner-fixture', date: TODAY, time: '19:05', log: '저녁 먹다가 네 생각났어' },
  {
    id: 'm-2', userId: 'me-fixture', date: daysAgo(1), time: '20:00',
    hasPhoto: true,
    log: '오늘 훈련 힘들었는데 저녁에 네 편지 읽으니까 괜찮아졌어',
  },
  { id: 'm-3', userId: 'me-fixture', date: daysAgo(3), time: '18:40', isPrivate: true, log: '이건 나만 보는 기록이야' },
];
