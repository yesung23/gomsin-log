import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeAnnouncement, routeScreenName } from '@/lib/routeAnnouncement';

describe('companion garden app wiring', () => {
  it('registers a lazy garden page at /diary/garden', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain("import('@/features/diary/CompanionGardenPage')");
    expect(app).toContain('<Route path="/diary/garden" element={<CompanionGardenPage />} />');
  });

  it('announces the specific garden screen before the broader diary prefix', () => {
    expect(routeScreenName('/diary/garden')).toBe('우리 정원');
    expect(routeAnnouncement('/diary/garden')).toBe('우리 정원 화면입니다');
    expect(routeScreenName('/diary')).toBe('일기장');
  });
});
