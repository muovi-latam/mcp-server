/**
 * MCP server anti-leakage assertion test.
 *
 * MOB-146's surface registry references THIS path
 * (`packages/mcp-server/__tests__/anti-leakage.test.ts`) — keep it stable.
 *
 * Defense-in-depth: the /v1 API already strips contact data, but every
 * tool response in the MCP server also runs through `assertNoLeakage`.
 * If a leaky payload somehow reaches the agent boundary, the tool throws
 * and the LLM client sees an error instead of leaked contact info.
 */
import { describe, expect, it } from 'vitest';
import { MuoviApiClient } from '../src/api-client.js';
import { assertNoLeakage, findLeaks } from '../src/anti-leakage.js';
import { makeGetProfessionalHandler } from '../src/tools/getProfessional.js';
import { makeSearchProfessionalsHandler } from '../src/tools/searchProfessionals.js';
import {
  cleanProfessionalDetail,
  cleanSearchResponse,
  leakyProResponse,
  makeMockFetch,
} from './fixtures.js';

const BASE = 'https://muovi.com.ar/api/v1';

describe('assertNoLeakage — mirrored canonical fixture', () => {
  it('flags the leakyPro fixture across all four categories', () => {
    const leaks = findLeaks(leakyProResponse);
    const reasons = new Set(leaks.map((l) => l.reason));
    expect(reasons.has('forbidden_key')).toBe(true);
    expect(reasons.has('phone_pattern')).toBe(true);
    expect(reasons.has('email_pattern')).toBe(true);
    expect(reasons.has('whatsapp_pattern')).toBe(true);
  });

  it('throws on the leakyPro fixture', () => {
    expect(() => assertNoLeakage(leakyProResponse)).toThrow(/Anti-leakage violation/);
  });

  it('does not throw on the clean professional payload', () => {
    expect(() => assertNoLeakage(cleanProfessionalDetail)).not.toThrow();
  });

  it('does not throw on the clean search response', () => {
    expect(() => assertNoLeakage(cleanSearchResponse)).not.toThrow();
  });
});

describe('findLeaks — storage URLs and ISO timestamps (WEB-1055)', () => {
  const reasons = (value: string) => findLeaks({ value }).map((leak) => leak.reason);
  const STORAGE =
    'https://hyciaokddgtufwtptpcz.supabase.co/storage/v1/object/public/task-images/8e3c5b41-6f2a-4f7e-8b1d-2c0a9d8f6c11';

  it('does not read the timestamp in a storage URL file name as a phone', () => {
    expect(reasons(`${STORAGE}/portfolio/1771234567890-k3x9q7m2abc.jpg`)).toEqual([]);
    expect(reasons(`${STORAGE}/avatar_1771234500000.jpg`)).toEqual([]);
  });

  it('still reads the same digits as a phone outside an http(s) URL, after other text, and in a tel: URI', () => {
    expect(reasons('avatar_1771234500000.jpg')).toEqual(['phone_pattern']);
    expect(reasons(`Ver ${STORAGE}/avatar_1771234500000.jpg`)).toEqual(['phone_pattern']);
    expect(reasons('tel:+5491155551234')).toEqual(['phone_pattern']);
  });

  it('still flags an e-mail and a wa.me link inside an http(s) URL', () => {
    expect(reasons('https://juan@example.com/a.jpg')).toEqual(['email_pattern']);
    expect(reasons(`${STORAGE}/juan@gmail.com.jpg`)).toEqual(['email_pattern']);
    expect(reasons('https://wa.me/5491155551234')).toEqual(['whatsapp_pattern']);
  });

  it('does not read an ISO timestamp with fractional seconds as a phone, with or without a zone', () => {
    expect(reasons('2025-08-13T11:40:14.251749+00:00')).toEqual([]);
    expect(reasons('2025-08-13T11:40:14.251749Z')).toEqual([]);
    expect(reasons('2025-08-13T11:40:14.251749')).toEqual([]);
    expect(reasons('2025-08-13T11:40:14.251749123Z')).toEqual([]);
    expect(reasons('2024-03-11T10:00:00Z')).toEqual([]);
  });

  it('still flags a phone written after a timestamp', () => {
    expect(reasons('2025-08-13T11:40:14.251749+00:00 11-5555-1234')).toEqual(['phone_pattern']);
  });
});

describe('MCP tool runtime — leak detector fires at the agent boundary', () => {
  it('muovi_get_professional surfaces a tool error when the /v1 response leaks', async () => {
    const { fetch } = makeMockFetch([
      { url: `${BASE}/professionals/juan-electricista`, body: leakyProResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeGetProfessionalHandler(client);

    const result = await handler({ id: 'juan-electricista' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Anti-leakage violation/);
    expect(result.content[0].text).toMatch(/muovi_get_professional/);
  });

  it('muovi_search_professionals also fires the assertion on a leaky list item', async () => {
    // Wrap the leaky pro inside a list-shaped response so the detector
    // walks through `data[0]` and still flags the forbidden keys.
    const leakyListResponse = {
      data: [leakyProResponse.data],
      pagination: { limit: 20, offset: 0, total: 1, has_more: false },
    };
    const { fetch } = makeMockFetch([
      { url: /\/professionals\?/, body: leakyListResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeSearchProfessionalsHandler(client);

    const result = await handler({ service: 'electricidad', neighborhood: 'palermo' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Anti-leakage violation/);
  });

  it('does not throw on a clean /v1 response', async () => {
    const { fetch } = makeMockFetch([
      { url: /\/professionals\?/, body: cleanSearchResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeSearchProfessionalsHandler(client);
    const result = await handler({ service: 'electricidad', neighborhood: 'palermo' });
    expect(result.isError).toBeUndefined();
  });
});
