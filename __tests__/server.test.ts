/**
 * End-to-end integration: build the MCP server with a mock-fetch-backed
 * API client and invoke each registered tool through the SDK's in-memory
 * transport pair. Asserts that:
 *
 *   1. Every `TOOL_NAMES` entry is registered.
 *   2. Each tool, when called, returns conformant data shaped like /v1.
 *   3. `muovi_create_task_link` resolves without touching fetch.
 *   4. `muovi_create_task_draft` is annotated as a write and POSTs through
 *      the SDK.
 *
 * Uses `InMemoryTransport` from `@modelcontextprotocol/sdk` (the SDK's
 * supported way to drive an MCP server in tests) instead of spawning a
 * subprocess — keeps the test fast and deterministic, and exercises the
 * same `Server.connect` + JSON-RPC code path as the real stdio transport.
 */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, TOOL_NAMES } from '../src/server.js';
import { MuoviApiClient } from '../src/api-client.js';
import {
  cleanCitiesResponse,
  cleanProfessionalDetail,
  cleanReviewsResponse,
  cleanSearchResponse,
  cleanServicesResponse,
  makeMockFetch,
} from './fixtures.js';

const BASE = 'https://muovi.com.ar/api/v1';

async function bootClient(client: MuoviApiClient): Promise<{
  client: Client;
  shutdown: () => Promise<void>;
}> {
  const server = buildServer({ apiClient: client });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return {
    client: mcpClient,
    shutdown: async () => {
      await mcpClient.close();
      await server.close();
    },
  };
}

describe('@muovi/mcp-server — stdio integration (in-memory transport pair)', () => {
  it('registers every TOOL_NAMES entry, including muovi_create_task_draft, with descriptions', async () => {
    const { fetch } = makeMockFetch([]);
    const apiClient = new MuoviApiClient({ baseUrl: BASE, fetch });
    const { client, shutdown } = await bootClient(apiClient);
    try {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([...TOOL_NAMES].sort());
      expect(names).toContain('muovi_create_task_draft');
      // WEB-1005 — the requirements tool joins the list.
      expect(names).toContain('muovi_get_service_requirements');
      expect(names).toHaveLength(8);
      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
        expect((tool.description ?? '').length).toBeGreaterThan(40);
      }
    } finally {
      await shutdown();
    }
  });

  it('muovi_search_professionals returns conformant data via the SDK', async () => {
    const { fetch } = makeMockFetch([
      { url: /\/professionals\?/, body: cleanSearchResponse },
    ]);
    const apiClient = new MuoviApiClient({ baseUrl: BASE, fetch });
    const { client, shutdown } = await bootClient(apiClient);
    try {
      const result = await client.callTool({
        name: 'muovi_search_professionals',
        arguments: { service: 'electricidad', neighborhood: 'palermo', city: 'caba' },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(cleanSearchResponse);
    } finally {
      await shutdown();
    }
  });

  it('muovi_get_professional returns the detail payload via the SDK', async () => {
    const { fetch } = makeMockFetch([
      {
        url: `${BASE}/professionals/${cleanProfessionalDetail.id}`,
        body: { data: cleanProfessionalDetail },
      },
    ]);
    const apiClient = new MuoviApiClient({ baseUrl: BASE, fetch });
    const { client, shutdown } = await bootClient(apiClient);
    try {
      const result = await client.callTool({
        name: 'muovi_get_professional',
        arguments: { id: cleanProfessionalDetail.id },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text).data).toEqual(cleanProfessionalDetail);
    } finally {
      await shutdown();
    }
  });

  it('muovi_list_services + muovi_list_cities return their catalogs', async () => {
    const { fetch } = makeMockFetch([
      { url: `${BASE}/services`, body: cleanServicesResponse },
      { url: `${BASE}/cities`, body: cleanCitiesResponse },
    ]);
    const apiClient = new MuoviApiClient({ baseUrl: BASE, fetch });
    const { client, shutdown } = await bootClient(apiClient);
    try {
      const services = await client.callTool({
        name: 'muovi_list_services',
        arguments: {},
      });
      const cities = await client.callTool({
        name: 'muovi_list_cities',
        arguments: {},
      });
      const sText = (services.content as Array<{ type: string; text: string }>)[0].text;
      const cText = (cities.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(sText)).toEqual(cleanServicesResponse);
      expect(JSON.parse(cText)).toEqual(cleanCitiesResponse);
    } finally {
      await shutdown();
    }
  });

  it('muovi_get_reviews returns reviews via the SDK', async () => {
    const { fetch } = makeMockFetch([
      { url: /\/professionals\/juan\/reviews/, body: cleanReviewsResponse },
    ]);
    const apiClient = new MuoviApiClient({ baseUrl: BASE, fetch });
    const { client, shutdown } = await bootClient(apiClient);
    try {
      const result = await client.callTool({
        name: 'muovi_get_reviews',
        arguments: { id: 'juan', limit: 5 },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(cleanReviewsResponse);
    } finally {
      await shutdown();
    }
  });

  it('muovi_create_task_link returns the deep-link without invoking fetch', async () => {
    let fetchCalled = false;
    const fakeFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('{}');
    };
    const apiClient = new MuoviApiClient({ baseUrl: BASE, fetch: fakeFetch });
    const { client, shutdown } = await bootClient(apiClient);
    try {
      const result = await client.callTool({
        name: 'muovi_create_task_link',
        arguments: {
          professional_id: cleanProfessionalDetail.id,
          service_slug: 'electricidad',
        },
      });
      expect(fetchCalled).toBe(false);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.url).toBe(
        `https://muovi.com.ar/post-task/v2?pro=${cleanProfessionalDetail.id}&vertical=electricidad&source=assistant-link`,
      );
    } finally {
      await shutdown();
    }
  });
  it('annotates muovi_create_task_draft as a non-idempotent write and leaves muovi_create_task_link read-only', async () => {
    const { fetch } = makeMockFetch([]);
    const apiClient = new MuoviApiClient({ baseUrl: BASE, fetch });
    const { client, shutdown } = await bootClient(apiClient);
    try {
      const { tools } = await client.listTools();
      const draft = tools.find((t) => t.name === 'muovi_create_task_draft');
      const link = tools.find((t) => t.name === 'muovi_create_task_link');
      // ChatGPT's plugin scan rejects a tool that leaves any of these three to the protocol default.
      for (const tool of tools) {
        for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const) {
          expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe('boolean');
        }
      }
      expect(draft?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
      expect(link?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    } finally {
      await shutdown();
    }
  });

  it('muovi_create_task_draft POSTs via the SDK and returns the link', async () => {
    const { fetch, calls } = makeMockFetch([
      {
        url: `${BASE}/task-handovers`,
        status: 201,
        body: {
          url: 'https://muovi.com.ar/post-task#handover=QwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJk',
          expires_at: '2026-09-15T14:50:09.123456+00:00',
        },
      },
    ]);
    const apiClient = new MuoviApiClient({ baseUrl: BASE, fetch });
    const { client, shutdown } = await bootClient(apiClient);
    try {
      const result = await client.callTool({
        name: 'muovi_create_task_draft',
        arguments: {
          service_slug: 'electricidad',
          description: 'Se corta la luz cuando prendo el horno y el aire a la vez.',
        },
      });
      expect(result.isError).toBeFalsy();
      expect(calls).toEqual([{ url: `${BASE}/task-handovers`, method: 'POST' }]);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.url).toBe(
        'https://muovi.com.ar/post-task#handover=QwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJk',
      );
      expect(parsed.expires_at).toBe('2026-09-15T14:50:09.123Z');
    } finally {
      await shutdown();
    }
  });
});
