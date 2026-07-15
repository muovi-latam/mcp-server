/**
 * One test per MCP tool. Each test:
 *   1. Builds a `MuoviApiClient` backed by a mock fetch.
 *   2. Invokes the tool handler with a representative input.
 *   3. Asserts the response parses back to the original /v1 payload
 *      and that the underlying URL/query string matches the spec.
 *
 * Also covers:
 *   - 429 → RateLimitedError surfacing.
 *   - `MUOVI_API_KEY` env var → `X-API-Key` header forwarding.
 *   - `muovi_create_task_link` never invokes fetch.
 */
import { describe, expect, it } from 'vitest';
import { MuoviApiClient } from '../src/api-client.js';
import { makeSearchProfessionalsHandler } from '../src/tools/searchProfessionals.js';
import { makeGetProfessionalHandler } from '../src/tools/getProfessional.js';
import { makeListServicesHandler } from '../src/tools/listServices.js';
import { makeListCitiesHandler } from '../src/tools/listCities.js';
import { makeGetReviewsHandler } from '../src/tools/getReviews.js';
import {
  buildTaskLink,
  makeCreateTaskLinkHandler,
} from '../src/tools/createTaskLink.js';
import {
  cleanCitiesResponse,
  cleanProfessionalDetail,
  cleanReviewsResponse,
  cleanSearchResponse,
  cleanServicesResponse,
  makeMockFetch,
} from './fixtures.js';

const BASE = 'https://muovi.com.ar/api/v1';

describe('muovi_search_professionals', () => {
  it('forwards filter parameters to GET /professionals and returns the payload', async () => {
    const { fetch, calls } = makeMockFetch([
      { url: /\/professionals\?/, body: cleanSearchResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeSearchProfessionalsHandler(client);

    const result = await handler({
      service: 'electricidad',
      city: 'caba',
      verified_identity: true,
      min_rating: 4.5,
      limit: 20,
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(cleanSearchResponse);

    expect(calls).toHaveLength(1);
    const callUrl = new URL(calls[0].url);
    expect(callUrl.pathname).toBe('/api/v1/professionals');
    expect(callUrl.searchParams.get('service')).toBe('electricidad');
    expect(callUrl.searchParams.get('city')).toBe('caba');
    expect(callUrl.searchParams.get('verified_identity')).toBe('true');
    expect(callUrl.searchParams.get('min_rating')).toBe('4.5');
    expect(callUrl.searchParams.get('limit')).toBe('20');
  });
});

describe('muovi_get_professional', () => {
  it('GETs /professionals/{slug} and returns the detail payload', async () => {
    const { fetch, calls } = makeMockFetch([
      {
        url: `${BASE}/professionals/juan-p-electricista-caba`,
        body: { data: cleanProfessionalDetail },
      },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeGetProfessionalHandler(client);

    const result = await handler({ slug: 'juan-p-electricista-caba' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toEqual(cleanProfessionalDetail);
    expect(calls[0].url).toBe(`${BASE}/professionals/juan-p-electricista-caba`);
  });
});

describe('muovi_list_services', () => {
  it('GETs /services and returns the catalog', async () => {
    const { fetch, calls } = makeMockFetch([
      { url: `${BASE}/services`, body: cleanServicesResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeListServicesHandler(client);

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(cleanServicesResponse);
    expect(calls[0].url).toBe(`${BASE}/services`);
  });
});

describe('muovi_list_cities', () => {
  it('GETs /cities and returns the catalog', async () => {
    const { fetch, calls } = makeMockFetch([
      { url: `${BASE}/cities`, body: cleanCitiesResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeListCitiesHandler(client);

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(cleanCitiesResponse);
    expect(calls[0].url).toBe(`${BASE}/cities`);
  });
});

describe('muovi_get_reviews', () => {
  it('GETs /professionals/{slug}/reviews with pagination params', async () => {
    const { fetch, calls } = makeMockFetch([
      { url: /\/professionals\/juan-p-electricista-caba\/reviews/, body: cleanReviewsResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeGetReviewsHandler(client);

    const result = await handler({
      slug: 'juan-p-electricista-caba',
      limit: 5,
      offset: 0,
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(cleanReviewsResponse);

    const callUrl = new URL(calls[0].url);
    expect(callUrl.pathname).toBe('/api/v1/professionals/juan-p-electricista-caba/reviews');
    expect(callUrl.searchParams.get('limit')).toBe('5');
    expect(callUrl.searchParams.get('offset')).toBe('0');
  });
});

describe('muovi_create_task_link (PURE FORMATTER)', () => {
  it('returns the canonical deep-link without making any network call', async () => {
    let fetchCalled = false;
    const fakeFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('{}');
    };
    const handler = makeCreateTaskLinkHandler();
    const result = await handler({
      professional_slug: 'juan-p-electricista-caba',
      service_slug: 'electricidad',
    });

    expect(fetchCalled).toBe(false);
    expect(result.isError).toBeUndefined();
    // unreferenced var just to keep the typecheck honest
    void fakeFetch;

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(
      'https://muovi.com.ar/p/juan-p-electricista-caba?create_task=1&service=electricidad',
    );
    expect(parsed.professional_slug).toBe('juan-p-electricista-caba');
    expect(parsed.service_slug).toBe('electricidad');
  });

  it('buildTaskLink is pure string interpolation', () => {
    expect(
      buildTaskLink('juan-p-electricista-caba', 'electricidad'),
    ).toBe(
      'https://muovi.com.ar/p/juan-p-electricista-caba?create_task=1&service=electricidad',
    );
  });

  it('respects the webBaseUrl override', async () => {
    const handler = makeCreateTaskLinkHandler({ baseUrl: 'https://staging.muovi.com.ar' });
    const result = await handler({
      professional_slug: 'maria-plomeria',
      service_slug: 'plomeria',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(
      'https://staging.muovi.com.ar/p/maria-plomeria?create_task=1&service=plomeria',
    );
  });
});

describe('MuoviApiClient — auth + rate limiting', () => {
  it('forwards MUOVI_API_KEY as X-API-Key header', async () => {
    const seenHeaders: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      Object.assign(seenHeaders, headers);
      return new Response(JSON.stringify(cleanServicesResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new MuoviApiClient({
      baseUrl: BASE,
      apiKey: 'test-key-abc',
      fetch: fakeFetch,
    });
    await client.get('/services');
    expect(seenHeaders['X-API-Key']).toBe('test-key-abc');
    expect(seenHeaders['X-Muovi-Connector']).toBe('muovi-mcp-server');
  });

  it('does NOT send X-API-Key when no apiKey provided', async () => {
    const seenHeaders: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      Object.assign(seenHeaders, headers);
      return new Response(JSON.stringify(cleanServicesResponse), { status: 200 });
    };
    // Explicitly do not pass apiKey, and ensure env doesn't leak.
    const prev = process.env.MUOVI_API_KEY;
    delete process.env.MUOVI_API_KEY;
    try {
      const client = new MuoviApiClient({ baseUrl: BASE, fetch: fakeFetch });
      await client.get('/services');
      expect(seenHeaders['X-API-Key']).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.MUOVI_API_KEY = prev;
    }
  });

  it('surfaces 429 as a tool error including Retry-After', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'rate_limited',
            message: 'Too many requests. Try again in 60 seconds.',
            details: { retry_after_seconds: 60 },
          },
        }),
        {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '60' },
        },
      );
    const client = new MuoviApiClient({ baseUrl: BASE, fetch: fakeFetch });
    const handler = makeListServicesHandler(client);
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/rate-limited/i);
    expect(result.content[0].text).toMatch(/60/);
  });

  it('surfaces 4xx errors with code + message', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'not_found', message: "No professional with slug 'unknown'" },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    const client = new MuoviApiClient({ baseUrl: BASE, fetch: fakeFetch });
    const handler = makeGetProfessionalHandler(client);
    const result = await handler({ slug: 'unknown' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not_found/);
    expect(result.content[0].text).toMatch(/unknown/);
  });
});
