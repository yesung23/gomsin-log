import { recommendEmotionFlow } from '../emotionRuleEngine';

export function runEmotionRuleEngineTests() {
  console.log('====================================================');
  console.log('🧪 Running Emotion Rule Engine Unit & Integration Tests');
  console.log('====================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. "오늘 진짜 행복했어" -> 행복 후보
  const test1 = recommendEmotionFlow('오늘 진짜 행복했어');
  assert(test1.some((i) => i.group === 'joy' && i.displayLabel === '행복'), 'Test 1: "오늘 진짜 행복했어" -> 행복 candidate');

  // 2. Complex multi-emotion sequence
  const test2Text = '알바에서 진상 손님을 만나 속상했는데, 친구와 치킨 먹고 기분이 나아졌어. 우리가 함께 왔던 곳이라 네 생각이 났어';
  const test2 = recommendEmotionFlow(test2Text);
  assert(test2.length === 3, 'Test 2: Complex multi-emotion returns 3 candidates in order');
  assert(test2[0]?.displayLabel === '속상함', `Test 2: Item 1 is 속상함 (Got: ${test2[0]?.displayLabel})`);
  assert(test2[1]?.displayLabel === '행복' || test2[1]?.group === 'joy', `Test 2: Item 2 is 행복 (Got: ${test2[1]?.displayLabel})`);
  assert(test2[2]?.displayLabel === '그리움', `Test 2: Item 3 is 그리움 (Got: ${test2[2]?.displayLabel})`);

  // 3. Negation: "안 행복해" -> no joy
  const test3 = recommendEmotionFlow('오늘 하나도 안 행복해');
  assert(!test3.some((i) => i.group === 'joy'), 'Test 3: "안 행복해" must NOT recommend joy candidate');

  // 4. Negation: "별로 안 좋았어" -> no joy
  const test4 = recommendEmotionFlow('오늘 기분이 별로 안 좋았어');
  assert(!test4.some((i) => i.group === 'joy'), 'Test 4: "별로 안 좋았어" must NOT recommend joy candidate');

  // 5. Short expression: "보고 싶어" -> 그리움 후보
  const test5 = recommendEmotionFlow('너 너무 보고 싶어');
  assert(test5.some((i) => i.displayLabel === '보고싶음' || i.displayLabel === '그리움'), 'Test 5: "보고 싶어" -> 그리움/보고싶음 candidate');

  // 6. Short expression: "행복해" -> 행복 후보
  const test6 = recommendEmotionFlow('오늘 진짜 너무 행복해');
  assert(test6.some((i) => i.displayLabel === '행복'), 'Test 6: "행복해" -> 행복 candidate');

  // 7. Profanity handling: "시발 개짜증나" -> no raw profanity in displayLabel
  const test7 = recommendEmotionFlow('오늘 알바에서 시발 개짜증났어');
  const hasProfanityInLabel = test7.some((i) => /(?:시발|씨발|개짜증)/.test(i.displayLabel));
  assert(!hasProfanityInLabel, 'Test 7: Profanity text must NOT leak into displayLabel');
  assert(test7.some((i) => i.displayLabel === '불편함' || i.displayLabel === '답답함'), 'Test 7: Profanity text converted to safe label (불편함/답답함)');

  // 8. Prohibited label softening ("증오", "복수심", "집착") -> safe label
  const test8 = recommendEmotionFlow('오늘 집착나고 복수심이 생길 정도로 싫었어');
  const hasProhibited = test8.some((i) => ['집착', '복수심', '증오', '악의'].includes(i.displayLabel));
  assert(!hasProhibited, 'Test 8: Prohibited words softened, no prohibited displayLabel output');

  // 9. Meaningless / facts only text -> empty candidates []
  const test9 = recommendEmotionFlow('12345 67890');
  assert(test9.length === 0, 'Test 9: Meaningless facts text returns empty []');

  // 10. Max 3 items limit check
  const test10Text = '치킨먹고 기분이 좋아졌다가, 알바 진상 만나서 속상해졌다가, 너 생각나서 먹먹했다가, 날씨도 맑아서 설렜어';
  const test10 = recommendEmotionFlow(test10Text);
  assert(test10.length <= 3, 'Test 10: Candidate list capped at MAX 3 items');

  // 11. Duplicate emotion group merging
  const test11Text = '오늘 기분 좋고 행복하고 신나고 즐거웠어';
  const test11 = recommendEmotionFlow(test11Text);
  assert(test11.length === 1, 'Test 11: Consecutive identical emotion group (joy) merged into 1 item');

  console.log('====================================================');
  console.log(`📊 Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    throw new Error(`${failed} tests failed!`);
  }
}

// Auto run if executed in Node.js
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
  runEmotionRuleEngineTests();
}
