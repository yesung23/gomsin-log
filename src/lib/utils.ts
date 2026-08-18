export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

export function formatLocalDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function localToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function daysBetweenLocal(a: string, b: string): number {
  const dateA = parseLocalDate(a);
  const dateB = parseLocalDate(b);
  return Math.round((dateB.getTime() - dateA.getTime()) / 86400000);
}

export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addMonths(dateStr: string, months: number): string {
  const d = parseLocalDate(dateStr);
  const targetMonth = d.getMonth() + months;
  const result = new Date(d.getFullYear(), targetMonth, d.getDate());
  // Handle month overflow (e.g., Jan 31 + 1 month = Feb 28)
  if (result.getDate() !== d.getDate()) {
    result.setDate(0); // Last day of previous month
  }
  return toLocalDateString(result);
}

export function calculateDischargeDate(enlistmentDate: string, branch: string): string {
  const months: Record<string, number> = {
    army: 18,
    marine: 18,
    navy: 20,
    airforce: 21,
  };
  const m = months[branch] ?? 18;
  return addMonths(enlistmentDate, m);
}

/**
 * Compute the inclusive lower-bound date for "partner day / missed context" surfaces.
 * If a device-local last-checked checkpoint exists, use its calendar date.
 * Otherwise fall back to a recent 7-day window (PRODUCT_V3 §6.5).
 * This is the single source for the "마지막 확인 이후 놓친 구간" contract.
 */
export function getPartnerDaySince(lastCheckedAt?: string): string | null {
  if (lastCheckedAt) {
    const d = new Date(lastCheckedAt);
    if (!Number.isNaN(d.getTime())) {
      return toLocalDateString(d);
    }
  }
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toLocalDateString(d);
}
