import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Apple IAP runtime reachability', () => {
  it('binds the listener at the authenticated app boundary and clears it on account changes', () => {
    const app = read('src/App.tsx');
    const bridge = read('src/components/AppleIapSessionBridge.tsx');
    expect(app).toContain('<AppleIapSessionBridge />');
    expect(bridge).toContain('state.authenticatedUser?.id');
    expect(bridge).toContain('bindAppleIapAccount(accountId)');
    expect(bridge).toContain('clearAppleIapAccount()');
  });

  it('keeps an explicit restore entry reachable in Settings while purchase remains gated', () => {
    const settings = read('src/pages/SettingsPage.tsx');
    expect(settings).toContain('restoreApplePurchases');
    expect(settings).toContain('구매 복원');
    expect(settings).toContain('settingsIdentityKey');
  });

  it('contains no query-string or browser-storage override for the sale gate', () => {
    const runtime = read('src/lib/iap/runtime.ts');
    const gate = read('src/lib/iap/saleGate.ts');
    const combined = `${runtime}\n${gate}`;
    expect(combined).not.toMatch(/URLSearchParams|localStorage|sessionStorage|document\.cookie/);
    expect(gate).toContain("=== 'true'");
  });
});
