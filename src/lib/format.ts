/** Server-side formatting helpers (no 'use client' needed). */

export function rand(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}R${(abs / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(d: Date | string | number | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(d: Date | string | number | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

export function statusBadgeClass(status: string | null | undefined): string {
  if (!status) return 'gray';
  switch (status) {
    case 'WAITING':
    case 'BOOKED':
      return 'amber';
    case 'WITH_DOCTOR':
    case 'SUBMITTED':
    case 'ACCEPTED':
    case 'CHECKED_IN':
      return 'blue';
    case 'CONSULTATION_COMPLETE':
    case 'AWAITING_BILLING':
    case 'PARTIALLY_PAID':
    case 'NOT_SUBMITTED':
    case 'PENDING':
      return 'teal';
    case 'CLOSED':
    case 'PAID':
    case 'APPROVED':
    case 'PROCESSED':
    case 'ACTIVE':
      return 'green';
    case 'VOID':
    case 'REJECTED':
    case 'FAILED':
    case 'CANCELLED':
    case 'NO_SHOW':
    case 'SUSPENDED':
      return 'red';
    case 'DRAFT':
    case 'ISSUED':
      return 'gray';
    case 'ADJUSTED':
      return 'purple';
    default:
      return 'gray';
  }
}

export function humanStatus(status: string | null | undefined): string {
  if (!status) return '—';
  return status
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
