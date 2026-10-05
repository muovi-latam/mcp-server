/**
 * Tool: muovi_get_professional
 * Wraps: GET /v1/professionals/{id}
 * Spec:  public/openapi.yaml -> operationId: getProfessional
 *
 * Mirrors `supabase/functions/mcp-server/_tools/getProfessional.ts`.
 *
 * WEB-1039: takes the `id` the search returns for every professional; a
 * ProSite slug from an older link is accepted in the same argument.
 */
import { z } from 'zod';
import type { MuoviApiClient } from '../api-client.js';
import type { DetailResponse, ProfessionalDetail } from '../types.js';
import { requireStringArg, wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const GET_PROFESSIONAL_NAME = 'muovi_get_professional';

export const GET_PROFESSIONAL_DESCRIPTION =
  "Fetch the full public profile of one Muovi professional by the `id` from `muovi_search_professionals`. Returns display name, headline, bio, portfolio image URLs, specialties, city and neighborhoods, services, ratings, verifications, and `profile_url`, the professional's public profile page on Muovi. Phone, email and WhatsApp are not returned. To start a task for this professional, use `muovi_create_task_link` or `muovi_create_task_draft` with this `id` as `professional_id`.";

/** Shared by the tools that take a professional: a profile id, or a legacy ProSite slug. */
export const PROFESSIONAL_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/i;

export const PROFESSIONAL_ID_HINT = 'Pass the `id` of a result from muovi_search_professionals.';

export const getProfessionalInputShape = {
  id: z
    .string()
    .min(1)
    .describe("The professional's `id` from `muovi_search_professionals`. A ProSite slug from an older link is also accepted."),
} as const;

const InputSchema = z.object(getProfessionalInputShape);
export type GetProfessionalInput = z.infer<typeof InputSchema>;

export function makeGetProfessionalHandler(client: MuoviApiClient) {
  return async (args: unknown): Promise<McpToolResult> => {
    try {
      const id = requireStringArg(args, 'id', {
        pattern: PROFESSIONAL_IDENTIFIER_PATTERN,
        hint: PROFESSIONAL_ID_HINT,
      });
      const data = await client.get<DetailResponse<ProfessionalDetail>>(
        `/professionals/${encodeURIComponent(id)}`,
      );
      return wrapToolResult(data, { source: GET_PROFESSIONAL_NAME, args });
    } catch (err) {
      return wrapToolError(err, GET_PROFESSIONAL_NAME, args);
    }
  };
}
