/**
 * Tool: muovi_create_task_draft
 * Wraps: POST /v1/task-handovers
 * Spec:  public/openapi.yaml -> operationId: createTaskHandover
 *
 * This tool writes: it stores a draft and returns a link. Publishing
 * stays with the person who opens the link and signs in. The length and date
 * bounds are checked by the API rather than restated here, so the API's
 * `invalid_parameter` message is what the agent reads.
 */
import { z } from 'zod';
import { MuoviApiError, type MuoviApiClient } from '../api-client.js';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const CREATE_TASK_DRAFT_NAME = 'muovi_create_task_draft';

export const CREATE_TASK_DRAFT_DESCRIPTION =
  'Save a task draft on Muovi for the person you are helping, and get back a link for them. The person opens the link, signs in to Muovi, reviews the draft and publishes it themselves. This tool publishes nothing and does not notify any professional. Pass `professional_slug` (from `muovi_search_professionals`) to direct the draft to one professional: when the person publishes it, the task may be held for that professional for 24 hours if they are still available on Muovi. Leave it out for a general request. `service_slug` comes from `muovi_list_services`. A link nobody has signed in with expires 24 hours after it is created. The first Muovi account that signs in with it takes the draft and can reopen the link for up to 7 days, so give it only to that person. Do not include phone numbers, email addresses or other contact details in the text.';

export const PREFERRED_TIME_VALUES = ['flexible', 'this_week', 'next_week', 'specific_date'] as const;

export const createTaskDraftInputShape = {
  service_slug: z
    .string()
    .min(1)
    .describe('The service slug (from `muovi_list_services`), e.g. "electricidad".'),
  professional_slug: z
    .string()
    .optional()
    .describe('Optional. A professional slug (from `muovi_search_professionals`) to direct the draft to. Omit for a general request.'),
  description: z
    .string()
    .min(1)
    .describe('What the person needs done, in their words: 20 to 2000 characters.'),
  zone_text: z
    .string()
    .optional()
    .describe('Optional. Where the job is, as free text (neighborhood or area), up to 120 characters.'),
  preferred_time: z
    .enum(PREFERRED_TIME_VALUES)
    .optional()
    .describe('Optional. When the person wants it done. Use "specific_date" together with `preferred_date`.'),
  preferred_date: z
    .string()
    .optional()
    .describe('Required with preferred_time "specific_date", otherwise omitted. YYYY-MM-DD, from today up to 90 days ahead (Argentina time).'),
} as const;

const InputSchema = z.object(createTaskDraftInputShape);
export type CreateTaskDraftInput = z.infer<typeof InputSchema>;

export interface CreateTaskDraftResult {
  url: string;
  expires_at: string;
  note: string;
}

export const CREATE_TASK_DRAFT_NOTE =
  'Give this link to the person. They sign in to Muovi, review the draft and publish it; nothing is published until they do. If nobody signs in with the link, it stops working at expires_at.';

export const TASK_DRAFTS_NOT_AVAILABLE_MESSAGE =
  'Creating task drafts on Muovi is not available right now.';

/**
 * Reads the 201 body. `expires_at` is re-serialised at millisecond precision:
 * a microsecond timestamp carries a run of eight digits and a dot, which the
 * anti-leakage phone heuristic reads as a phone number.
 */
export function toCreateTaskDraftResult(body: unknown): CreateTaskDraftResult {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const expires = typeof record.expires_at === 'string' ? new Date(record.expires_at) : null;
  if (typeof record.url !== 'string' || expires === null || Number.isNaN(expires.getTime())) {
    throw new Error('Muovi API returned a task-draft response without a url and expires_at.');
  }
  return { url: record.url, expires_at: expires.toISOString(), note: CREATE_TASK_DRAFT_NOTE };
}

export function makeCreateTaskDraftHandler(client: MuoviApiClient) {
  return async (args: CreateTaskDraftInput): Promise<McpToolResult> => {
    try {
      const body = await client.post<unknown>('/task-handovers', args);
      return wrapToolResult(toCreateTaskDraftResult(body), { source: CREATE_TASK_DRAFT_NAME, args });
    } catch (err) {
      // The endpoint answers 404 while handovers are switched off.
      const reported =
        err instanceof MuoviApiError && err.status === 404 ? new Error(TASK_DRAFTS_NOT_AVAILABLE_MESSAGE) : err;
      return wrapToolError(reported, CREATE_TASK_DRAFT_NAME, args);
    }
  };
}
