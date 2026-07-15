/**
 * Tool: muovi_search_professionals
 * Wraps: GET /v1/professionals
 * Spec:  public/openapi.yaml -> operationId: searchProfessionals
 */
import { z } from 'zod';
import type { MuoviApiClient } from '../api-client.js';
import type { ListResponse, Professional } from '../types.js';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const SEARCH_PROFESSIONALS_NAME = 'muovi_search_professionals';

export const SEARCH_PROFESSIONALS_DESCRIPTION =
  'Search for verified service professionals in Argentina by service type, city, neighborhood, verification status, minimum rating, and minimum review count. Returns a paginated list of professionals with display name, headline, ratings, verifications, and a `profile_url` that is the only sanctioned contact channel (no phone/email/whatsapp is ever returned). Use this for discovery; use `muovi_get_professional` for the full detail payload.';

/**
 * Input shape mirrors the `parameters` block of `searchProfessionals` in
 * the OpenAPI spec — see `__tests__/openapi-drift.test.ts` which asserts
 * the two stay in lockstep.
 */
export const searchProfessionalsInputShape = {
  service: z
    .string()
    .min(1)
    .optional()
    .describe('Service slug (e.g. "electricidad"). Matches `Service.slug` in the catalog.'),
  city: z
    .string()
    .min(1)
    .optional()
    .describe('City slug (e.g. "caba"). Matches `City.slug` in the catalog.'),
  neighborhood: z
    .string()
    .min(1)
    .optional()
    .describe('Neighborhood slug (e.g. "palermo"). Matches `Neighborhood.slug` in the catalog.'),
  verified_identity: z
    .boolean()
    .optional()
    .describe('When true, only return pros whose identity has been verified by Muovi.'),
  has_matricula: z
    .boolean()
    .optional()
    .describe('When true, only return pros with a verified professional matrícula on file (electricians, gas fitters, etc.).'),
  min_rating: z
    .number()
    .min(0)
    .max(5)
    .optional()
    .describe('Minimum blended average rating, 0-5 inclusive.'),
  min_reviews: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Minimum blended review count.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Maximum number of results per page (default 20, max 50).'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Zero-based offset into the result set for pagination.'),
} as const;

const InputSchema = z.object(searchProfessionalsInputShape);
export type SearchProfessionalsInput = z.infer<typeof InputSchema>;

export function makeSearchProfessionalsHandler(client: MuoviApiClient) {
  return async (args: SearchProfessionalsInput): Promise<McpToolResult> => {
    try {
      const data = await client.get<ListResponse<Professional>>(
        '/professionals',
        args,
      );
      return wrapToolResult(data, {
        source: SEARCH_PROFESSIONALS_NAME,
        args,
      });
    } catch (err) {
      return wrapToolError(err, SEARCH_PROFESSIONALS_NAME, args);
    }
  };
}
