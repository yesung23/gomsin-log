import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMediaBill, breakEvenCustomers } from './media-economics.mjs';

const empty = { monthlyActiveUsers: 0, storedPhotos: 0, masterKiB: 500, thumbnailKiB: 0,
  monthlyMasterReads: 0, monthlyThumbnailReads: 0, cachedShare: 0 };

test('empty paid project includes base price, not a free production promise', () => {
  assert.equal(estimateMediaBill(empty).estimatedUsd, 25);
});
test('retained photographs accumulate independently of this month active users', () => {
  const bill = estimateMediaBill({ ...empty, storedPhotos: 1_000_000, masterKiB: 1024 });
  assert.equal(bill.storageGB, 1048.576);
  assert.ok(Math.abs(bill.storageOverageUsd - (1048.576 - 100) * 0.0213) < 0.00001);
});
test('cached and uncached egress allowances are separate', () => {
  const bill = estimateMediaBill({ ...empty, masterKiB: 1024, monthlyMasterReads: 1_000_000, cachedShare: 0.5 });
  assert.equal(bill.cachedGB, 524.288);
  assert.equal(bill.uncachedGB, 524.288);
  assert.ok(Math.abs(bill.egressOverageUsd - (524.288 - 250) * (0.09 + 0.03)) < 0.00001);
});
test('thumbnail use reduces transfer but adds stored bytes', () => {
  const masters = estimateMediaBill({ ...empty, storedPhotos: 1_000_000, monthlyMasterReads: 2_000_000 });
  const thumbs = estimateMediaBill({ ...empty, storedPhotos: 1_000_000, thumbnailKiB: 50, monthlyThumbnailReads: 2_000_000 });
  assert.ok(thumbs.storageGB > masters.storageGB);
  assert.ok(thumbs.uncachedGB < masters.uncachedGB);
});
test('active users above allowance have a separate auth cost, not capacity proof', () => {
  assert.equal(estimateMediaBill({ ...empty, monthlyActiveUsers: 100_100 }).authOverageUsd, 0.325);
});
test('unmeasured/invalid inputs cannot silently look cheap', () => {
  for (const input of [{ ...empty, masterKiB: NaN }, { ...empty, storedPhotos: -1 },
    { ...empty, cachedShare: 1.1 }, { ...empty, monthlyActiveUsers: 0.5 },
    { ...empty, thumbnailKiB: 0, monthlyThumbnailReads: 1 }]) {
    assert.throws(() => estimateMediaBill(input));
  }
});
test('break-even uses net proceeds in one currency and does not invent conversion', () => {
  assert.equal(breakEvenCustomers({ monthlyCost: 150000, netProceedsPerCustomer: 3500, variableCostPerCustomer: 500 }), 50);
  assert.equal(breakEvenCustomers({ monthlyCost: 150000, netProceedsPerCustomer: 500, variableCostPerCustomer: 500 }), null);
  assert.throws(() => breakEvenCustomers({ monthlyCost: NaN, netProceedsPerCustomer: 1, variableCostPerCustomer: 0 }));
});
