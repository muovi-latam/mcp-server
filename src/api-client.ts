/**
 * Thin fetch wrapper for the Muovi public `/v1` REST API.
 *
 * - Base URL defaults to `https://muovi.com.ar/api/v1` (production rewrite).
 *   Override via `MUOVI_API_BASE_URL` for testing / staging.
 * - Optional `X-API-Key` header sourced from `MUOVI_API_KEY` env var
 *   (per MOB-139's tier system; unauthenticated traffic shares the public
 *   rate limit bucket).
 * - 429 responses are parsed for `Retry-After` and surfaced as a
 *   `RateLimitedError` so the calling tool can format a clear message
 *   for the LLM agent.
 *
 * Kept dependency-free: relies on Node's built-in `fetch` (Node 18+).
 */

export interface MuoviApiClientOptions {
  baseUrl?: string;
  apiKey?: string;
  /**
   * Optional fetch implementation. Injectable for tests so we can mock
   * the network without monkey-patching `globalThis.fetch`.
   */
  fetch?: typeof fetch;
  /** Connector identifier forwarded as `X-Muovi-Connector` for observability. */
  connectorId?: string;
}

export class MuoviApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MuoviApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class RateLimitedError extends MuoviApiError {
  public readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null) {
    super(429, 'rate_limited', message, retryAfterSeconds !== null ? { retry_after_seconds: retryAfterSeconds } : undefined);
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const DEFAULT_BASE_URL = 'https://muovi.com.ar/api/v1';
export const DEFAULT_CONNECTOR_ID = 'muovi-mcp-server';

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asInt = Number.parseInt(headerValue, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  // RFC 7231 also allows an HTTP-date. Convert to delta-seconds best-effort.
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) {
    const delta = Math.round((asDate - Date.now()) / 1000);
    return delta >= 0 ? delta : 0;
  }
  return null;
}

export class MuoviApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly connectorId: string;

  constructor(opts: MuoviApiClientOptions = {}) {
    const base = opts.baseUrl ?? process.env.MUOVI_API_BASE_URL ?? DEFAULT_BASE_URL;
    this.baseUrl = base.replace(/\/+$/, '');
    this.apiKey = opts.apiKey ?? process.env.MUOVI_API_KEY ?? undefined;
    const f = opts.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') {
      throw new Error(
        '@muovi/mcp-server requires a global `fetch` (Node 18+) or an explicit `fetch` option.',
      );
    }
    this.fetchImpl = f;
    this.connectorId = opts.connectorId ?? DEFAULT_CONNECTOR_ID;
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const trimmed = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(this.baseUrl + trimmed);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `${this.connectorId}/0.1.3 (+https://muovi.com.ar)`,
      'X-Muovi-Connector': this.connectorId,
    };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const response = await this.fetchImpl(url, { method: 'GET', headers });

    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      let body: ApiErrorBody = {};
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        // ignore; fall through with default message
      }
      const msg =
        body.error?.message ??
        (retryAfter !== null
          ? `Muovi API rate limit hit. Retry after ${retryAfter} second(s).`
          : 'Muovi API rate limit hit. Try again shortly.');
      throw new RateLimitedError(msg, retryAfter);
    }

    if (!response.ok) {
      let body: ApiErrorBody = {};
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        // ignore; fall through with default message
      }
      throw new MuoviApiError(
        response.status,
        body.error?.code ?? `http_${response.status}`,
        body.error?.message ?? `Muovi API request failed with status ${response.status}.`,
        body.error?.details,
      );
    }

    return (await response.json()) as T;
  }
}
