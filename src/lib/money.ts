/** Money helpers — all amounts are integer cents (ZAR). */

export function rand(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}R${(abs / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function toCents(rands: number | string): number {
  const n = typeof rands === 'string' ? parseFloat(rands) : rands;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function isValidCents(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
}
