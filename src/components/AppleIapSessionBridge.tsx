import { useEffect } from 'react';

import { useStore } from '@/lib/useStore';
import { bindAppleIapAccount, clearAppleIapAccount } from '@/lib/iap/runtime';

export function AppleIapSessionBridge() {
  const { state } = useStore();
  const accountId = state.authenticatedUser?.id ?? null;

  useEffect(() => {
    if (!accountId) {
      clearAppleIapAccount();
      return;
    }
    void bindAppleIapAccount(accountId).catch(() => undefined);
  }, [accountId]);

  useEffect(() => () => clearAppleIapAccount(), []);
  return null;
}
