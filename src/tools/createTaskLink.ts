/**
 * Tool: muovi_create_task_link
 *
 * PURE STRING FORMATTER. Does NOT make any HTTP call. Does NOT write any
 * state on Muovi. Returns the canonical deep-link the LLM agent should
 * send the user to in order to start an on-platform task for a specific
 * pro and service.
 *
 * The link format is the documented deep-link contract from
 * `public/openapi.yaml` (`info.description` → "Deep-link contract"):
 *
 *   https://muovi.com.ar/p/{slug}?create_task=1&service={service-slug}
 *
 * MCP must never bypass platform UX (per MOB-141 acceptance criteria) —
 * actual task creation happens in Muovi's on-platform flow after the user
 * follows this link.
 */
import { z } from 'zod';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const CREATE_TASK_LINK_NAME = 'muovi_create_task_link';

export const CREATE_TASK_LINK_DESCRIPTION =
  'Build the canonical Muovi deep-link that opens the on-platform task creation flow pre-filled with a specific professional and service. Returns a URL of the form `https://muovi.com.ar/p/{slug}?create_task=1&service={service-slug}`. This is a pure formatter — it makes no network call and creates no task. After running it, surface the URL to the user so they can complete the booking on Muovi. Muovi never lets agents create tasks server-side; the consumer always sees the on-platform flow to confirm details.';

const DEFAULT_BASE_URL = 'https://muovi.com.ar';

/** Strict slug validator: lowercase letters, digits, hyphens, dot. */
const SLUG_REGEX = /^[a-z0-9][a-z0-9.\-]*$/;

export const createTaskLinkInputShape = {
  professional_slug: z
    .string()
    .min(1)
    .regex(SLUG_REGEX, 'professional_slug must be a lowercase URL-safe slug.')
    .describe('The professional\'s URL-safe slug (from `muovi_search_professionals` or `muovi_get_professional`).'),
  service_slug: z
    .string()
    .min(1)
    .regex(SLUG_REGEX, 'service_slug must be a lowercase URL-safe slug.')
    .describe('The service slug to pre-fill in the task flow (from `muovi_list_services`).'),
} as const;

const InputSchema = z.object(createTaskLinkInputShape);
export type CreateTaskLinkInput = z.infer<typeof InputSchema>;

export interface CreateTaskLinkResult {
  url: string;
  professional_slug: string;
  service_slug: string;
  note: string;
}

/**
 * Pure string interpolation. Exported separately so unit tests can call
 * it without instantiating the full MCP server.
 */
export function buildTaskLink(
  professional_slug: string,
  service_slug: string,
  baseUrl: string = DEFAULT_BASE_URL,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/p/${encodeURIComponent(professional_slug)}?create_task=1&service=${encodeURIComponent(service_slug)}`;
}

export function makeCreateTaskLinkHandler(opts: { baseUrl?: string } = {}) {
  const baseUrl = opts.baseUrl ?? process.env.MUOVI_WEB_BASE_URL ?? DEFAULT_BASE_URL;
  return async (args: CreateTaskLinkInput): Promise<McpToolResult> => {
    try {
      const url = buildTaskLink(args.professional_slug, args.service_slug, baseUrl);
      const payload: CreateTaskLinkResult = {
        url,
        professional_slug: args.professional_slug,
        service_slug: args.service_slug,
        note: 'This is a deep-link to the on-platform task creation flow. Following it does not create a task; the user completes the flow on Muovi.',
      };
      return wrapToolResult(payload, { source: CREATE_TASK_LINK_NAME, args });
    } catch (err) {
      return wrapToolError(err, CREATE_TASK_LINK_NAME, args);
    }
  };
}
