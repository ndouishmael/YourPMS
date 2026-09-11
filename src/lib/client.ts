'use client';

/** Client-side API helper: JSON + CSRF double-submit header. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)ypms_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? {});
  if (init.body) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD'].includes(method)) headers.set('x-csrf-token', csrfToken());
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const err = data as { error?: string; code?: string } | null;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function formatRand(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}R${(abs / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}
