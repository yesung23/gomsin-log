import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('초기 WebView 화면', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const document = new DOMParser().parseFromString(html, 'text/html');

  it('React와 CSS가 준비되기 전에도 승인 로고와 wordmark를 정적으로 보여 준다', () => {
    const status = document.querySelector('[data-testid="boot-splash"]');
    const logo = status?.querySelector('img[data-brand-mark]');
    const wordmark = status?.querySelector('[data-brand-wordmark]');

    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-label')).toBe('곰신로그 여는 중');
    expect(status?.getAttribute('style')).toContain('background:#FCFBF7');
    expect(logo?.getAttribute('src')).toBe('/favicon.svg');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
    expect(wordmark?.textContent).toBe('곰신로그');
    expect(wordmark?.getAttribute('aria-hidden')).toBe('true');
    expect(html.indexOf('data-testid="boot-splash"')).toBeLessThan(
      html.indexOf('<script type="module" src="/src/main.tsx"></script>'),
    );
  });

  it('uses one light warm-paper browser theme and the matching iOS status bar', () => {
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
      .toBe('#FCFBF7');
    expect(
      document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute('content'),
    ).toBe('default');
  });

  it('contains no spinner, animation, or legacy launch colours', () => {
    expect(html).not.toContain('gomsinlog-boot-spin');
    expect(html).not.toContain('border-top-color:transparent');
    expect(html).not.toMatch(/animation\s*:/i);
    expect(html.toUpperCase()).not.toContain('#FFF7F7');
    expect(html.toUpperCase()).not.toContain('#1B2340');
  });
});
