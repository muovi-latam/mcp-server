/**
 * Tool: muovi_get_service_requirements
 * Wraps: GET /v1/services/{service_slug}/requirements
 * Spec:  public/openapi.yaml -> operationId: getServiceRequirements
 *
 * WEB-1005. Read-only: the questions Muovi asks for one service, so an agent
 * can ask the person before calling `muovi_create_task_draft`.
 */
import { z } from 'zod';
import { MuoviApiError, type MuoviApiClient } from '../api-client.js';
import { TASK_DRAFTS_NOT_AVAILABLE_MESSAGE } from './createTaskDraft.js';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const GET_SERVICE_REQUIREMENTS_NAME = 'muovi_get_service_requirements';

export const GET_SERVICE_REQUIREMENTS_DESCRIPTION =
  'List the questions Muovi asks for one service, so you can ask the person before calling `muovi_create_task_draft`. Pass a `service_slug` from `muovi_list_services`. Each slot has a `key`, the question in Spanish (`question_es`), a `type`, the accepted `options` for a choice, a `value_format` saying what to send, whether it is `required`, and an `ask_if` condition when it only applies after another answer. Send the answers back keyed by slot `key` in the `slots` argument of `muovi_create_task_draft`. `photo_policy` says whether photos help; photos are added by the person on Muovi, not through this server. Read-only.';

export const getServiceRequirementsInputShape = {
  service_slug: z
    .string()
    .min(1)
    .describe('The service slug (from `muovi_list_services`), e.g. "plomeria".'),
} as const;

const InputSchema = z.object(getServiceRequirementsInputShape);
export type GetServiceRequirementsInput = z.infer<typeof InputSchema>;

export function makeGetServiceRequirementsHandler(client: MuoviApiClient) {
  return async (args: GetServiceRequirementsInput): Promise<McpToolResult> => {
    try {
      const data = await client.get<unknown>(
        `/services/${encodeURIComponent(args.service_slug)}/requirements`,
      );
      return wrapToolResult(data, { source: GET_SERVICE_REQUIREMENTS_NAME, args });
    } catch (err) {
      // The endpoint answers 404 for a slug it does not list and while
      // handovers are switched off; the API's own message tells them apart.
      const reported =
        err instanceof MuoviApiError && err.status === 404 && err.message === 'Not found'
          ? new Error(TASK_DRAFTS_NOT_AVAILABLE_MESSAGE)
          : err;
      return wrapToolError(reported, GET_SERVICE_REQUIREMENTS_NAME, args);
    }
  };
}
