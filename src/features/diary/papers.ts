import type { CSSProperties } from 'react';

export type DiaryPaperId = 'plain' | 'ruled' | 'grid' | 'dot' | 'cream';

export interface DiaryPaper {
  id: DiaryPaperId;
  label: string;
  description: string;
}

export const DEFAULT_DIARY_PAPER: DiaryPaperId = 'plain';

export const DIARY_PAPERS: readonly DiaryPaper[] = [
  { id: 'plain', label: '따뜻한 무지', description: '기록과 사진에 집중하는 기본 종이' },
  { id: 'ruled', label: '줄 노트', description: '손글씨 일기처럼 차분한 가로줄' },
  { id: 'grid', label: '모눈 종이', description: '사진과 글을 정돈해 보이는 작은 격자' },
  { id: 'dot', label: '도트 종이', description: '꾸미기 여백을 남기는 옅은 점선' },
  { id: 'cream', label: '크림 편지지', description: '조금 더 따뜻한 편지 느낌의 종이' },
] as const;

const KEY_PREFIX = 'gomsin.diary.paper.';

export function isDiaryPaperId(value: unknown): value is DiaryPaperId {
  return DIARY_PAPERS.some((paper) => paper.id === value);
}

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadDefaultDiaryPaper(userId: string): DiaryPaperId {
  if (!userId || typeof localStorage === 'undefined') return DEFAULT_DIARY_PAPER;
  try {
    const value = localStorage.getItem(key(userId));
    return isDiaryPaperId(value) ? value : DEFAULT_DIARY_PAPER;
  } catch {
    return DEFAULT_DIARY_PAPER;
  }
}

export function saveDefaultDiaryPaper(userId: string, paperId: DiaryPaperId): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(userId), paperId);
  } catch {
    // Device-local decoration preference is best-effort only.
  }
}

export function diaryPaperStyle(paperId: DiaryPaperId): CSSProperties {
  const ink = 'color-mix(in srgb, var(--ink) 10%, transparent)';
  const faint = 'color-mix(in srgb, var(--ink) 7%, transparent)';
  switch (paperId) {
    case 'ruled':
      return {
        backgroundColor: 'var(--paper)',
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent 27px, ${ink} 28px)`,
      };
    case 'grid':
      return {
        backgroundColor: 'var(--paper)',
        backgroundImage: `linear-gradient(${faint} 1px, transparent 1px), linear-gradient(90deg, ${faint} 1px, transparent 1px)`,
        backgroundSize: '20px 20px',
      };
    case 'dot':
      return {
        backgroundColor: 'var(--paper)',
        backgroundImage: `radial-gradient(circle, ${ink} 1px, transparent 1px)`,
        backgroundSize: '18px 18px',
      };
    case 'cream':
      return {
        backgroundColor: 'color-mix(in srgb, var(--paper) 86%, #e6c98f 14%)',
      };
    case 'plain':
    default:
      return { backgroundColor: 'var(--paper)' };
  }
}
