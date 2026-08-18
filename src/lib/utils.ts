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
