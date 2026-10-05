/**
 * Tool: muovi_get_reviews
 * Wraps: GET /v1/professionals/{id}/reviews
 * Spec:  public/openapi.yaml -> operationId: listProfessionalReviews
 *
 * Mirrors `supabase/functions/mcp-server/_tools/getReviews.ts`.
 *
 * WEB-1039: takes the `id` the search returns; a legacy ProSite slug is
 * accepted in the same argument.
 */
import { z } from 'zod';
import type { MuoviApiClient } from '../api-client.js';
import type { ListResponse, Review } from '../types.js';
import { requireStringArg, toolArgs, wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';
import { PROFESSIONAL_ID_HINT, PROFESSIONAL_IDENTIFIER_PATTERN } from './getProfessional.js';

export const GET_REVIEWS_NAME = 'muovi_get_reviews';

export const GET_REVIEWS_DESCRIPTION =
  'Fetch paginated reviews for one Muovi professional by the `id` from `muovi_search_professionals`, sorted most-recent first. Each review has a 1-5 rating, an optional title and free-text comment, the author\'s reduced display name (e.g. "María G." — full surnames are not returned), the author role (`client` or `worker`), the service category the review is associated with, and an ISO `created_at` timestamp. Use this to surface social proof when recommending a professional.';

/**
 * Input shape mirrors the parameters on `listProfessionalReviews`:
 * a required path `id`, optional `limit` (1-50, default 20) and
 * optional `offset` (min 0, default 0).
 */
export const getReviewsInputShape = {
  id: z
    .string()
    .min(1)
    .describe("The professional's `id` from `muovi_search_professionals`. A ProSite slug from an older link is also accepted."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Maximum number of reviews per page (default 20, max 50).'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Zero-based offset into the review list for pagination.'),
} as const;

const InputSchema = z.object(getReviewsInputShape);
export type GetReviewsInput = z.infer<typeof InputSchema>;

export function makeGetReviewsHandler(client: MuoviApiClient) {
  return async (args: unknown): Promise<McpToolResult> => {
    try {
      const id = requireStringArg(args, 'id', {
        pattern: PROFESSIONAL_IDENTIFIER_PATTERN,
        hint: PROFESSIONAL_ID_HINT,
      });
      const { limit, offset } = toolArgs(args);
      const data = await client.get<ListResponse<Review>>(
        `/professionals/${encodeURIComponent(id)}/reviews`,
        { limit, offset },
      );
      return wrapToolResult(data, { source: GET_REVIEWS_NAME, args });
    } catch (err) {
      return wrapToolError(err, GET_REVIEWS_NAME, args);
    }
  };
}
