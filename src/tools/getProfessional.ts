/**
 * Tool: muovi_get_professional
 * Wraps: GET /v1/professionals/{slug}
 * Spec:  public/openapi.yaml -> operationId: getProfessional
 */
import { z } from 'zod';
import type { MuoviApiClient } from '../api-client.js';
import type { DetailResponse, ProfessionalDetail } from '../types.js';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const GET_PROFESSIONAL_NAME = 'muovi_get_professional';

export const GET_PROFESSIONAL_DESCRIPTION =
  'Fetch the full public profile for a single Muovi-verified professional by slug. Returns display name, headline, bio, portfolio image URLs, specialties, city + neighborhoods, services, ratings, verifications, and the canonical `profile_url`. The `profile_url` is the only sanctioned contact channel — phone, email, and whatsapp are never returned. Append `?create_task=1&service={slug}` to `profile_url` (or use `muovi_create_task_link`) to deep-link a user into the on-platform task creation flow targeted at this pro.';

export const getProfessionalInputShape = {
  slug: z
    .string()
    .min(1)
    .describe('The professional\'s URL-safe slug (e.g. "juan-p-electricista-caba"). Obtain from `muovi_search_professionals`.'),
} as const;

const InputSchema = z.object(getProfessionalInputShape);
export type GetProfessionalInput = z.infer<typeof InputSchema>;

export function makeGetProfessionalHandler(client: MuoviApiClient) {
  return async (args: GetProfessionalInput): Promise<McpToolResult> => {
    try {
      const data = await client.get<DetailResponse<ProfessionalDetail>>(
        `/professionals/${encodeURIComponent(args.slug)}`,
      );
      return wrapToolResult(data, { source: GET_PROFESSIONAL_NAME, args });
    } catch (err) {
      return wrapToolError(err, GET_PROFESSIONAL_NAME, args);
    }
  };
}
