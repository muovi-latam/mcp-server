/**
 * Tool: muovi_list_services
 * Wraps: GET /v1/services
 * Spec:  public/openapi.yaml -> operationId: listServices
 */
import { z } from 'zod';
import type { MuoviApiClient } from '../api-client.js';
import type { CatalogResponse, ServiceRef } from '../types.js';
import { wrapToolError, wrapToolResult, type McpToolResult } from './_helpers.js';

export const LIST_SERVICES_NAME = 'muovi_list_services';

export const LIST_SERVICES_DESCRIPTION =
  'List every service category Muovi supports in Argentina (electricidad, plomería, pintura, etc.). Each entry has a stable `slug` (used as the `service` parameter on `muovi_search_professionals` and `muovi_create_task_link`), a human-readable `name`, an optional description, and a `requires_matricula` flag indicating whether listed professionals must hold a verified professional license. Call this first when you need to map a user\'s natural-language request to a Muovi service slug.';

/** This operation takes no parameters per the OpenAPI spec. */
export const listServicesInputShape = {} as const;

const InputSchema = z.object(listServicesInputShape);
export type ListServicesInput = z.infer<typeof InputSchema>;

export function makeListServicesHandler(client: MuoviApiClient) {
  return async (args: ListServicesInput): Promise<McpToolResult> => {
    try {
      const data = await client.get<CatalogResponse<ServiceRef>>('/services');
      return wrapToolResult(data, { source: LIST_SERVICES_NAME, args });
    } catch (err) {
      return wrapToolError(err, LIST_SERVICES_NAME, args);
    }
  };
}
