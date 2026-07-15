/**
 * Anti-leakage detector — Node-compatible local copy of
 * `src/lib/anti-leakage/detector.ts` from the Muovi web app.
 *
 * Kept duplicated (not imported from the parent repo) so the published
 * `@muovi/mcp-server` package is fully standalone and has no React or
 * Vite-side imports.
 *
 * Logic must stay in lockstep with the canonical detector. If the canonical
 * detector changes, mirror the change here and bump the package's patch
 * version. The integration test in `__tests__/anti-leakage.test.ts` (which
 * MOB-146's surface registry references) guards the contract.
 */

export const LEAKAGE_KEY_REGEX =
  /phone(?!_verified)|whatsapp|telephone|email(?!_verified)|mail(?!_verified)|wa\.me|contactPoint\.telephone/i;

export const LEAKAGE_VALUE_REGEXES = {
  phone: /(?:\+\d[\d\s\-().]{7,})|(?:[\d\s\-().]{8,})/,
  email: /\S+@\S+\.\S+/,
  whatsapp: /(?:wa\.me|whatsapp\.com)\//i,
} as const;

export type LeakReason =
  | 'forbidden_key'
  | 'phone_pattern'
  | 'email_pattern'
  | 'whatsapp_pattern';

export interface Leak {
  path: string;
  reason: LeakReason;
  sample: string;
}

const MIN_PHONE_DIGITS = 8;
const PHONE_GROUPING_CHARS = /[ \-().]/;
const ISO_DATE_FRAGMENT_RE = /\d{4}-\d{2}-\d{2}/g;
const UUID_FRAGMENT_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function stripNonPhoneTokens(value: string): string {
  return value.replace(UUID_FRAGMENT_RE, '').replace(ISO_DATE_FRAGMENT_RE, '');
}

function isPhoneLike(value: string): boolean {
  const cleaned = stripNonPhoneTokens(value);
  const match = cleaned.match(LEAKAGE_VALUE_REGEXES.phone);
  if (!match) return false;
  const candidate = match[0];
  const digitCount = (candidate.match(/\d/g) ?? []).length;
  if (digitCount < MIN_PHONE_DIGITS) return false;
  const hasLeadingPlus = candidate.trim().startsWith('+');
  const hasGrouping = PHONE_GROUPING_CHARS.test(candidate);
  return hasLeadingPlus || hasGrouping;
}

function sampleOf(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function classifyValue(value: string): Exclude<LeakReason, 'forbidden_key'> | null {
  if (LEAKAGE_VALUE_REGEXES.whatsapp.test(value)) return 'whatsapp_pattern';
  if (LEAKAGE_VALUE_REGEXES.email.test(value)) return 'email_pattern';
  if (isPhoneLike(value)) return 'phone_pattern';
  return null;
}

function walk(value: unknown, path: string, leaks: Leak[]): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((item, idx) => walk(item, `${path}[${idx}]`, leaks));
    return;
  }

  if (typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      const childPath = `${path}.${key}`;

      if (LEAKAGE_KEY_REGEX.test(key)) {
        leaks.push({
          path: childPath,
          reason: 'forbidden_key',
          sample: sampleOf(
            typeof child === 'string' ? child : (JSON.stringify(child) ?? ''),
          ),
        });
        continue;
      }

      walk(child, childPath, leaks);
    }
    return;
  }

  if (typeof value === 'string') {
    const reason = classifyValue(value);
    if (reason) {
      leaks.push({ path, reason, sample: sampleOf(value) });
    }
  }
}

export function findLeaks(value: unknown, path = '$'): Leak[] {
  const leaks: Leak[] = [];
  walk(value, path, leaks);
  leaks.sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    if (a.reason < b.reason) return -1;
    if (a.reason > b.reason) return 1;
    return 0;
  });
  return leaks;
}

export function assertNoLeakage(
  value: unknown,
  opts?: { source?: string },
): void {
  const leaks = findLeaks(value);
  if (leaks.length === 0) return;
  const source = opts?.source ? ` in ${opts.source}` : '';
  const summary = leaks
    .map((l) => `${l.path} (${l.reason}): ${l.sample}`)
    .join('; ');
  throw new Error(
    `Anti-leakage violation${source}: ${leaks.length} leak(s) detected — ${summary}`,
  );
}
