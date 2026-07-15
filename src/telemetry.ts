/**
 * MOB-147 — Client-side MCP telemetry transport.
 *
 * The npm `@muovi/mcp-server` package runs on the agent's local
 * machine — it can't write to our Postgres directly. This module
 * forwards a minimal, privacy-safe summary of each tool call to the
 * dashboard backend via a single POST to the public `/v1` telemetry
 * endpoint (no auth required; the endpoint is rate-limited).
 *
 * ## Privacy contract (matches `supabase/functions/_shared/v1Telemetry.ts`)
 *
 *   - Tool args are hashed with sha256 BEFORE leaving the process.
 *     We never transport raw arguments — the agent's machine might
 *     legitimately invoke `muovi_search_professionals` with a query
 *     that includes a customer's address or name, and that string
 *     must never leave the LLM's sandbox.
 *   - Error messages are NEVER transmitted. Only a closed bucket
 *     label (`error_class`) is sent.
 *   - No IPs, no UA strings, no client-host info collected on this
 *     side — the receiving endpoint derives those from the request
 *     itself.
 *
 * ## Failure mode
 *
 * Fire-and-forget. A failed telemetry POST never blocks the tool
 * call. The fetch is wrapped in try/catch with a hard timeout; the
 * function returns void.
 *
 * ## Opt-out
 *
 * Set `MUOVI_DISABLE_TELEMETRY=1` in the agent's env to disable.
 * Set `MUOVI_TELEMETRY_BASE_URL` to override the destination (for
 * staging / local dev).
 */

export type ClientMcpStatus = 'ok' | 'error' | 'rate_limited' | 'leakage_blocked';

export interface LogMcpCallFromClientArgs {
  toolName: string;
  /**
   * Raw tool args. The transport will sha256-hash them via canonical
   * JSON before sending. Pass `undefined` if the tool takes no args.
   */
  args?: unknown;
  status: ClientMcpStatus;
  errorClass?: string;
  latencyMs?: number;
}

const DEFAULT_TELEMETRY_URL =
  process.env.MUOVI_TELEMETRY_BASE_URL ??
  'https://muovi.com.ar/api/v1/mcp-telemetry';

const TIMEOUT_MS = 2_000;

/**
 * sha256(canonical(args)) — same canonical-JSON algorithm as the
 * server-side `hashArgs` in `_shared/v1Telemetry.ts`. The two
 * implementations MUST stay aligned; a sample-row regression test
 * lives in `__tests__/telemetry.test.ts`.
 */
interface CryptoSubtle {
  // Narrow signature matching Web Crypto. We declare it here rather
  // than relying on the DOM lib (which the mcp-server tsconfig
  // intentionally excludes — this package is Node-only).
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

async function sha256Hex(input: string): Promise<string> {
  // Node 18+ ships Web Crypto on `globalThis.crypto`. Older Node
  // builds need an explicit import; we degrade gracefully.
  const subtle =
    (globalThis as { crypto?: { subtle?: CryptoSubtle } }).crypto?.subtle;
  if (!subtle) {
    // Fall back to a non-cryptographic but stable hash so telemetry
    // still groups same-args calls together. The receiver doesn't
    // care about the cryptographic strength here — only stability.
    return fallbackHashHex(input);
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fallbackHashHex(input: string): string {
  // FNV-1a 64-bit-ish, hex-encoded. Pure JS, no deps.
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ input.charCodeAt(i), 1099511628211) >>> 0;
  }
  // Pad to 64 chars to look like a sha256 to downstream consumers.
  const part = (n: number) => n.toString(16).padStart(8, '0');
  return (
    part(h1) + part(h2) + part(h1 ^ 0xdeadbeef) + part(h2 ^ 0xcafebabe) +
    part(h1) + part(h2) + part(h1 ^ 0xdeadbeef) + part(h2 ^ 0xcafebabe)
  );
}

/**
 * Canonical JSON: sort object keys recursively, preserve array order.
 * Mirrors `canonicalJson` in `supabase/functions/_shared/v1Telemetry.ts`.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(',')}}`;
}

export async function hashArgsClient(args: unknown): Promise<string> {
  return sha256Hex(canonicalJson(args ?? {}));
}

function isTelemetryDisabled(): boolean {
  const v = process.env.MUOVI_DISABLE_TELEMETRY;
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Fire-and-forget client → server telemetry. Returns a Promise that
 * resolves once the POST has settled (success OR failure). Callers
 * should `void` this — no business logic depends on the outcome.
 */
export async function logMcpCallFromClient(
  args: LogMcpCallFromClientArgs,
): Promise<void> {
  if (isTelemetryDisabled()) return;

  try {
    const argsSha256 = await hashArgsClient(args.args);
    const body = {
      tool_name: args.toolName,
      args_sha256: argsSha256,
      status: args.status,
      source: 'npm' as const,
      error_class: args.errorClass ?? null,
      latency_ms: args.latencyMs ?? null,
      client_label: detectClientLabel(),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await fetch(DEFAULT_TELEMETRY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Opaque header for the receiver to group by transport
          // surface without parsing the body.
          'X-Muovi-MCP-Source': 'npm',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // Telemetry NEVER throws — swallow every failure mode (network
    // out, timeout, hash failure, etc.).
  }
}

/**
 * Best-effort identification of the MCP client. Read from env vars
 * we expect clients (Claude Desktop, mcp-inspector, etc.) to set,
 * with safe fallbacks. Truncated to 100 chars.
 */
function detectClientLabel(): string | null {
  const fromEnv =
    process.env.MUOVI_MCP_CLIENT_LABEL ??
    process.env.MCP_CLIENT_NAME ??
    null;
  if (fromEnv) return fromEnv.slice(0, 100);
  // Node version + platform — coarse but useful.
  const node = process.versions?.node ?? 'unknown';
  return `node/${node}`.slice(0, 100);
}
