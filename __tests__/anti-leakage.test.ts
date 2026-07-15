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

describe('MCP tool runtime — leak detector fires at the agent boundary', () => {
  it('muovi_get_professional surfaces a tool error when the /v1 response leaks', async () => {
    const { fetch } = makeMockFetch([
      { url: `${BASE}/professionals/juan-electricista`, body: leakyProResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeGetProfessionalHandler(client);

    const result = await handler({ slug: 'juan-electricista' });

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

    const result = await handler({ service: 'electricidad' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Anti-leakage violation/);
  });

  it('does not throw on a clean /v1 response', async () => {
    const { fetch } = makeMockFetch([
      { url: /\/professionals\?/, body: cleanSearchResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeSearchProfessionalsHandler(client);
    const result = await handler({ service: 'electricidad' });
    expect(result.isError).toBeUndefined();
  });
});
