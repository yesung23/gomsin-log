import { EmotionGroup, EmotionVisibility, EmotionFlowItem } from '@/types';

export interface RuleEngineOptions {
  isPrivate?: boolean;
}

interface EmotionMatch {
  group: EmotionGroup;
  displayLabel: string;
  position: number;
  matchedText: string;
  score: number;
}

const DEFAULT_AUTHOR_ONLY_GROUPS: EmotionGroup[] = ['frustration', 'concern'];

/**
 * Text Normalizer according to spec:
 * - Unicode NFC normalization
 * - URL, Email, Phone number masking
 * - Consecutive whitespace / newline reduction
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/01[016789]-?\d{3,4}-?\d{4}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split text into segments based on punctuation and transition conjunctions
 */
function segmentText(normalized: string): { text: string; position: number }[] {
  // Transition regex to split sentences/clauses
  const splitPattern = /(?:[.!?,;\n]|\b(?:그런데|근데|하지만|그래도|그러다가|그러고 나서|끝나고|이후에|나중에|마지막에|그러다 보니|처음에는|처음엔|결국|덕분에|그래서)\b|(?<=는데|했지만|하고 나서|하니까|되니까|다가|됐다|졌다가|했어|했지))/g;

  const segments: { text: string; position: number }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = splitPattern.exec(normalized)) !== null) {
    const segText = normalized.substring(lastIndex, match.index).trim();
    if (segText) {
      segments.push({ text: segText, position: lastIndex });
    }
    lastIndex = match.index + match[0].length;
  }

  const lastSeg = normalized.substring(lastIndex).trim();
  if (lastSeg) {
    segments.push({ text: lastSeg, position: lastIndex });
  }

  return segments;
}

/**
 * Negation checker: "안", "못", "별로", "전혀", "그다지", "아니" near target
 */
function isNegated(segment: string, keyword: string): boolean {
  const index = segment.indexOf(keyword);
  if (index === -1) return false;

  const prefix = segment.substring(Math.max(0, index - 12), index);
  const negationPattern = /(?:안|못|별로|전혀|그다지|아니)\s*$/;
  return negationPattern.test(prefix);
}

/**
 * Context safety checker: e.g. "무서워" in movie/game context
 */
function isEntertainmentFearContext(segment: string): boolean {
  const entertainmentKeywords = ['영화', '공포', '귀신', '놀이기구', '게임', 'ㅋㅋ', 'ㅎㅎ', '재밌', '웃겨'];
  return entertainmentKeywords.some((k) => segment.includes(k));
}

/**
 * Main Rule Engine: Recommends up to 3 ordered emotion flow candidates
 */
export function recommendEmotionFlow(
  logText: string,
  mediaDescription?: string,
  options?: { isPrivate?: boolean }
): EmotionFlowItem[] {
  const fullText = `${logText} ${mediaDescription || ''}`.trim();
  const normalized = normalizeText(fullText);

  if (!normalized) {
    return [];
  }

  const segments = segmentText(normalized);
  const matches: EmotionMatch[] = [];

  for (const seg of segments) {
    const text = seg.text;

    // 1. Joy / 행복, 기쁨, 즐거움, 신남
    if (/(?:나아졌|기분(?:이|은|도)?\s*좋|좋아졌|기뻤|즐거웠|신났|행복|맛있|웃기|재밌)/.test(text)) {
      if (!isNegated(text, '좋') && !isNegated(text, '즐겁') && !isNegated(text, '기뻐')) {
        let label = '행복';
        if (text.includes('즐겁')) label = '즐거움';
        if (text.includes('신났') || text.includes('신나')) label = '신남';
        if (text.includes('기뻤')) label = '기쁨';
        matches.push({ group: 'joy', displayLabel: label, position: seg.position, matchedText: text, score: 8 });
        continue;
      }
    }

    // 2. Love / 사랑, 그리움, 보고싶음, 다정함
    if (/(?:생각나|생각이?\s*나|보고\s*싶|보고싶|그리웠|그립|함께\s*왔던|함께\s*갔던|너\s*생각|사랑)/.test(text)) {
      if (!isNegated(text, '보고') && !isNegated(text, '생각')) {
        let label = '그리움';
        if (text.includes('보고') || text.includes('보고싶')) label = '보고싶음';
        if (text.includes('사랑')) label = '사랑';
        matches.push({ group: 'love', displayLabel: label, position: seg.position, matchedText: text, score: 9 });
        continue;
      }
    }

    // 3. Sadness / 속상함, 우울, 먹먹함, 서러움
    if (/(?:우울|진상|먹먹|울적|속상|슬펐|슬퍼|슬픔|서운|외로|눈물|뭉클|마음이\s*무겁)/.test(text)) {
      if (!isNegated(text, '속상') && !isNegated(text, '슬퍼') && !isNegated(text, '우울')) {
        let label = '속상함';
        if (text.includes('먹먹') || text.includes('뭉클')) label = '먹먹함';
        if (text.includes('우울')) label = '우울';
        matches.push({ group: 'sadness', displayLabel: label, position: seg.position, matchedText: text, score: 8 });
        continue;
      }
    }

    // 4. Anger / 답답함, 화남, 짜증
    if (/(?:답답|마음에\s*걸렸|짜증|화나|불만|언짢|빡치|열받)/.test(text)) {
      if (!isNegated(text, '답답') && !isNegated(text, '짜증')) {
        let label = '답답함';
        if (text.includes('짜증') || text.includes('화나')) label = '짜증';
        matches.push({ group: 'anger', displayLabel: label, position: seg.position, matchedText: text, score: 7 });
        continue;
      }
    }

    // 5. Disgust / 불편함, 불쾌함 (정제)
    if (/(?:불편|꺼림칙|거북|싫음|싫어|불쾌|부담|시발|씨발|개짜증|미친)/.test(text)) {
      let label = '불편함';
      if (text.includes('거북') || text.includes('부담')) label = '부담스러움';
      matches.push({ group: 'disgust', displayLabel: label, position: seg.position, matchedText: text.replace(/(?:시발|씨발|존나|졸라|좆|개짜증)/g, '***'), score: 7 });
      continue;
    }

    // 6. Envy / 부러움, 아쉬움
    if (/(?:부러움|부러워|아쉬움|아쉬웠|씁쓸|탐남)/.test(text)) {
      let label = '부러움';
      if (text.includes('아쉬')) label = '아쉬움';
      matches.push({ group: 'envy', displayLabel: label, position: seg.position, matchedText: text, score: 7 });
      continue;
    }

    // 7. Fear / 불안, 걱정
    if (/(?:불안|걱정|초조|긴장|조마조마|무서)/.test(text)) {
      if (!isNegated(text, '걱정') && !isEntertainmentFearContext(text)) {
        let label = '불안';
        if (text.includes('걱정')) label = '걱정';
        matches.push({ group: 'fear', displayLabel: label, position: seg.position, matchedText: text, score: 7 });
        continue;
      }
    }

    // 8. Jealousy / 질투
    if (/(?:질투|의심|신경\s*쓰임|신경쓰여)/.test(text)) {
      matches.push({ group: 'jealousy', displayLabel: '질투', position: seg.position, matchedText: text, score: 7 });
      continue;
    }

    // 9. Shame / 부끄러움
    if (/(?:부끄러움|부끄러|창피|당혹|민망)/.test(text)) {
      matches.push({ group: 'shame', displayLabel: '부끄러움', position: seg.position, matchedText: text, score: 7 });
      continue;
    }

    // 10. Guilt / 미안함
    if (/(?:미안함|미안|후회|안쓰러)/.test(text)) {
      matches.push({ group: 'guilt', displayLabel: '미안함', position: seg.position, matchedText: text, score: 7 });
      continue;
    }
  }

  // Sort by text position to preserve sequence
  matches.sort((a, b) => a.position - b.position);

  // Deduplicate adjacent identical emotion groups
  const deduplicated: EmotionMatch[] = [];
  for (const m of matches) {
    if (deduplicated.length === 0) {
      deduplicated.push(m);
    } else {
      const prev = deduplicated[deduplicated.length - 1];
      if (prev.group !== m.group) {
        deduplicated.push(m);
      }
    }
  }

  // Limit to MAX 3 items
  const finalMatches = deduplicated.slice(0, 3);

  // Convert to EmotionFlowItem
  return finalMatches.map((m, idx) => {
    let visibility: EmotionVisibility = 'shared';
    if (options?.isPrivate || DEFAULT_AUTHOR_ONLY_GROUPS.includes(m.group)) {
      visibility = 'author_only';
    }

    return {
      id: `rule-flow-${m.group}-${idx + 1}`,
      group: m.group,
      displayLabel: m.displayLabel,
      sequence: idx + 1,
      source: 'rule_suggested',
      visibility,
      matchedText: m.matchedText,
    };
  });
}
