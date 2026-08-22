import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BASIC_BY_GROUP,
  BASIC_EMOTION_LABEL,
  BASIC_EMOTION_ORDER,
  BASIC_EMOTION_VALENCE,
  GROUP_BY_BASIC,
  applyBasicEmotion,
  basicEmotionOf,
  stepBasicEmotion,
} from '@/lib/basicEmotions';
import {
  candidatesToFlowItems,
  extractEmotionCandidates,
  flowItemsToCandidates,
} from '@/lib/emotionCandidates';
import { analyzeEmotionFlow } from '@/lib/emotionFlowAnalysis';
import { emotionFlowForStorage } from '@/lib/privacy';
import {
  DEFAULT_LAYOUT_BY_ROLE,
  HOME_CORE_BY_ROLE,
  WIDGET_REGISTRY,
  isWidgetAllowedForRole,
  widgetsForRole,
} from '@/lib/widgets';
import {
  daysUntilTrip,
  deriveTripPhase,
  groupTripsByPhase,
} from '@/lib/tripPhase';
import type { BasicEmotion, EmotionGroup, Trip } from '@/types';

// ---------------------------------------------------------------------------
// The six-emotion vocabulary
// ---------------------------------------------------------------------------
describe('the six basic emotions', () => {
  it('is exactly 화났어 · 별로였어 · 걱정됐어 · 기뻤어 · 속상했어 · 놀랐어', () => {
    expect([...BASIC_EMOTION_ORDER].sort()).toEqual(
      ['anger', 'disgust', 'fear', 'happiness', 'sadness', 'surprise'],
    );
    expect(BASIC_EMOTION_ORDER.map((basic) => BASIC_EMOTION_LABEL[basic])).toEqual(
      ['기뻤어', '놀랐어', '걱정됐어', '별로였어', '화났어', '속상했어'],
    );
  });

  it('orders the wheel by valence, so ▲ is always more positive', () => {
    const valences = BASIC_EMOTION_ORDER.map((basic) => BASIC_EMOTION_VALENCE[basic]);
    const descending = [...valences].sort((a, b) => b - a);
    expect(valences).toEqual(descending);
  });

  it('maps every legacy EmotionGroup onto a basic emotion', () => {
    // Exhaustive by construction: a new EmotionGroup without a mapping is a type
    // error, and this proves none resolves to undefined at runtime either.
    for (const [group, basic] of Object.entries(BASIC_BY_GROUP)) {
      expect(BASIC_EMOTION_ORDER, `${group} -> ${basic}`).toContain(basic);
    }
    expect(BASIC_BY_GROUP.joy).toBe('happiness');
    expect(BASIC_BY_GROUP.frustration).toBe('anger');
  });

  it('round-trips basic -> group -> basic without drift', () => {
    for (const basic of BASIC_EMOTION_ORDER) {
      expect(BASIC_BY_GROUP[GROUP_BY_BASIC[basic]]).toBe(basic);
    }
  });

  it('reads a record stored before this feature existed', () => {
    // The whole point of keeping EmotionGroup: no migration.
    expect(basicEmotionOf({ group: 'longing' as EmotionGroup })).toBe('sadness');
    expect(basicEmotionOf({ group: 'excitement' as EmotionGroup })).toBe('happiness');
    // An explicit basic always wins over the legacy group.
    expect(basicEmotionOf({ group: 'joy' as EmotionGroup, basic: 'anger' })).toBe('anger');
  });

  it('clamps the stepper at both ends instead of wrapping', () => {
    expect(stepBasicEmotion('happiness', -1)).toBe('happiness');
    expect(stepBasicEmotion('sadness', 1)).toBe('sadness');
    expect(stepBasicEmotion('happiness', 1)).toBe('surprise');
    expect(stepBasicEmotion('sadness', -1)).toBe('anger');
  });

  it('rewrites group, label and userEdited when a human corrects a reading', () => {
    const corrected = applyBasicEmotion(
      { sequence: 1, group: 'joy', displayLabel: '기뻤어', basic: 'happiness' },
      'anger',
    );
    // Every existing reader keys off group/displayLabel, so both must follow.
    expect(corrected).toMatchObject({
      basic: 'anger',
      group: 'anger',
      displayLabel: '화났어',
      userEdited: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Extraction: opt-out candidates
// ---------------------------------------------------------------------------
describe('extractEmotionCandidates', () => {
  /** The literal sentence the product owner reported. */
  const REPORTED = '일하느라 ㅈ같았는데, 손님이 먹을 것을 줘서 기분이 나아졌어';

  it('reads the reported sentence as 화났어 → 기뻤어 with the evidence phrases', () => {
    const candidates = extractEmotionCandidates(REPORTED);
    expect(candidates.map((c) => c.basic)).toEqual(['anger', 'happiness']);
    expect(candidates.map((c) => c.evidence)).toEqual(['ㅈ같음', '기분이 나아짐']);
    expect(candidates.map((c) => c.sequence)).toEqual([1, 2]);
  });

  it('understands how people actually swear, not only the polite form', () => {
    // An engine that only knows 짜증 misses the entries carrying the most feeling.
    for (const text of ['ㅈ같았다', '좆같았어', '개짜증났어', '빡쳤어', '열받아']) {
      expect(extractEmotionCandidates(text)[0]?.basic, text).toBe('anger');
    }
  });

  it('is a pure function: same text, deep-equal result, input untouched', () => {
    const first = extractEmotionCandidates(REPORTED);
    const second = extractEmotionCandidates(REPORTED);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('returns nothing for text with no readable feeling', () => {
    expect(extractEmotionCandidates('')).toEqual([]);
    expect(extractEmotionCandidates('   ')).toEqual([]);
    expect(extractEmotionCandidates('오늘 마트에서 두부와 계란을 샀다')).toEqual([]);
  });

  it('honours negation rather than matching the bare keyword', () => {
    expect(extractEmotionCandidates('별로 안 슬펐어')).toEqual([]);
    expect(extractEmotionCandidates('전혀 불안하지 않았어')).toEqual([]);
  });

  it('does not treat a scary film as the writer being afraid', () => {
    expect(extractEmotionCandidates('무서운 영화 봤어 ㅋㅋ')).toEqual([]);
    expect(extractEmotionCandidates('걱정됐어 게임 하느라 무서웠다 ㅋㅋ')).toEqual([]);
    // ...but a genuinely frightening day still reads as 걱정됐어.
    expect(extractEmotionCandidates('밤길이 너무 무서웠어')[0]?.basic).toBe('fear');
  });

  /**
   * Korean substring collisions, each of which produced a confident wrong reading.
   * This is the "마음을 똑바로 못 캐치하는 문제" in its most concrete form: a stem
   * that happens to sit inside an unrelated word.
   */
  it('does not fire on a stem that is merely a substring of another word', () => {
    // 서운(hurt) inside 무서운(scary) -- read as 화났어 before this was tightened.
    expect(extractEmotionCandidates('무서운 꿈을 꿨어')[0]?.basic).not.toBe('anger');
    // 화 + 나 inside "영화 나왔어" -- read as 화났어.
    expect(extractEmotionCandidates('새 영화 나왔어')).toEqual([]);
    // 물렸(bitten) vs 물렸(fed up).
    expect(extractEmotionCandidates('모기에 물렸어')).toEqual([]);
    // 갑자기 is timing, not an emotion.
    expect(extractEmotionCandidates('갑자기 비가 왔어')).toEqual([]);
  });

  it('collapses adjacent repeats but keeps a genuine there-and-back shape', () => {
    const collapsed = extractEmotionCandidates('짜증났어. 진짜 짜증났어.');
    expect(collapsed.map((c) => c.basic)).toEqual(['anger']);

    const roundTrip = extractEmotionCandidates('짜증났는데, 기분이 나아졌는데, 또 짜증났어');
    expect(roundTrip.map((c) => c.basic)).toEqual(['anger', 'happiness', 'anger']);
  });

  it('caps a very long entry at four beats', () => {
    const many = '짜증났는데, 기분이 좋아졌는데, 불안했는데, 놀랐는데, 슬펐어';
    expect(extractEmotionCandidates(many).length).toBeLessThanOrEqual(4);
  });

  it('masks URLs, emails and phone numbers before reading anything', () => {
    const candidates = extractEmotionCandidates('https://x.com 보고 짜증났어 010-1234-5678');
    expect(JSON.stringify(candidates)).not.toContain('x.com');
    expect(JSON.stringify(candidates)).not.toContain('1234');
  });
});

// ---------------------------------------------------------------------------
// Persistence boundary
// ---------------------------------------------------------------------------
describe('what actually gets stored', () => {
  const candidates = extractEmotionCandidates('짜증났는데 기분이 나아졌어');
  /** Every reading answered by a person. The composer's "다 맞아요" outcome. */
  const allAnswered = new Set(candidates.map((candidate) => candidate.id));
  /** Nothing answered: the app read the entry and the author never replied. */
  const noneAnswered: ReadonlySet<string> = new Set();

  it('never persists the evidence phrase taken from the diary body', () => {
    const items = candidatesToFlowItems(candidates, {
      isPrivate: false, shareWithPartner: true, confirmedIds: allAnswered,
    });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).not.toHaveProperty('evidence');
      expect(item).not.toHaveProperty('matchedText');
      expect(item).not.toHaveProperty('position');
    }
    expect(JSON.stringify(items)).not.toContain('짜증');
    expect(JSON.stringify(items)).not.toContain('나아짐');
  });

  /**
   * The inversion this pipeline was rebuilt for.
   *
   * `candidatesToFlowItems` used to stamp every surviving candidate
   * `user_confirmed`, so an entry written and saved without ever opening the
   * feelings row recorded the machine's guess as the author's own answer --
   * and `emotionFlowForStorage`, whose whole job is to drop anything that is
   * not confirmed, could not tell, because its only caller lied to it.
   */
  it('leaving a suggestion in place is not confirming it', () => {
    const items = candidatesToFlowItems(candidates, {
      isPrivate: false, shareWithPartner: true, confirmedIds: noneAnswered,
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.source === 'rule_suggested')).toBe(true);
    // ...and therefore none of it survives the write-path filter.
    expect(emotionFlowForStorage({ isPrivate: false, emotionFlow: items })).toEqual([]);
  });

  it('an answered suggestion becomes user_confirmed and survives the write path', () => {
    const items = candidatesToFlowItems(candidates, {
      isPrivate: false, shareWithPartner: true, confirmedIds: allAnswered,
    });
    expect(items.every((item) => item.source === 'user_confirmed')).toBe(true);
    const stored = emotionFlowForStorage({ isPrivate: false, emotionFlow: items });
    expect(stored).toHaveLength(items.length);
  });

  it('answers each reading separately, so a partly reviewed flow stores only the part reviewed', () => {
    const items = candidatesToFlowItems(candidates, {
      isPrivate: false,
      shareWithPartner: true,
      confirmedIds: new Set([candidates[0].id]),
    });
    expect(items[0].source).toBe('user_confirmed');
    expect(items[1].source).toBe('rule_suggested');
    const stored = emotionFlowForStorage({ isPrivate: false, emotionFlow: items });
    expect(stored).toHaveLength(1);
    expect(stored[0].basic).toBe(candidates[0].basic);
  });

  /**
   * PRODUCT_V3 §13 requires an affirmative author action before a machine
   * reading reaches the partner. One switch above a list of guesses the author
   * never read is not agreement with each of them, so the switch alone cannot
   * publish anything -- the per-item answer is a second, independent condition.
   */
  it('the share toggle cannot publish a reading the author never answered', () => {
    const items = candidatesToFlowItems(candidates, {
      isPrivate: false, shareWithPartner: true, confirmedIds: noneAnswered,
    });
    expect(items.every((item) => item.visibility === 'author_only')).toBe(true);
    expect(emotionFlowForStorage({ isPrivate: false, emotionFlow: items })).toEqual([]);
  });

  it('keeps a private record author-only regardless of the share toggle', () => {
    const items = candidatesToFlowItems(candidates, {
      isPrivate: true, shareWithPartner: true, confirmedIds: allAnswered,
    });
    expect(items.every((item) => item.visibility === 'author_only')).toBe(true);
    // An author-only item must not reach a shared row.
    expect(emotionFlowForStorage({ isPrivate: false, emotionFlow: items })).toEqual([]);
  });

  it('a shared record with the share toggle OFF never persists emotion for the partner to read', () => {
    const items = candidatesToFlowItems(candidates, {
      isPrivate: false, shareWithPartner: false, confirmedIds: allAnswered,
    });
    expect(items.every((item) => item.visibility === 'author_only')).toBe(true);
    expect(emotionFlowForStorage({ isPrivate: false, emotionFlow: items })).toEqual([]);
  });

  it('a shared record with the share toggle ON persists the answered emotion for the partner to read', () => {
    const items = candidatesToFlowItems(candidates, {
      isPrivate: false, shareWithPartner: true, confirmedIds: allAnswered,
    });
    expect(items.every((item) => item.visibility === 'shared')).toBe(true);
    expect(emotionFlowForStorage({ isPrivate: false, emotionFlow: items })).toHaveLength(items.length);
  });

  it('omitting shareWithPartner defaults to author-only, not shared', () => {
    // @ts-expect-error -- exercising a caller that forgets the now-required flag
    const items = candidatesToFlowItems(candidates, { isPrivate: false, confirmedIds: allAnswered });
    expect(items.every((item) => item.visibility === 'author_only')).toBe(true);
  });

  it('omitting confirmedIds fails closed: nothing is treated as answered', () => {
    // @ts-expect-error -- exercising a caller that forgets the now-required set
    const items = candidatesToFlowItems(candidates, { isPrivate: false, shareWithPartner: true });
    expect(items.every((item) => item.source === 'rule_suggested')).toBe(true);
    expect(emotionFlowForStorage({ isPrivate: false, emotionFlow: items })).toEqual([]);
  });

  it('records which items a human corrected, and which it did not', () => {
    const edited = new Set([candidates[0].id]);
    const items = candidatesToFlowItems(candidates, {
      isPrivate: false, shareWithPartner: true, confirmedIds: allAnswered, editedIds: edited,
    });
    expect(items[0].userEdited).toBe(true);
    expect(items[1].userEdited).toBe(false);
  });

  it('a correction changes the analysed shape, not just the label', () => {
    // The reported defect: the label could be fixed while the drawn line stayed
    // wrong. 화났어 → 기뻤어 rises; 기뻤어 → 기뻤어 is flat.
    const rising = analyzeEmotionFlow(
      candidatesToFlowItems(candidates, {
        isPrivate: false, shareWithPartner: true, confirmedIds: allAnswered,
      }),
    );
    const correctedCandidates = candidates.map(
      (candidate) => ({ ...candidate, basic: 'happiness' as BasicEmotion }),
    );
    const corrected = candidatesToFlowItems(correctedCandidates, {
      isPrivate: false,
      shareWithPartner: true,
      confirmedIds: new Set(correctedCandidates.map((candidate) => candidate.id)),
    });
    const flat = analyzeEmotionFlow(corrected);
    expect(rising?.shape).not.toBe(flat?.shape);
    expect(flat?.shape).toBe('calm');
  });

  it('re-opens a stored flow for correction, mapping legacy groups forward', () => {
    const reopened = flowItemsToCandidates([
      { sequence: 2, group: 'longing', displayLabel: '그리움', id: 'b' },
      { sequence: 1, group: 'joy', displayLabel: '기뻤어', id: 'a' },
    ]);
    // Sorted by sequence, and legacy groups resolved rather than defaulted.
    expect(reopened.map((c) => c.id)).toEqual(['a', 'b']);
    expect(reopened.map((c) => c.basic)).toEqual(['happiness', 'sadness']);
    // A stored item carries no evidence, because the phrase was never saved.
    expect(reopened.every((c) => c.evidence === '')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Role-aware widgets
// ---------------------------------------------------------------------------
describe('role-aware home widgets', () => {
  it("leads 군화's home with the day itself and nothing that merely describes it", () => {
    /*
     * Changed deliberately, and the reason is recorded here rather than in a
     * commit message nobody will read again. This is the SECOND time this
     * assertion has moved; the previous note is kept below it.
     *
     * `통화 전 60초` is pinned by WidgetDashboard outside this list, so the default
     * below it is now just the day and the D-Day strip. The four widgets removed
     * from it -- `partner_emotion_flow`, `partner_emotion_summary`, `care_hint`,
     * `today_word` -- all described the day the pinned briefing had already
     * described, so a soldier read the same context in four wrappers. PRODUCT_PRD
     * §7.3 caps the core screen at three priorities; the default carried seven
     * surfaces. PRODUCT_REVIEW §2 diagnosed this and recorded it as fixed, but only
     * the briefing card was consolidated.
     *
     * `partner_day` leading is unchanged and is the point: README §1.4 defines this
     * home as the partner's moments in chronological order, and
     * `PartnerDayTimelineWidget.test.tsx` guards a home that shows only
     * descriptions of them. That test still passes untouched.
     *
     * PREVIOUS NOTE (kept): the original assertion pinned `['partner_emotion_flow',
     * 'partner_emotion_summary']` as the first two. Both of those, and `care_hint`
     * with them, are DESCRIPTIONS of the partner's day, and a description is only
     * useful once the thing it describes is on the screen -- which is why
     * `partner_day` was moved in front of them.
     */
    /*
     * THIRD MOVE: the ordering it protects is no longer a default that a user can
     * rearrange away. The surfaces are PINNED (`HOME_CORE_BY_ROLE`), so 군화's home
     * leads with the briefing (§6.1's 요약 층) and then the day itself (원본 층)
     * whatever anyone does to their widgets. The arrangeable layer below is now
     * just D-Day.
     *
     * FOURTH MOVE (2026-08-22): `story_rail` goes in front of all of it, and the
     * thing this assertion protects survives intact -- the rail is not another
     * DESCRIPTION of the partner's day. It is the door to the day itself, and what
     * it shows about the partner is two facts (a ring state and a time), neither of
     * which restates the briefing.
     *
     * The claim being made here has therefore narrowed, on purpose: descriptions
     * must not precede the thing they describe. `call_briefing` still leads the
     * described surfaces, and `partner_day` still precedes the three widgets that
     * merely describe it.
     *
     * FIFTH MOVE (2026-08-22): `paper_feed` goes last, and it is not a fifth
     * description either -- it holds a DIFFERENT PERIOD. Today lives in the story,
     * yesterday-onward lives in the feed, and last month lives in 우리. Nothing
     * appears in two places at once, which is the rule that keeps the 2026-08-20
     * conversational home from recurring (its summary card repeated the bubble
     * directly beneath it).
     */
    expect(HOME_CORE_BY_ROLE.soldier).toEqual([
      'story_rail', 'call_briefing', 'partner_day', 'talk_about_list', 'today_word', 'paper_feed',
    ]);
    // 설명이 설명되는 것보다 앞설 수 없다는 것이 이 단언의 본체다.
    expect(HOME_CORE_BY_ROLE.soldier.indexOf('call_briefing'))
      .toBeLessThan(HOME_CORE_BY_ROLE.soldier.indexOf('partner_day'));
    expect(DEFAULT_LAYOUT_BY_ROLE.soldier).toEqual(['dday']);
    // `talk_about_list` joined in P3. It is not another DESCRIPTION of the
    // day -- it is the couple's own explicit marks on records already on this
    // screen, which is the next step of the loop rather than a restatement of
    // the previous one. The rule this test protects (the day itself leads,
    // descriptions do not crowd it) is unchanged.
    for (const description of ['partner_emotion_flow', 'partner_emotion_summary', 'care_hint']) {
      expect(DEFAULT_LAYOUT_BY_ROLE.soldier).not.toContain(description);
      expect(HOME_CORE_BY_ROLE.soldier).not.toContain(description);
    }
  });

  it('keeps every demoted widget available rather than deleting it', () => {
    // Removed from the DEFAULT only. Each must still exist and still be offered to
    // 군화, otherwise this was a feature deletion wearing a layout change's clothes.
    for (const id of [
      'partner_emotion_flow',
      'partner_emotion_summary',
      'care_hint',
      'upcoming_schedule',
    ]) {
      expect(WIDGET_REGISTRY[id], `${id} must still exist`).toBeTruthy();
      expect(isWidgetAllowedForRole(id, 'soldier'), `${id} must still be offerable`).toBe(true);
      expect(widgetsForRole('soldier').map((w) => w.id), id).toContain(id);
    }
  });

  /**
   * A pinned surface is withheld from the add sheet, and that is not a deletion.
   *
   * `today_word` left this list because it is no longer arrangeable for either
   * role -- it is pinned. Offering it in the sheet would let someone add a second
   * composer under the one already on their home.
   */
  it('withholds pinned surfaces from the add sheet, for both roles', () => {
    for (const role of ['gomsin', 'soldier'] as const) {
      const offered = widgetsForRole(role).map((widget) => widget.id);
      for (const pinned of HOME_CORE_BY_ROLE[role]) {
        expect(offered, `${pinned} must not be addable for ${role}`).not.toContain(pinned);
      }
      // Still registered, still rendered -- just not as something to arrange.
      if (WIDGET_REGISTRY.today_word) expect(HOME_CORE_BY_ROLE[role]).toContain('today_word');
    }
  });

  it('still shows the flow before the summary, now inside the briefing disclosure', () => {
    /*
     * The relationship the original test existed to protect -- flow BEFORE summary
     * -- has not been dropped, it has moved. Both widgets now render inside
     * `CallBriefingWidget`'s `더 보기`, so the ordering is asserted where it now
     * lives instead of against a list that no longer contains either id.
     */
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/widgets/CallBriefingWidget.tsx'),
      'utf8',
    );
    const flow = source.indexOf('<PartnerEmotionFlowWidget');
    const summary = source.indexOf('<PartnerEmotionSummaryWidget');
    const care = source.indexOf('<CareHintWidget');
    expect(flow, 'the briefing must render the flow widget').toBeGreaterThan(-1);
    expect(summary, 'the briefing must render the summary widget').toBeGreaterThan(-1);
    expect(care, 'the briefing must render the care hint').toBeGreaterThan(-1);
    expect(flow).toBeLessThan(summary);
  });

  it('puts the checkpoint action ahead of everything optional in the briefing', () => {
    /*
     * The north-star metric is the time from opening the briefing to pressing
     * `여기까지 확인`, so anything rendered between the topics and that button is
     * measured as comprehension time the user did not spend comprehending. At
     * 320x568 the opener pushed it off the first screen entirely.
     */
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/widgets/CallBriefingWidget.tsx'),
      'utf8',
    );
    const confirm = source.indexOf('여기까지 확인');
    const disclosure = source.indexOf('더 보기');
    expect(confirm).toBeGreaterThan(-1);
    expect(disclosure).toBeGreaterThan(-1);
    expect(confirm).toBeLessThan(disclosure);
  });

  it('never offers the partner-DESCRIBING widgets to the person they describe', () => {
    // `partner_emotion_flow` / `partner_emotion_summary` / `care_hint` are
    // derived commentary ABOUT the partner's day from the reading side's
    // point of view -- 곰신 reading a description of her own day back at
    // herself is incoherent, so these three stay soldier-only.
    for (const id of ['partner_emotion_flow', 'partner_emotion_summary', 'care_hint']) {
      expect(isWidgetAllowedForRole(id, 'soldier'), id).toBe(true);
      expect(isWidgetAllowedForRole(id, 'gomsin'), id).toBe(false);
    }
    expect(widgetsForRole('gomsin').map((w) => w.id)).not.toContain('partner_emotion_flow');
  });

  it('pins partner_day for BOTH roles -- PRODUCT_V3 §5.1, the surface is symmetric', () => {
    /*
     * `partner_day` is the raw evidence timeline, not commentary, and the north
     * star is "서로의 하루" -- not one-directional. It used to be soldier-only,
     * which meant 곰신 had a compose surface but no evidence surface of her own:
     * the exact asymmetry this widget exists to fix, pointed the other way.
     *
     * The guarantee got STRONGER rather than moving. It is no longer "offered to
     * both roles" -- something offered can be declined, and a 곰신 who tidied her
     * home could end up without it again. It is pinned for both, so the symmetry
     * survives any arrangement. That is also why it is absent from `widgetsForRole`
     * now: it is not a thing to add, it is already there.
     */
    expect(isWidgetAllowedForRole('partner_day', 'soldier')).toBe(true);
    expect(isWidgetAllowedForRole('partner_day', 'gomsin')).toBe(true);
    expect(HOME_CORE_BY_ROLE.gomsin).toContain('partner_day');
    expect(HOME_CORE_BY_ROLE.soldier).toContain('partner_day');
  });

  it('gives both roles a default layout made only of widgets they may use', () => {
    for (const role of ['gomsin', 'soldier'] as const) {
      for (const id of DEFAULT_LAYOUT_BY_ROLE[role]) {
        expect(WIDGET_REGISTRY[id], `${role}/${id} must exist`).toBeTruthy();
        expect(isWidgetAllowedForRole(id, role), `${role}/${id} must be allowed`).toBe(true);
      }
    }
  });

  it('rejects an unknown widget id for either role', () => {
    expect(isWidgetAllowedForRole('today_meal', 'gomsin')).toBe(false);
    expect(isWidgetAllowedForRole('', 'soldier')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Past / present / future plans
// ---------------------------------------------------------------------------
describe('trip phases', () => {
  const TODAY = '2026-08-04';
  function trip(over: Partial<Trip> & { id: string }): Trip {
    return {
      coupleId: 'c1',
      createdBy: 'u1',
      title: over.id,
      startDate: TODAY,
      endDate: TODAY,
      status: 'planned',
      createdAt: `${TODAY}T00:00:00Z`,
      ...over,
    } as Trip;
  }

  it('derives the phase from the dates instead of the stale stored status', () => {
    // The defect: `status` only changed when a human edited it, so a trip from
    // last year still read 계획중 forever.
    expect(deriveTripPhase({ startDate: '2025-01-01', endDate: '2025-01-05', status: 'planned' }, TODAY)).toBe('past');
    expect(deriveTripPhase({ startDate: '2026-08-01', endDate: '2026-08-09', status: 'planned' }, TODAY)).toBe('current');
    expect(deriveTripPhase({ startDate: '2026-12-01', endDate: '2026-12-05', status: 'planned' }, TODAY)).toBe('upcoming');
  });

  it('treats the boundary days as part of the trip', () => {
    expect(deriveTripPhase({ startDate: TODAY, endDate: TODAY, status: 'planned' }, TODAY)).toBe('current');
  });

  it('lets an explicit 다녀옴 override the calendar', () => {
    // A cancelled or shortened trip is something the dates cannot know.
    expect(deriveTripPhase({ startDate: '2026-12-01', endDate: '2026-12-05', status: 'completed' }, TODAY)).toBe('past');
  });

  it('orders each bucket the way it is actually used', () => {
    const grouped = groupTripsByPhase([
      trip({ id: 'far-future', startDate: '2027-01-01', endDate: '2027-01-05' }),
      trip({ id: 'soon', startDate: '2026-09-01', endDate: '2026-09-03' }),
      trip({ id: 'old', startDate: '2024-01-01', endDate: '2024-01-05' }),
      trip({ id: 'recent', startDate: '2026-07-01', endDate: '2026-07-05' }),
      trip({ id: 'now', startDate: '2026-08-01', endDate: '2026-08-09' }),
    ], TODAY);

    expect(grouped.current.map((t) => t.id)).toEqual(['now']);
    // Nearest plan first: it is the one being prepared for.
    expect(grouped.upcoming.map((t) => t.id)).toEqual(['soon', 'far-future']);
    // Most recent memory first, so two years of history needs no scrolling.
    expect(grouped.past.map((t) => t.id)).toEqual(['recent', 'old']);
  });

  it('counts the days to an upcoming trip and nothing otherwise', () => {
    expect(daysUntilTrip('2026-08-14', TODAY)).toBe(10);
    expect(daysUntilTrip('2026-08-05', TODAY)).toBe(1);
    expect(daysUntilTrip(TODAY, TODAY)).toBeNull();
    expect(daysUntilTrip('2026-08-01', TODAY)).toBeNull();
  });

  it('places every trip in exactly one bucket', () => {
    const trips = [
      trip({ id: 'a', startDate: '2024-01-01', endDate: '2024-01-02' }),
      trip({ id: 'b', startDate: '2026-08-04', endDate: '2026-08-04' }),
      trip({ id: 'c', startDate: '2027-01-01', endDate: '2027-01-02' }),
    ];
    const grouped = groupTripsByPhase(trips, TODAY);
    const total = grouped.current.length + grouped.upcoming.length + grouped.past.length;
    expect(total).toBe(trips.length);
  });
});
