/**
 * MOB-147 — Tests for the npm MCP server's client-side telemetry.
 *
 * Locks in the privacy contract: raw args never leave the process,
 * disable flag works, fetch failures swallowed, hash matches the
 * server-side canonical algorithm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalJson,
  hashArgsClient,
  logMcpCallFromClient,
} from '../src/telemetry.js';

const ORIGINAL_DISABLE = process.env.MUOVI_DISABLE_TELEMETRY;
const ORIGINAL_URL = process.env.MUOVI_TELEMETRY_BASE_URL;

beforeEach(() => {
  delete process.env.MUOVI_DISABLE_TELEMETRY;
  delete process.env.MUOVI_TELEMETRY_BASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_DISABLE === undefined) {
    delete process.env.MUOVI_DISABLE_TELEMETRY;
  } else {
    process.env.MUOVI_DISABLE_TELEMETRY = ORIGINAL_DISABLE;
  }
  if (ORIGINAL_URL === undefined) {
    delete process.env.MUOVI_TELEMETRY_BASE_URL;
  } else {
    process.env.MUOVI_TELEMETRY_BASE_URL = ORIGINAL_URL;
  }
});

describe('canonicalJson', () => {
  it('isStableAcrossKeyOrdering', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('preservesArrayOrder', () => {
    expect(canonicalJson(['a', 'b'])).not.toBe(canonicalJson(['b', 'a']));
  });

  it('handlesNullPrimitive', () => {
    expect(canonicalJson(null)).toBe('null');
  });

  it('handlesNestedSorting', () => {
    const a = canonicalJson({ outer: { a: 1, b: 2 } });
    const b = canonicalJson({ outer: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });
});

describe('hashArgsClient', () => {
  it('returnsHex64', async () => {
    const hash = await hashArgsClient({ service: 'electricidad' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('isStableAcrossKeyOrdering', async () => {
    const a = await hashArgsClient({ city: 'caba', service: 'electricidad' });
    const b = await hashArgsClient({ service: 'electricidad', city: 'caba' });
    expect(a).toBe(b);
  });

  it('differsForDifferentArgValues', async () => {
    const a = await hashArgsClient({ city: 'caba' });
    const b = await hashArgsClient({ city: 'rosario' });
    expect(a).not.toBe(b);
  });

  it('hashesUndefinedAsEmptyObject', async () => {
    const a = await hashArgsClient(undefined);
    const b = await hashArgsClient({});
    expect(a).toBe(b);
  });
});

describe('logMcpCallFromClient', () => {
  it('skipsFetch_whenDisabled', async () => {
    process.env.MUOVI_DISABLE_TELEMETRY = '1';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));
    await logMcpCallFromClient({
      toolName: 'muovi_list_services',
      status: 'ok',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sendsHashedArgs_notRawArgs', async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string | undefined;
        return new Response('ok');
      },
    );

    const rawArgs = { customer_email: 'jane@example.com', city: 'caba' };
    await logMcpCallFromClient({
      toolName: 'muovi_search_professionals',
      args: rawArgs,
      status: 'ok',
    });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.args_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Critical: the raw arg values are NEVER in the body.
    expect(capturedBody).not.toContain('jane@example.com');
    expect(capturedBody).not.toContain('caba');
    expect(parsed.source).toBe('npm');
  });

  it('swallowsFetchErrors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network out'));
    await expect(
      logMcpCallFromClient({
        toolName: 'muovi_list_services',
        status: 'ok',
      }),
    ).resolves.toBeUndefined();
  });

  it('includesClosedStatusValues', async () => {
    const recorded: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        recorded.push(body.status);
        return new Response('ok');
      },
    );

    for (const status of ['ok', 'error', 'rate_limited', 'leakage_blocked'] as const) {
      await logMcpCallFromClient({ toolName: 'muovi_list_services', status });
    }
    expect(recorded).toEqual(['ok', 'error', 'rate_limited', 'leakage_blocked']);
  });

  it('neverIncludesErrorMessage_onlyErrorClass', async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string | undefined;
        return new Response('ok');
      },
    );

    await logMcpCallFromClient({
      toolName: 'muovi_search_professionals',
      status: 'error',
      errorClass: 'MuoviApiError',
    });

    const parsed = JSON.parse(capturedBody!);
    expect(parsed.error_class).toBe('MuoviApiError');
    // No message field at all.
    expect(parsed).not.toHaveProperty('error_message');
    expect(parsed).not.toHaveProperty('message');
  });
});
