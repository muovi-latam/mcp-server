/**
 * Tool: muovi_list_cities
 * Wraps: GET /v1/cities
 * Spec:  public/openapi.yaml -> operationId: listCities
 */
import { z } from 'zod';
import type { MuoviApiClient } from '../api-client.js';
import type { CatalogResponse, CityRef } from '../types.js';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const LIST_CITIES_NAME = 'muovi_list_cities';

export const LIST_CITIES_DESCRIPTION =
  'List every Argentine city Muovi serves, with active neighborhoods nested under each. Each city has a stable `slug` (used as the `city` parameter on `muovi_search_professionals`) and a human-readable `name`. Each neighborhood has its own `slug` (used as the `neighborhood` parameter on `muovi_search_professionals`). Call this when you need to resolve a user\'s location wording to a Muovi city or neighborhood slug.';

/** This operation takes no parameters per the OpenAPI spec. */
export const listCitiesInputShape = {} as const;

const InputSchema = z.object(listCitiesInputShape);
export type ListCitiesInput = z.infer<typeof InputSchema>;

export function makeListCitiesHandler(client: MuoviApiClient) {
  return async (args: ListCitiesInput): Promise<McpToolResult> => {
    try {
      const data = await client.get<CatalogResponse<CityRef>>('/cities');
      return wrapToolResult(data, { source: LIST_CITIES_NAME, args });
    } catch (err) {
      return wrapToolError(err, LIST_CITIES_NAME, args);
    }
  };
}
