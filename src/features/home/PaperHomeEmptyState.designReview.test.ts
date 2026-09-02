import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PaperHome empty-feed copy', () => {
  it('does not promise that my own record will appear in the partner-only feed', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/home/PaperHome.tsx'),
      'utf8',
    );

    expect(source).not.toContain('오늘 있었던 일을 하나 남기면 여기 쌓여요.');
    expect(source).toContain('상대가 공유한 하루가 생기면 이곳에 놓여요.');
  });
});
