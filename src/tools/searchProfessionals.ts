/**
 * Tool: muovi_search_professionals
 * Wraps: GET /v1/professionals
 * Spec:  public/openapi.yaml -> operationId: searchProfessionals
 *
 * Mirrors `supabase/functions/mcp-server/_tools/searchProfessionals.ts`.
 *
 * WEB-1039: a search names a service and a barrio and answers at most five
 * professionals. A call missing either answers a tool error before any HTTP
 * request, telling the assistant to ask the person.
 * WEB-1058: the description's order sentence follows the leading keys of
 * `public.v1_professionals_search`'s ORDER BY (off-trade, trade match,
 * review score with the validation bonus).
 */
import { z } from 'zod';
import type { MuoviApiClient } from '../api-client.js';
import type { SearchResponse } from '../types.js';
import {
  optionalBooleanArg,
  requireStringArg,
  ToolArgumentError,
  toolArgs,
  wrapToolError,
  wrapToolResult,
  type McpToolResult,
} from './_helpers.js';

export const SEARCH_PROFESSIONALS_NAME = 'muovi_search_professionals';

export const SEARCH_PROFESSIONALS_DESCRIPTION =
  "Find up to 5 Muovi professionals for one service in one barrio. Both `service` (a slug from `muovi_list_services`) and `neighborhood` (a barrio slug from `muovi_list_cities`) are required: if the person has not said which service they need and in which barrio, ask them before searching. Every professional returned has a coverage area that includes the searched barrio, and `match` in the response names the service, barrio and city searched: present the results as professionals who work in that barrio. Results list professionals who declare the searched trade first, ordered by review score, with verified identity, background check and matrícula counting toward it; professionals whose registered business is in another trade come last. Each result has one `rating` and one `review_count`, and `verifications`: for each professional, say whether identity, matrícula, background check (antecedentes) and phone are verified. Each result also has up to 3 `portfolio` image URLs, an `id` and a `profile_url`, the professional's public profile page on Muovi; no phone, email or WhatsApp is returned. After showing the results, offer the person two choices: a task for one professional (`muovi_create_task_link`, or `muovi_create_task_draft` with `professional_id`, passing that result's `id`), or a general request to get offers from several professionals (`muovi_create_task_draft` without a professional). Use `muovi_get_professional` with the `id` for the full profile.";

export const SEARCH_MISSING_ARGUMENTS_MESSAGE =
  'A search needs both a service and a barrio. Ask the person which service they need and in which barrio, then call muovi_search_professionals again with `service` (from muovi_list_services) and `neighborhood` (from muovi_list_cities).';

/**
 * Input shape mirrors the `parameters` block of `searchProfessionals` in
 * the OpenAPI spec; `__tests__/openapi-drift.test.ts` compares the two.
 */
export const searchProfessionalsInputShape = {
  service: z
    .string()
    .min(1)
    .describe('Required. Service slug (e.g. "plomeria"), from `muovi_list_services`.'),
  neighborhood: z
    .string()
    .min(1)
    .describe('Required. Barrio slug (e.g. "palermo"), from `muovi_list_cities`.'),
  city: z
    .string()
    .min(1)
    .optional()
    .describe('Optional. City slug (e.g. "caba"), needed only when a barrio slug exists in more than one city.'),
  verified_identity: z
    .boolean()
    .optional()
    .describe('When true, only return professionals whose identity Muovi has verified.'),
  has_matricula: z
    .boolean()
    .optional()
    .describe('When true, only return professionals with a verified matrícula on file (electricians, gas fitters, etc.).'),
} as const;

const InputSchema = z.object(searchProfessionalsInputShape);
export type SearchProfessionalsInput = z.infer<typeof InputSchema>;

/** The query the tool sends, or a {@link ToolArgumentError} for missing arguments. */
export function searchProfessionalsQuery(args: unknown): Record<string, unknown> {
  let service: string;
  let neighborhood: string;
  try {
    service = requireStringArg(args, 'service');
    neighborhood = requireStringArg(args, 'neighborhood');
  } catch {
    throw new ToolArgumentError(SEARCH_MISSING_ARGUMENTS_MESSAGE);
  }
  const query: Record<string, unknown> = { service, neighborhood };
  const raw = toolArgs(args);
  if (typeof raw.city === 'string' && raw.city.trim() !== '') query.city = raw.city.trim();
  const verifiedIdentity = optionalBooleanArg(args, 'verified_identity');
  if (verifiedIdentity !== undefined) query.verified_identity = verifiedIdentity;
  const hasMatricula = optionalBooleanArg(args, 'has_matricula');
  if (hasMatricula !== undefined) query.has_matricula = hasMatricula;
  return query;
}

export function makeSearchProfessionalsHandler(client: MuoviApiClient) {
  return async (args: unknown = {}): Promise<McpToolResult> => {
    try {
      const data = await client.get<SearchResponse>(
        '/professionals',
        searchProfessionalsQuery(args),
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
