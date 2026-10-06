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
 *   - `muovi_create_task_draft` POSTs its arguments and maps the replies.
 */
import { describe, expect, it } from 'vitest';
import { MuoviApiClient } from '../src/api-client.js';
import {
  makeSearchProfessionalsHandler,
  SEARCH_MISSING_ARGUMENTS_MESSAGE,
  SEARCH_PROFESSIONALS_DESCRIPTION,
  searchProfessionalsInputShape,
} from '../src/tools/searchProfessionals.js';
import { makeGetProfessionalHandler } from '../src/tools/getProfessional.js';
import { makeListServicesHandler } from '../src/tools/listServices.js';
import { makeListCitiesHandler } from '../src/tools/listCities.js';
import { makeGetReviewsHandler } from '../src/tools/getReviews.js';
import {
  buildTaskLink,
  CREATE_TASK_LINK_DESCRIPTION,
  makeCreateTaskLinkHandler,
  webOriginFrom,
} from '../src/tools/createTaskLink.js';
import {
  CREATE_TASK_DRAFT_ADDRESS_PENDING_NOTE,
  CREATE_TASK_DRAFT_INCOMPLETE_NOTE,
  CREATE_TASK_DRAFT_INVALID_SLOTS_NOTE,
  CREATE_TASK_DRAFT_NOTE,
  makeCreateTaskDraftHandler,
} from '../src/tools/createTaskDraft.js';
import { makeGetServiceRequirementsHandler } from '../src/tools/getServiceRequirements.js';
import {
  cleanCitiesResponse,
  cleanProfessionalDetail,
  cleanReviewsResponse,
  cleanSearchResponse,
  cleanServicesResponse,
  makeMockFetch,
} from './fixtures.js';

const BASE = 'https://muovi.com.ar/api/v1';
const PRO_ID = '8e3c5b41-6f2a-4f7e-8b1d-2c0a9d8f6c11';

describe('muovi_search_professionals', () => {
  it('forwards filter parameters to GET /professionals and returns the payload', async () => {
    const { fetch, calls } = makeMockFetch([
      { url: /\/professionals\?/, body: cleanSearchResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeSearchProfessionalsHandler(client);

    const result = await handler({
      service: 'electricidad',
      neighborhood: 'palermo',
      city: 'caba',
      verified_identity: true,
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(cleanSearchResponse);

    expect(calls).toHaveLength(1);
    const callUrl = new URL(calls[0].url);
    expect(callUrl.pathname).toBe('/api/v1/professionals');
    expect(callUrl.searchParams.get('service')).toBe('electricidad');
    expect(callUrl.searchParams.get('city')).toBe('caba');
    expect(callUrl.searchParams.get('neighborhood')).toBe('palermo');
    expect(callUrl.searchParams.get('verified_identity')).toBe('true');
    expect([...callUrl.searchParams.keys()].sort()).toEqual(['city', 'neighborhood', 'service', 'verified_identity']);
  });

  it('WEB-1039 — sends none of min_rating, min_reviews, limit or offset, whatever the caller passes', async () => {
    const { fetch, calls } = makeMockFetch([{ url: /\/professionals\?/, body: cleanSearchResponse }]);
    const handler = makeSearchProfessionalsHandler(new MuoviApiClient({ baseUrl: BASE, fetch }));

    await handler({ service: 'plomeria', neighborhood: 'palermo', min_rating: 4.5, min_reviews: 10, limit: 50, offset: 5 });

    expect([...new URL(calls[0].url).searchParams.keys()].sort()).toEqual(['neighborhood', 'service']);
    expect(Object.keys(searchProfessionalsInputShape).sort()).toEqual([
      'city',
      'has_matricula',
      'neighborhood',
      'service',
      'verified_identity',
    ]);
  });

  it('WEB-1039 — a call without a service or a barrio is a tool error that asks for both, with no HTTP call', async () => {
    const { fetch, calls } = makeMockFetch([{ url: /\/professionals/, body: cleanSearchResponse }]);
    const handler = makeSearchProfessionalsHandler(new MuoviApiClient({ baseUrl: BASE, fetch }));

    for (const args of [undefined, {}, { service: 'plomeria' }, { neighborhood: 'palermo' }, { service: ' ', neighborhood: 'palermo' }, { city: 'caba' }]) {
      const result = await handler(args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.content[0].text).toContain(SEARCH_MISSING_ARGUMENTS_MESSAGE);
    }
    expect(calls).toHaveLength(0);
  });

  it('WEB-1039 — the description states the cap, both required arguments, that unreviewed professionals may appear, and the two choices', () => {
    expect(SEARCH_PROFESSIONALS_DESCRIPTION).toContain('up to 5');
    expect(SEARCH_PROFESSIONALS_DESCRIPTION).toContain('are required');
    expect(SEARCH_PROFESSIONALS_DESCRIPTION).toContain('Results list professionals who declare the searched trade first, ordered by review score');
    expect(SEARCH_PROFESSIONALS_DESCRIPTION).toContain('present the results as professionals who work in that barrio');
    expect(SEARCH_PROFESSIONALS_DESCRIPTION).toContain('offer the person two choices');
    expect(SEARCH_PROFESSIONALS_DESCRIPTION).not.toMatch(/min_rating|min_reviews|minimum rating/i);
  });
});

describe('muovi_get_professional', () => {
  it('GETs /professionals/{id} and returns the detail payload', async () => {
    const { fetch, calls } = makeMockFetch([
      {
        url: `${BASE}/professionals/${PRO_ID}`,
        body: { data: cleanProfessionalDetail },
      },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeGetProfessionalHandler(client);

    const result = await handler({ id: PRO_ID });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toEqual(cleanProfessionalDetail);
    expect(calls[0].url).toBe(`${BASE}/professionals/${PRO_ID}`);
  });

  it('WEB-1039 — accepts a legacy ProSite slug in `id`, and answers a tool error with no HTTP call for a missing or malformed one', async () => {
    const { fetch, calls } = makeMockFetch([
      { url: `${BASE}/professionals/juan-p-electricista-caba`, body: { data: cleanProfessionalDetail } },
    ]);
    const handler = makeGetProfessionalHandler(new MuoviApiClient({ baseUrl: BASE, fetch }));

    expect((await handler({ id: 'juan-p-electricista-caba' })).isError).toBeUndefined();
    expect(calls).toHaveLength(1);

    for (const args of [undefined, {}, { id: '' }, { id: 7 }, { id: '../cities' }, { slug: 'juan-p-electricista-caba' }]) {
      expect((await handler(args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(calls).toHaveLength(1);
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
  it('GETs /professionals/{id}/reviews with pagination params', async () => {
    const { fetch, calls } = makeMockFetch([
      { url: new RegExp(`/professionals/${PRO_ID}/reviews`), body: cleanReviewsResponse },
    ]);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const handler = makeGetReviewsHandler(client);

    const result = await handler({
      id: PRO_ID,
      limit: 5,
      offset: 0,
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(cleanReviewsResponse);

    const callUrl = new URL(calls[0].url);
    expect(callUrl.pathname).toBe(`/api/v1/professionals/${PRO_ID}/reviews`);
    expect(callUrl.searchParams.get('limit')).toBe('5');
    expect(callUrl.searchParams.get('offset')).toBe('0');
  });
});

describe('muovi_create_task_link (PURE FORMATTER)', () => {
  it('returns Muovi\'s task creation for the professional without making any network call', async () => {
    const realFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}');
    }) as typeof fetch;
    try {
      const result = await makeCreateTaskLinkHandler()({ professional_id: PRO_ID, service_slug: 'electricidad' });

      expect(fetchCalled).toBe(false);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.url).toBe(
        `https://muovi.com.ar/post-task/v2?pro=${PRO_ID}&vertical=electricidad&source=assistant-link`,
      );
      expect(parsed.url).not.toContain('/p/');
      expect(parsed).toMatchObject({ professional_id: PRO_ID, service_slug: 'electricidad' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('buildTaskLink lower-cases the id and drops the origin\'s trailing slash', () => {
    expect(buildTaskLink(PRO_ID.toUpperCase(), 'plomeria', 'https://dev.muovi.com.ar/')).toBe(
      `https://dev.muovi.com.ar/post-task/v2?pro=${PRO_ID}&vertical=plomeria&source=assistant-link`,
    );
  });

  it('builds on the configured web origin, and falls back to muovi.com.ar for one that is not an https origin', async () => {
    const handler = makeCreateTaskLinkHandler({ baseUrl: 'https://staging.muovi.com.ar' });
    const result = await handler({ professional_id: PRO_ID, service_slug: 'plomeria' });
    expect(JSON.parse(result.content[0].text).url).toBe(
      `https://staging.muovi.com.ar/post-task/v2?pro=${PRO_ID}&vertical=plomeria&source=assistant-link`,
    );
    for (const value of [undefined, '', 'http://dev.muovi.com.ar', 'https://x.test/path', 'not a url', 'javascript:alert(1)']) {
      expect(webOriginFrom(value), String(value)).toBe('https://muovi.com.ar');
    }
  });

  it('WEB-1039 — a missing or malformed argument is a tool error carrying no URL', async () => {
    const bad: unknown[] = [
      undefined,
      null,
      {},
      { service_slug: 'electricidad' },
      { professional_id: PRO_ID },
      { professional_id: PRO_ID, service_slug: undefined },
      { professional_id: PRO_ID, service_slug: null },
      { professional_id: PRO_ID, service_slug: '' },
      { professional_id: PRO_ID, service_slug: 7 },
      { professional_id: PRO_ID, service_slug: 'Has Spaces' },
      { professional_id: 'juan-p-electricista', service_slug: 'electricidad' },
      { professional_slug: 'juan-p-electricista', service_slug: 'electricidad' },
      { professional_id: null, service_slug: 'electricidad' },
      { professional_id: 12, service_slug: 'electricidad' },
    ];
    const handler = makeCreateTaskLinkHandler();
    for (const args of bad) {
      const result = await handler(args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.content[0].text).not.toMatch(/https?:\/\//);
    }
  });

  it('WEB-1039 — across generated argument pairs, every url built contains neither "undefined" nor "null"', async () => {
    const ids: unknown[] = [PRO_ID, PRO_ID.toUpperCase(), undefined, null, '', 'undefined', 'null', 0, true, {}, []];
    const services: unknown[] = ['electricidad', 'plomeria', 'zz-unknown', undefined, null, '', 'undefined', 'null', 5, false];
    const handler = makeCreateTaskLinkHandler();
    let built = 0;
    for (const professional_id of ids) {
      for (const service_slug of services) {
        const result = await handler({ professional_id, service_slug });
        if (result.isError) continue;
        built += 1;
        const { url } = JSON.parse(result.content[0].text) as { url: string };
        expect(url, JSON.stringify({ professional_id, service_slug })).not.toMatch(/undefined|null/);
      }
    }
    expect(built).toBeGreaterThan(0);
  });

  it('the description names any search result, the 24 hours and the other-offers option, and no ProSite link', () => {
    expect(CREATE_TASK_LINK_DESCRIPTION).toContain('Any professional in the search results can be picked');
    expect(CREATE_TASK_LINK_DESCRIPTION).toContain('first for 24 hours');
    expect(CREATE_TASK_LINK_DESCRIPTION).toContain('also receive offers from other professionals');
    expect(CREATE_TASK_LINK_DESCRIPTION).not.toContain('/p/');
  });
});

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function recordingFetch(
  status: number,
  body: unknown,
): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fakeFetch, requests };
}

const TOKEN_URL =
  'https://muovi.com.ar/post-task/v2?vertical=electricidad#handover=QwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJk';

describe('muovi_create_task_draft', () => {
  const args = {
    service_slug: 'electricidad',
    professional_id: PRO_ID,
    open_to_others: true,
    description: 'Se corta la luz cuando prendo el horno y el aire a la vez.',
    zone_text: 'Palermo',
    preferred_time: 'specific_date' as const,
    preferred_date: '2026-09-20',
  };

  it('POSTs the arguments as JSON to /task-handovers and returns the link', async () => {
    const { fetch, requests } = recordingFetch(201, {
      url: TOKEN_URL,
      expires_at: '2026-09-15T14:50:09.123Z',
    });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(args);

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({
      url: TOKEN_URL,
      expires_at: '2026-09-15T14:50:09.123Z',
      note: CREATE_TASK_DRAFT_NOTE,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://muovi.com.ar/api/v1/task-handovers');
    expect(requests[0].method).toBe('POST');
    expect(requests[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(requests[0].body ?? 'null')).toEqual(args);
  });

  it('re-serialises a microsecond expires_at so the anti-leakage check lets the link through', async () => {
    const { fetch } = recordingFetch(201, {
      url: TOKEN_URL,
      expires_at: '2026-09-15T14:50:09.123456+00:00',
    });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(args);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(TOKEN_URL);
    expect(parsed.expires_at).toBe('2026-09-15T14:50:09.123Z');
  });

  it('reports a 404 as creation not being available', async () => {
    const { fetch } = recordingFetch(404, { error: { code: 'not_found', message: 'Not found' } });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Muovi MCP tool error (muovi_create_task_draft): Creating task drafts on Muovi is not available right now.',
    );
  });

  it('surfaces an invalid_parameter reply with its code and message', async () => {
    const { fetch } = recordingFetch(400, {
      error: {
        code: 'invalid_parameter',
        message: 'description must be between 20 and 2000 characters.',
        details: { parameter: 'description' },
      },
    });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)({ ...args, description: 'corto' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('status 400, code invalid_parameter');
    expect(result.content[0].text).toContain('description must be between 20 and 2000 characters.');
  });

  it('returns a tool error when the 201 body carries no url', async () => {
    const { fetch } = recordingFetch(201, { expires_at: '2026-09-15T14:50:09.123Z' });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('without a url and expires_at');
  });
});

describe('muovi_create_task_draft — a complete intake (WEB-1005)', () => {
  const complete = {
    service_slug: 'plomeria',
    description: 'Pierde agua la canilla de la cocina y gotea debajo de la mesada.',
    location: { neighborhood_slug: 'palermo' },
    slots: { urgency: 'esta_semana', ambiente_del_trabajo: 'cocina', puede_cerrar_la_llave: true },
    time_preferences: ['morning' as const],
  };

  it('POSTs slots, location and time preferences unchanged, and reports a place still to pick', async () => {
    const { fetch, requests } = recordingFetch(201, {
      url: TOKEN_URL,
      expires_at: '2026-09-15T14:50:09.123Z',
      address_pending: true,
    });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(complete);

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({
      url: TOKEN_URL,
      expires_at: '2026-09-15T14:50:09.123Z',
      note: `${CREATE_TASK_DRAFT_NOTE} ${CREATE_TASK_DRAFT_ADDRESS_PENDING_NOTE}`,
      address_pending: true,
    });
    expect(JSON.parse(requests[0].body ?? 'null')).toEqual(complete);
  });

  it('turns a 422 incomplete_intake into the questions to ask, with no url and no error flag', async () => {
    const missing = [
      {
        key: 'fecha_preferida',
        question_es: '¿Qué día te queda cómodo para la visita?',
        type: 'date',
        options: null,
        value_format: 'A calendar date, YYYY-MM-DD.',
      },
    ];
    const { fetch } = recordingFetch(422, {
      error: { code: 'incomplete_intake', message: 'Required questions are unanswered.', details: { missing } },
    });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(complete);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ status: 'incomplete', missing, note: CREATE_TASK_DRAFT_INCOMPLETE_NOTE });
    expect('url' in parsed).toBe(false);
  });

  it('turns a 422 invalid_slots into the refused slots, with no url', async () => {
    const rejections = [
      {
        slot_key: 'urgency',
        reason_code: 'ENUM_VALUE_NOT_IN_OPTIONS',
        message: '"urgency" must be one of: hoy, esta_semana, flexible, emergencia.',
      },
    ];
    const { fetch } = recordingFetch(422, {
      error: { code: 'invalid_slots', message: 'Some slot values were not accepted.', details: { rejections } },
    });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(complete);

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({
      status: 'invalid_slots',
      rejections,
      note: CREATE_TASK_DRAFT_INVALID_SLOTS_NOTE,
    });
  });

  it('a 422 whose details carry a phone number is blocked by the anti-leakage check', async () => {
    const { fetch } = recordingFetch(422, {
      error: {
        code: 'invalid_slots',
        message: 'Some slot values were not accepted.',
        details: { rejections: [{ slot_key: 'urgency', message: 'llamar al +54 9 11 5555-1234' }] },
      },
    });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(complete);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('5555');
  });

  it('a 422 with another code stays an API error', async () => {
    const { fetch } = recordingFetch(422, { error: { code: 'something_else', message: 'nope' } });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeCreateTaskDraftHandler(client)(complete);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('status 422, code something_else');
  });
});

describe('muovi_get_service_requirements (WEB-1005)', () => {
  const view = {
    data: {
      service_slug: 'plomeria',
      vertical: 'plomeria',
      scope: 'vertical',
      spec_version: 'web838-plomeria-1.7',
      slots: [
        {
          key: 'puede_cerrar_la_llave',
          question_es: '¿Podés cerrar la llave de paso del agua si hace falta?',
          type: 'boolean',
          options: null,
          value_format: 'true or false.',
          required: true,
          ask_if: null,
        },
      ],
      photo_policy: { mode: 'optional', min: null, target_es: null, why_es: null },
    },
  };

  it('GETs /services/{slug}/requirements and returns the payload', async () => {
    const { fetch, requests } = recordingFetch(200, view);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    const result = await makeGetServiceRequirementsHandler(client)({ service_slug: 'plomeria' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(view);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://muovi.com.ar/api/v1/services/plomeria/requirements');
    expect(requests[0].method).toBe('GET');
  });

  it('percent-encodes the slug into one path segment', async () => {
    const { fetch, requests } = recordingFetch(404, { error: { code: 'not_found', message: 'service_slug is not a service Muovi lists.' } });
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });
    await makeGetServiceRequirementsHandler(client)({ service_slug: '../cities' });
    expect(requests[0].url).toBe('https://muovi.com.ar/api/v1/services/..%2Fcities/requirements');
  });

  it('reports the switched-off 404 as not available, and an unlisted slug with the API message', async () => {
    const off = recordingFetch(404, { error: { code: 'not_found', message: 'Not found' } });
    const offResult = await makeGetServiceRequirementsHandler(new MuoviApiClient({ baseUrl: BASE, fetch: off.fetch }))({
      service_slug: 'plomeria',
    });
    expect(offResult.isError).toBe(true);
    expect(offResult.content[0].text).toBe(
      'Muovi MCP tool error (muovi_get_service_requirements): Creating task drafts on Muovi is not available right now.',
    );

    const unknown = recordingFetch(404, {
      error: { code: 'not_found', message: 'service_slug is not a service Muovi lists.' },
    });
    const unknownResult = await makeGetServiceRequirementsHandler(
      new MuoviApiClient({ baseUrl: BASE, fetch: unknown.fetch }),
    )({ service_slug: 'astronautica' });
    expect(unknownResult.isError).toBe(true);
    expect(unknownResult.content[0].text).toContain('service_slug is not a service Muovi lists.');
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

  it('sends the package version in the User-Agent on GET and POST', async () => {
    const { fetch, requests } = recordingFetch(200, cleanServicesResponse);
    const client = new MuoviApiClient({ baseUrl: BASE, fetch });

    await client.get('/services');
    await client.post('/task-handovers', {});

    expect(requests.map((request) => request.headers['User-Agent'])).toEqual([
      'muovi-mcp-server/0.4.2 (+https://muovi.com.ar)',
      'muovi-mcp-server/0.4.2 (+https://muovi.com.ar)',
    ]);
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
          error: { code: 'not_found', message: "No professional 'unknown'" },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    const client = new MuoviApiClient({ baseUrl: BASE, fetch: fakeFetch });
    const handler = makeGetProfessionalHandler(client);
    const result = await handler({ id: 'unknown' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not_found/);
    expect(result.content[0].text).toMatch(/unknown/);
  });
});
