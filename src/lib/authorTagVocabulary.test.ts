import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 작성자 태그는 한 값에 한 이름이다.
 *
 * `ReactionType` 은 작성자가 자기 기록에 직접 다는 표식이고 **감정 어휘가 아니다.**
 * 감정은 앱이 글에서 읽는 것이고 태그는 사람이 고르는 것이라 서로 다른 어휘다.
 *
 * 2026-08-22에 감정 어휘를 일상어로 바꾸면서 일괄 치환이 이 표까지 건드렸다. 결과는
 * 쓰는 화면(`좋았어`)과 읽는 화면(`기뻤어`)이 **같은 값을 다른 이름으로** 부르는
 * 상태였고, 사용자에게는 자기가 단 표식이 상대 화면에서 다른 말로 보이는 것이다.
 *
 * 여기서 소스를 읽어 세 곳이 같은지 본다. 값이 아니라 표를 비교하는 이유는 이것이
 * 렌더 시점이 아니라 **표를 고칠 때** 어긋나기 때문이다.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/** 쓰는 쪽. `TodayLogWidget` 의 `AUTHOR_TAGS` 가 이 어휘의 주인이다. */
function writerLabels(): Record<string, string> {
  const source = read('src/components/widgets/TodayLogWidget.tsx');
  const block = source.slice(source.indexOf('const AUTHOR_TAGS'), source.indexOf('];', source.indexOf('const AUTHOR_TAGS')));
  const found: Record<string, string> = {};
  for (const [, value, label] of block.matchAll(/value: '(\w+)'[^}]*label: '([^']+)'/g)) found[value] = label;
  return found;
}

function mapLabels(path: string, marker: string): Record<string, string> {
  const source = read(path);
  const at = source.indexOf(marker);
  expect(at, `${path}: ${marker} 를 못 찾았다`).toBeGreaterThan(-1);
  const block = source.slice(at, source.indexOf('};', at));
  const found: Record<string, string> = {};
  for (const [, key, label] of block.matchAll(/(\w+): '([^']+)'/g)) found[key] = label;
  return found;
}

describe('한 값에 한 이름', () => {
  const writer = writerLabels();

  it('쓰는 쪽 표를 조용히 못 읽고 통과하지 않는다', () => {
    expect(Object.keys(writer).sort()).toEqual(['event', 'good', 'hard', 'thought_of_you']);
  });

  it('상대의 하루가 같은 말로 부른다', () => {
    const reader = mapLabels('src/components/widgets/PartnerDayTimelineWidget.tsx', 'const REACTION_LABELS');
    for (const [value, label] of Object.entries(writer)) {
      expect(reader[value], `${value}: 쓸 때는 ${label}`).toBe(label);
    }
  });

  it('기록 화면이 같은 말로 부른다', () => {
    /* 이쪽 표는 이모지를 앞에 붙인다. 말 부분만 비교한다. */
    const reader = mapLabels('src/pages/RecordPage.tsx', "  good: '😊");
    for (const [value, label] of Object.entries(writer)) {
      expect(reader[value]?.replace(/^\S+\s*/, ''), `${value}: 쓸 때는 ${label}`).toBe(label);
    }
  });

  it('감정 어휘와 겹치지 않는다', () => {
    /*
      두 어휘가 한 화면에 함께 있다. 겹치면 사용자는 둘이 같은 것인지 배워야 한다 --
      하나는 자기가 다는 표식이고 다른 하나는 앱이 글에서 읽은 것이므로 같지 않다.
      `happiness` 가 `좋았어` 였다가 이 이유로 `기뻤어` 가 됐다.
    */
    const emotions = read('src/lib/basicEmotions.ts');
    const block = emotions.slice(emotions.indexOf('BASIC_EMOTION_LABEL'), emotions.indexOf('};', emotions.indexOf('BASIC_EMOTION_LABEL')));
    const emotionWords = [...block.matchAll(/: '([^']+)'/g)].map((m) => m[1]);
    expect(emotionWords).toHaveLength(6);
    for (const label of Object.values(writer)) {
      expect(emotionWords, `태그 ${label} 가 감정 어휘와 겹친다`).not.toContain(label);
    }
  });
});
