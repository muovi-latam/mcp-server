/**
 * Muovi MCP server (stdio mode) — registers the 6 public-API tools on a
 * configurable MCP server instance.
 *
 * Hosted HTTP/SSE variant lives in MOB-142 (separate package surface);
 * this file targets the stdio entrypoint that ships with `npx
 * @muovi/mcp-server` for Claude Desktop, Cursor, and Claude Code.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MuoviApiClient, type MuoviApiClientOptions } from './api-client.js';
import {
  SEARCH_PROFESSIONALS_NAME,
  SEARCH_PROFESSIONALS_DESCRIPTION,
  searchProfessionalsInputShape,
  makeSearchProfessionalsHandler,
} from './tools/searchProfessionals.js';
import {
  GET_PROFESSIONAL_NAME,
  GET_PROFESSIONAL_DESCRIPTION,
  getProfessionalInputShape,
  makeGetProfessionalHandler,
} from './tools/getProfessional.js';
import {
  LIST_SERVICES_NAME,
  LIST_SERVICES_DESCRIPTION,
  listServicesInputShape,
  makeListServicesHandler,
} from './tools/listServices.js';
import {
  LIST_CITIES_NAME,
  LIST_CITIES_DESCRIPTION,
  listCitiesInputShape,
  makeListCitiesHandler,
} from './tools/listCities.js';
import {
  GET_REVIEWS_NAME,
  GET_REVIEWS_DESCRIPTION,
  getReviewsInputShape,
  makeGetReviewsHandler,
} from './tools/getReviews.js';
import {
  CREATE_TASK_LINK_NAME,
  CREATE_TASK_LINK_DESCRIPTION,
  createTaskLinkInputShape,
  makeCreateTaskLinkHandler,
} from './tools/createTaskLink.js';

export interface BuildServerOptions {
  /** Forwarded to MuoviApiClient. Lets tests inject a fake fetch. */
  apiClient?: MuoviApiClient;
  /** When apiClient is not supplied, this is used to construct one. */
  apiClientOptions?: MuoviApiClientOptions;
  /** Override the deep-link base URL used by `muovi_create_task_link`. */
  webBaseUrl?: string;
  /** Package version surfaced to MCP clients. */
  version?: string;
}

export const PACKAGE_NAME = '@muovi/mcp-server';
export const PACKAGE_VERSION = '0.1.3';

export const TOOL_NAMES = [
  SEARCH_PROFESSIONALS_NAME,
  GET_PROFESSIONAL_NAME,
  LIST_SERVICES_NAME,
  LIST_CITIES_NAME,
  GET_REVIEWS_NAME,
  CREATE_TASK_LINK_NAME,
] as const;

export function buildServer(opts: BuildServerOptions = {}): McpServer {
  const client = opts.apiClient ?? new MuoviApiClient(opts.apiClientOptions);

  const server = new McpServer({
    name: PACKAGE_NAME,
    version: opts.version ?? PACKAGE_VERSION,
  });

  server.registerTool(
    SEARCH_PROFESSIONALS_NAME,
    {
      title: 'Search professionals',
      description: SEARCH_PROFESSIONALS_DESCRIPTION,
      inputSchema: searchProfessionalsInputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    makeSearchProfessionalsHandler(client),
  );

  server.registerTool(
    GET_PROFESSIONAL_NAME,
    {
      title: 'Get professional',
      description: GET_PROFESSIONAL_DESCRIPTION,
      inputSchema: getProfessionalInputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    makeGetProfessionalHandler(client),
  );

  server.registerTool(
    LIST_SERVICES_NAME,
    {
      title: 'List services',
      description: LIST_SERVICES_DESCRIPTION,
      inputSchema: listServicesInputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    makeListServicesHandler(client),
  );

  server.registerTool(
    LIST_CITIES_NAME,
    {
      title: 'List cities',
      description: LIST_CITIES_DESCRIPTION,
      inputSchema: listCitiesInputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    makeListCitiesHandler(client),
  );

  server.registerTool(
    GET_REVIEWS_NAME,
    {
      title: 'Get reviews',
      description: GET_REVIEWS_DESCRIPTION,
      inputSchema: getReviewsInputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    makeGetReviewsHandler(client),
  );

  server.registerTool(
    CREATE_TASK_LINK_NAME,
    {
      title: 'Create task deep-link',
      description: CREATE_TASK_LINK_DESCRIPTION,
      inputSchema: createTaskLinkInputShape,
      annotations: {
        readOnlyHint: true,
        // Pure formatter — no side effects, no network.
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    makeCreateTaskLinkHandler({ baseUrl: opts.webBaseUrl }),
  );

  return server;
}
