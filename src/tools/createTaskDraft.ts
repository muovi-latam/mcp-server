/**
 * Tool: muovi_create_task_draft
 * Wraps: POST /v1/task-handovers
 * Spec:  public/openapi.yaml -> operationId: createTaskHandover
 *
 * This tool writes: it stores a draft and returns a link. Publishing
 * stays with the person who opens the link, reviews the draft and signs in. The length and date
 * bounds are checked by the API rather than restated here, so the API's
 * `invalid_parameter` message is what the agent reads.
 *
 * WEB-1039: `professional_id` (the search's `id`) directs the draft to any
 * listed professional, and `open_to_others` carries the person's choice.
 */
import { z } from 'zod';
import { MuoviApiError, type MuoviApiClient } from '../api-client.js';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const CREATE_TASK_DRAFT_NAME = 'muovi_create_task_draft';

export const CREATE_TASK_DRAFT_DESCRIPTION =
  'Save a task draft on Muovi for the person you are helping, and get back a link for them. The person opens the link, reviews the draft, signs in to Muovi and publishes it themselves. This tool publishes nothing and does not notify any professional. To hand over the full request, call `muovi_get_service_requirements` for the service first, ask the person every required question, and send the answers in `slots` (keyed by slot key) with `location`. If a required answer is missing, the result has `status: "incomplete"`, lists the questions still to ask and carries no link: ask them and call again with every slot. If a value is not accepted, the result has `status: "invalid_slots"` and names each slot. A draft with every required answer opens on a review form with those answers filled in, without asking them again unless Muovi\'s own check of the request raises a question, and the person confirms the address on a map before publishing. Sending only `description` still saves a draft, and that link opens Muovi\'s assistant, which asks the person its questions. To direct the draft to one professional, pass `professional_id`, the `id` of any result from `muovi_search_professionals`: when the person publishes it, the task goes to that professional first for 24 hours and then opens to everyone, unless `open_to_others` is true, in which case it opens to everyone right away and that professional is still told. Set `open_to_others` from what the person chose; they can change it on the review form. A ProSite slug in `professional_slug` is still accepted instead of `professional_id`. Leave both out for a general request to get offers from several professionals. `service_slug` comes from `muovi_list_services`. A link nobody has opened expires 24 hours after it is created. The first person to open it takes the draft, signed in or not, and can reopen the link for up to 7 days, so give it only to that person. Do not include phone numbers, email addresses or other contact details in any text.';

export const PREFERRED_TIME_VALUES = ['flexible', 'this_week', 'next_week', 'specific_date'] as const;

/** WEB-1005 — the parts of a day `time_preferences` takes. */
export const TIME_PREFERENCE_VALUES = ['morning', 'midday', 'afternoon', 'evening'] as const;

export const createTaskDraftInputShape = {
  service_slug: z
    .string()
    .min(1)
    .describe('The service slug (from `muovi_list_services`), e.g. "electricidad".'),
  professional_id: z
    .string()
    .optional()
    .describe('Optional. The `id` of a professional from `muovi_search_professionals` to direct the draft to. Omit for a general request.'),
  open_to_others: z
    .boolean()
    .optional()
    .describe('Optional, with professional_id. True when the person also wants offers from other professionals right away; false or omitted gives the chosen professional the first 24 hours.'),
  professional_slug: z
    .string()
    .optional()
    .describe('Optional. A ProSite slug from an older link, instead of professional_id.'),
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
  slots: z
    .record(z.unknown())
    .optional()
    .describe("Optional. The person's answers, keyed by slot key from `muovi_get_service_requirements`. Send each value in the slot's `value_format`."),
  location: z
    .object({
      neighborhood_slug: z.string().optional().describe('A neighborhood slug from `muovi_list_cities`.'),
      city_slug: z.string().optional().describe('Optional, with neighborhood_slug. A city slug from `muovi_list_cities`.'),
      address: z.string().optional().describe('A street address as text, 3 to 200 characters.'),
    })
    .optional()
    .describe('Optional. Where the job is: `neighborhood_slug`, `address`, or both. The address is saved as text; the person confirms the place on the map on Muovi.'),
  title: z
    .string()
    .optional()
    .describe('Optional. A short title for the task, 5 to 80 characters. Left out, Muovi takes it from the description.'),
  budget_amount: z
    .number()
    .optional()
    .describe("Optional. The person's budget in ARS, as a positive number."),
  time_preferences: z
    .array(z.enum(TIME_PREFERENCE_VALUES))
    .optional()
    .describe('Optional. The parts of the day that suit the person.'),
} as const;

const InputSchema = z.object(createTaskDraftInputShape);
export type CreateTaskDraftInput = z.infer<typeof InputSchema>;

export interface CreateTaskDraftResult {
  url: string;
  expires_at: string;
  note: string;
  /** WEB-1005 — present for a complete intake only. */
  address_pending?: boolean;
}

export const CREATE_TASK_DRAFT_NOTE =
  'Give this link to the person. They review the draft, sign in to Muovi and publish it; nothing is published until they do. If nobody opens the link, it stops working at expires_at.';

/** WEB-1005 — added to the note when the place has no map point yet. */
export const CREATE_TASK_DRAFT_ADDRESS_PENDING_NOTE =
  'The place was saved as text only, so Muovi will ask the person to pick it on the map.';

export const CREATE_TASK_DRAFT_INCOMPLETE_NOTE =
  'No draft was saved and there is no link. Ask the person these questions, then call muovi_create_task_draft again with every slot.';

export const CREATE_TASK_DRAFT_INVALID_SLOTS_NOTE =
  'No draft was saved and there is no link. Correct these slots and call muovi_create_task_draft again.';

/** The `422` codes `POST /task-handovers` answers a complete-intake body with. */
export const INCOMPLETE_INTAKE_CODE = 'incomplete_intake';
export const INVALID_SLOTS_CODE = 'invalid_slots';

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
  const pending = typeof record.address_pending === 'boolean' ? record.address_pending : undefined;
  return {
    url: record.url,
    expires_at: expires.toISOString(),
    note:
      pending === true
        ? `${CREATE_TASK_DRAFT_NOTE} ${CREATE_TASK_DRAFT_ADDRESS_PENDING_NOTE}`
        : CREATE_TASK_DRAFT_NOTE,
    ...(pending === undefined ? {} : { address_pending: pending }),
  };
}

/**
 * WEB-1005 — the tool result for a `422`: the questions still to ask, or the
 * refused slots, with no link. `null` for any other error.
 */
export function unacceptedIntakeResult(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof MuoviApiError) || err.status !== 422) return null;
  const details = err.details ?? {};
  if (err.code === INCOMPLETE_INTAKE_CODE && Array.isArray(details.missing)) {
    return { status: 'incomplete', missing: details.missing, note: CREATE_TASK_DRAFT_INCOMPLETE_NOTE };
  }
  if (err.code === INVALID_SLOTS_CODE && Array.isArray(details.rejections)) {
    return { status: 'invalid_slots', rejections: details.rejections, note: CREATE_TASK_DRAFT_INVALID_SLOTS_NOTE };
  }
  return null;
}

export function makeCreateTaskDraftHandler(client: MuoviApiClient) {
  return async (args: CreateTaskDraftInput): Promise<McpToolResult> => {
    try {
      const body = await client.post<unknown>('/task-handovers', args);
      return wrapToolResult(toCreateTaskDraftResult(body), { source: CREATE_TASK_DRAFT_NAME, args });
    } catch (err) {
      const unaccepted = unacceptedIntakeResult(err);
      if (unaccepted !== null) {
        try {
          return wrapToolResult(unaccepted, { source: CREATE_TASK_DRAFT_NAME, args });
        } catch {
          // The anti-leakage check refused the reply (and logged it). Its error
          // message quotes what it found, so a fixed one is returned instead.
          return wrapToolError(
            new Error('Muovi API returned a task-draft reply that could not be shown.'),
            CREATE_TASK_DRAFT_NAME,
            args,
          );
        }
      }
      // The endpoint answers 404 while handovers are switched off.
      const reported =
        err instanceof MuoviApiError && err.status === 404 ? new Error(TASK_DRAFTS_NOT_AVAILABLE_MESSAGE) : err;
      return wrapToolError(reported, CREATE_TASK_DRAFT_NAME, args);
    }
  };
}
