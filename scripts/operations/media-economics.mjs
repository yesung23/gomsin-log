import { pathToFileURL } from 'node:url';

/** Official public rates checked 2026-09-05. Not the project's actual bill.
 * https://supabase.com/pricing — one Pro/Micro project, compute credit included.
 * Decimal GB billing; inputs are binary KiB. Do not silently conflate them. */
export const RATE_SNAPSHOT = Object.freeze({
  checkedOn: '2026-09-05', source: 'https://supabase.com/pricing', currency: 'USD',
  base: 25, storageIncludedGB: 100, storagePerGB: 0.0213,
  egressIncludedGB: 250, egressPerGB: 0.09,
  cachedIncludedGB: 250, cachedPerGB: 0.03,
  mauIncluded: 100_000, mauOverage: 0.00325,
});

function nonnegative(name, value, integer = false) {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`Invalid aggregate input: ${name}`);
  }
}

/** All inputs are anonymous aggregate counts; never reads credentials/content.
 * No retention/deletion policy is inferred from the active-user count. */
export function estimateMediaBill(input) {
  for (const key of ['monthlyActiveUsers', 'storedPhotos', 'monthlyMasterReads', 'monthlyThumbnailReads']) {
    nonnegative(key, input[key], true);
  }
  for (const key of ['masterKiB', 'thumbnailKiB', 'cachedShare']) nonnegative(key, input[key]);
  if (input.masterKiB === 0 || input.cachedShare > 1
    || (input.monthlyThumbnailReads > 0 && input.thumbnailKiB === 0)) {
    throw new Error('Missing size or invalid cache ratio');
  }
  const gb = (kib) => kib * 1024 / 1e9;
  const storageGB = gb(input.storedPhotos * (input.masterKiB + input.thumbnailKiB));
  const transferGB = gb(input.monthlyMasterReads * input.masterKiB
    + input.monthlyThumbnailReads * input.thumbnailKiB);
  if (!Number.isFinite(storageGB) || !Number.isFinite(transferGB)) throw new Error('Aggregate overflow');
  const cachedGB = transferGB * input.cachedShare;
  const uncachedGB = transferGB - cachedGB;
  const rates = RATE_SNAPSHOT;
  const storageOverageUsd = Math.max(0, storageGB - rates.storageIncludedGB) * rates.storagePerGB;
  const egressOverageUsd = Math.max(0, cachedGB - rates.cachedIncludedGB) * rates.cachedPerGB
    + Math.max(0, uncachedGB - rates.egressIncludedGB) * rates.egressPerGB;
  const authOverageUsd = Math.max(0, input.monthlyActiveUsers - rates.mauIncluded) * rates.mauOverage;
  return { storageGB, cachedGB, uncachedGB, storageOverageUsd, egressOverageUsd, authOverageUsd,
    estimatedUsd: rates.base + storageOverageUsd + egressOverageUsd + authOverageUsd };
}

/** Supply actual net proceeds AFTER tax/platform fee/refund reserve, and costs
 * in the SAME currency. null means no positive contribution, not zero customers. */
export function breakEvenCustomers({ monthlyCost, netProceedsPerCustomer, variableCostPerCustomer }) {
  for (const [key, value] of Object.entries({ monthlyCost, netProceedsPerCustomer, variableCostPerCustomer })) {
    nonnegative(key, value);
  }
  const contribution = netProceedsPerCustomer - variableCostPerCustomer;
  return contribution > 0 ? Math.ceil(monthlyCost / contribution) : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('SCENARIO ONLY — not measured usage, capacity proof, or a complete invoice.');
  console.log('Assume 2 photos/person/day, 12 months retained, 20 list reads + 2 detail reads/person/day.');
  console.log('500 KiB master / proposed 50 KiB thumbnail; zero cache hits (conservative transfer scenario).');
  console.log('Excluded: compute upgrades, DB/backups, Realtime overage, Edge overage, email, tax, support and book production.');
  console.log(`Rates ${RATE_SNAPSHOT.checkedOn}: ${RATE_SNAPSHOT.source}`);
  console.table([100, 1000, 10000].flatMap((couples) => {
    const users = couples * 2;
    return [false, true].map((thumbnail) => {
      const bill = estimateMediaBill({ monthlyActiveUsers: users, storedPhotos: users * 2 * 30 * 12,
        masterKiB: 500, thumbnailKiB: thumbnail ? 50 : 0,
        monthlyMasterReads: users * (thumbnail ? 2 : 22) * 30,
        monthlyThumbnailReads: thumbnail ? users * 20 * 30 : 0, cachedShare: 0 });
      return { couples, variant: thumbnail ? 'proposed thumbnails' : 'master-only',
        storageGB: bill.storageGB.toFixed(1), monthlyTransferGB: bill.uncachedGB.toFixed(1),
        partialMonthlyUSD: bill.estimatedUsd.toFixed(2) };
    });
  }));
}
