/**
 * Password hashing (scrypt via node:crypto), token generation and hashing.
 * scrypt parameters: N=2^15 (32 MiB), r=8, p=1 — OWASP-aligned for 2025.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const SCRYPT_N = 1 << 15;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password, salt, expected.length, {
      N: parseInt(n, 10),
      r: parseInt(r, 10),
      p: parseInt(p, 10),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** URL-safe random token (default 256 bits). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still burn comparable time to avoid trivially leaking length info.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
