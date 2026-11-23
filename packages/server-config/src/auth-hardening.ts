/**
 * StockDL fork — login hardening.
 *
 * - Optional username (ADMIN_USERNAME).
 * - Password stored as a scrypt hash (ADMIN_PASSWORD_HASH) instead of plain text.
 *   Format: scrypt$N$r$p$<salt base64>$<hash base64>
 * - Optional TOTP second factor (ADMIN_TOTP_SECRET, base32, RFC 6238, SHA-1, 6 digits, 30 s).
 * - Per-IP lockout after repeated failures, plus a small delay on every failure.
 */
import crypto from 'node:crypto';

/** Constant-time string compare via fixed-length digests. */
export function safeEqualStr(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export function hashPassword(password: string, N = 16384, r = 8, p = 1): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, expected);
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAt(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secretBase32: string, code: string, now = Date.now()): boolean {
  const c = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(now / 1000 / 30);
  let ok = false;
  for (const d of [-1, 0, 1]) {
    if (safeEqualStr(totpAt(key, counter + d), c)) ok = true;
  }
  return ok;
}

interface Attempt {
  fails: number;
  first: number;
  lockedUntil: number;
}

export class LoginLimiter {
  private readonly attempts = new Map<string, Attempt>();

  constructor(
    private readonly maxFails = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
  ) {}

  /** Milliseconds until this key may try again (0 = allowed). */
  retryAfter(key: string, now = Date.now()): number {
    const a = this.attempts.get(key);
    if (!a) return 0;
    return a.lockedUntil > now ? a.lockedUntil - now : 0;
  }

  fail(key: string, now = Date.now()): void {
    const a = this.attempts.get(key);
    if (!a || now - a.first > this.windowMs) {
      this.attempts.set(key, { fails: 1, first: now, lockedUntil: 0 });
    } else {
      a.fails += 1;
      if (a.fails >= this.maxFails) a.lockedUntil = now + this.lockMs;
    }
    if (this.attempts.size > 10_000) this.prune(now);
  }

  success(key: string): void {
    this.attempts.delete(key);
  }

  private prune(now: number): void {
    for (const [k, a] of this.attempts) {
      if (a.lockedUntil < now && now - a.first > this.windowMs) this.attempts.delete(k);
    }
  }
}

export interface CredentialConfig {
  adminUsername?: string | undefined;
  adminPassword?: string | undefined;
  adminPasswordHash?: string | undefined;
  totpSecret?: string | undefined;
}

export interface CredentialInput {
  username?: string | undefined;
  password: string;
  otp?: string | undefined;
}

/** Checks every configured factor; always evaluates all of them (no early exit). */
export function checkCredentials(cfg: CredentialConfig, input: CredentialInput): boolean {
  let ok = true;
  if (cfg.adminUsername) {
    ok = safeEqualStr(input.username ?? '', cfg.adminUsername) && ok;
  }
  if (cfg.adminPasswordHash) {
    ok = verifyPasswordHash(input.password, cfg.adminPasswordHash) && ok;
  } else if (cfg.adminPassword) {
    ok = safeEqualStr(input.password, cfg.adminPassword) && ok;
  } else {
    ok = false;
  }
  if (cfg.totpSecret) {
    ok = verifyTotp(cfg.totpSecret, input.otp ?? '') && ok;
  }
  return ok;
}
