/**
 * Tool: muovi_get_reviews
 * Wraps: GET /v1/professionals/{slug}/reviews
 * Spec:  public/openapi.yaml -> operationId: listProfessionalReviews
 */
import { z } from 'zod';
import type { MuoviApiClient } from '../api-client.js';
import type { ListResponse, Review } from '../types.js';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const GET_REVIEWS_NAME = 'muovi_get_reviews';

export const GET_REVIEWS_DESCRIPTION =
  'Fetch paginated reviews for a single Muovi-verified professional, sorted most-recent first. Each review has a 1-5 rating, an optional title and free-text comment, the author\'s reduced display name (e.g. "María G." — full surnames are never returned), the author role (`client` or `worker`), the service category the review is associated with, and an ISO `created_at` timestamp. Use this to surface social-proof when recommending a professional.';

/**
 * Input shape mirrors the parameters on `listProfessionalReviews`:
 * a required path `slug`, optional `limit` (1-50, default 20) and
 * optional `offset` (min 0, default 0).
 */
export const getReviewsInputShape = {
  slug: z
    .string()
    .min(1)
    .describe('The professional\'s URL-safe slug. Obtain from `muovi_search_professionals` or `muovi_get_professional`.'),
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
  return async (args: GetReviewsInput): Promise<McpToolResult> => {
    try {
      const { slug, ...query } = args;
      const data = await client.get<ListResponse<Review>>(
        `/professionals/${encodeURIComponent(slug)}/reviews`,
        query,
      );
      return wrapToolResult(data, { source: GET_REVIEWS_NAME, args });
    } catch (err) {
      return wrapToolError(err, GET_REVIEWS_NAME, args);
    }
  };
}
