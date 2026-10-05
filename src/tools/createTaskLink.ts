/**
 * Tool: muovi_create_task_link
 *
 * PURE STRING FORMATTER. Makes no HTTP call and writes no state on Muovi.
 * Mirrors `supabase/functions/mcp-server/_tools/createTaskLink.ts`.
 *
 * WEB-1039: the link opens Muovi's own task creation for one professional on
 * the configured web origin, the page the profile button opens. Every argument
 * is checked before a URL is built, so a missing one answers a tool error.
 *
 * This package ships without Muovi's spec catalogue, so `?vertical=` carries
 * the service slug as given; the page pins a slug that names a spec vertical
 * and opens its general assistant for any other.
 */
import { z } from 'zod';
import {
  requireStringArg,
  ToolArgumentError,
  wrapToolError,
  wrapToolResult,
  type McpToolResult,
} from './_helpers.js';

export const CREATE_TASK_LINK_NAME = 'muovi_create_task_link';

export const CREATE_TASK_LINK_DESCRIPTION =
  "Build a link that opens Muovi's own task creation for one professional and one service: pass the `id` of a result from `muovi_search_professionals` as `professional_id`, and a service slug from `muovi_list_services`. Any professional in the search results can be picked. When the person publishes the task, it goes to that professional first for 24 hours and then opens to everyone; on the form the person can choose to also receive offers from other professionals right away. The link opens Muovi's task form, not the professional's ProSite. This tool makes no network call and saves nothing: give the URL to the person, who completes the task on Muovi.";

export const CREATE_TASK_LINK_NOTE =
  "This link opens Muovi's task creation for this professional. Following it does not create a task; the person completes and publishes it on Muovi.";

export const DEFAULT_WEB_BASE_URL = 'https://muovi.com.ar';

/** Twins of `supabase/functions/_shared/directedTask/link.ts`, compared by a lockstep test. */
export const DIRECTED_TASK_PATH = '/post-task/v2';
export const DIRECTED_TASK_SOURCE = 'assistant-link';

/** The shape of a professional `id` (twin of `PROFILE_ID_REGEX`). */
export const PROFILE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Twin of `SERVICE_SLUG_PATTERN` in `_shared/taskHandover/input.ts`. */
export const SERVICE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const NOT_A_SERVICE_SLUG: ReadonlySet<string> = new Set(['undefined', 'null']);

export const createTaskLinkInputShape = {
  professional_id: z
    .string()
    .min(36)
    .max(36)
    .describe('The `id` of a professional from `muovi_search_professionals`.'),
  service_slug: z
    .string()
    .min(1)
    .regex(SERVICE_SLUG_PATTERN, 'service_slug must be a service slug from muovi_list_services.')
    .describe('The service slug to start the task with (from `muovi_list_services`).'),
} as const;

const InputSchema = z.object(createTaskLinkInputShape);
export type CreateTaskLinkInput = z.infer<typeof InputSchema>;

export interface CreateTaskLinkResult {
  url: string;
  professional_id: string;
  service_slug: string;
  note: string;
}

/**
 * The web origin links are built on: `MUOVI_WEB_BASE_URL` when it is an https
 * origin with no path, else {@link DEFAULT_WEB_BASE_URL}.
 */
export function webOriginFrom(configured: string | undefined): string {
  if (!configured) return DEFAULT_WEB_BASE_URL;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || (url.pathname !== '/' && url.pathname !== '')) {
      return DEFAULT_WEB_BASE_URL;
    }
    return url.origin;
  } catch {
    return DEFAULT_WEB_BASE_URL;
  }
}

/** The link for an already validated professional id and service slug. */
export function buildTaskLink(professionalId: string, serviceSlug: string, webOrigin: string = DEFAULT_WEB_BASE_URL): string {
  const query = new URLSearchParams();
  query.set('pro', professionalId.toLowerCase());
  query.set('vertical', serviceSlug);
  query.set('source', DIRECTED_TASK_SOURCE);
  return `${webOrigin.replace(/\/+$/, '')}${DIRECTED_TASK_PATH}?${query.toString()}`;
}

/** Validates the arguments and builds the link. Throws {@link ToolArgumentError}. */
export function buildTaskLinkFor(args: unknown, webOrigin: string): CreateTaskLinkResult {
  const hint = 'Pass the `id` of a result from muovi_search_professionals.';
  const professionalId = requireStringArg(args, 'professional_id', { hint });
  if (!PROFILE_ID_REGEX.test(professionalId)) {
    throw new ToolArgumentError(`professional_id is not valid. ${hint}`);
  }
  const serviceHint = 'Pass a service slug from muovi_list_services.';
  const serviceSlug = requireStringArg(args, 'service_slug', { pattern: SERVICE_SLUG_PATTERN, hint: serviceHint });
  // A serialised missing value is not a service; it would be written into the link as it is.
  if (NOT_A_SERVICE_SLUG.has(serviceSlug)) {
    throw new ToolArgumentError(`service_slug is not valid. ${serviceHint}`);
  }
  return {
    url: buildTaskLink(professionalId, serviceSlug, webOrigin),
    professional_id: professionalId.toLowerCase(),
    service_slug: serviceSlug,
    note: CREATE_TASK_LINK_NOTE,
  };
}

export function makeCreateTaskLinkHandler(opts: { baseUrl?: string } = {}) {
  const webOrigin = webOriginFrom(opts.baseUrl ?? process.env.MUOVI_WEB_BASE_URL);
  return async (args: unknown): Promise<McpToolResult> => {
    try {
      return wrapToolResult(buildTaskLinkFor(args, webOrigin), { source: CREATE_TASK_LINK_NAME, args });
    } catch (err) {
      return wrapToolError(err, CREATE_TASK_LINK_NAME, args);
    }
  };
}
