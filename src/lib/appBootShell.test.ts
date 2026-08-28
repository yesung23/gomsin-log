import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('초기 WebView 화면', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

  it('React와 CSS가 준비되기 전에도 검정 빈 화면 대신 진행 상태를 보여 준다', () => {
    expect(html).toContain('data-testid="boot-splash"');
    expect(html).toContain('aria-label="곰신로그 여는 중"');
    expect(html).toContain('min-height:100dvh;background:#fff7f7');
    expect(html.indexOf('data-testid="boot-splash"')).toBeLessThan(
      html.indexOf('<script type="module" src="/src/main.tsx"></script>'),
    );
  });
});
