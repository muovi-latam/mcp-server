/**
 * Shared helpers for MCP tool handlers.
 *
 * - `wrapToolResult` runs every payload through the anti-leakage detector
 *   (defense-in-depth: the /v1 API already strips contact data, but we
 *   check at the agent boundary too) and serialises it to the MCP
 *   `content[]` shape.
 * - `formatErrorMessage` produces a stable, agent-friendly error string for
 *   `MuoviApiError` / `RateLimitedError`.
 *
 * MOB-147: every wrap call (result + error) also fires a fire-and-forget
 * telemetry write. The npm-side caller is the agent's machine — it can't
 * write to our Postgres directly, so the logger POSTs to the public
 * `mcp-telemetry-api` Edge Function. The hosted MCP transport (MOB-142)
 * writes to the same table directly from inside the Edge Function tree.
 * See `logMcpCallFromClient` below.
 */

import { assertNoLeakage } from '../anti-leakage.js';
import { MuoviApiError, RateLimitedError } from '../api-client.js';
import { logMcpCallFromClient } from '../telemetry.js';

export interface McpTextContent {
  type: 'text';
  text: string;
}

/**
 * Shape compatible with the MCP SDK's `CallToolResult`. We expose an
 * index signature so structural assignability holds across SDK versions.
 */
export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Wraps a successful tool payload:
 *  1. Runs anti-leakage detection — throws if any leak is found.
 *  2. Serialises to JSON for the LLM client.
 *  3. Returns the MCP CallToolResult shape.
 *
 * MOB-147: also emits a 'ok' telemetry row. `args` is optional — when
 * provided it's hashed (sha256 of canonical JSON) before transport.
 * The raw args NEVER leave the local process.
 *
 * TODO(MOB-142): the hosted MCP function in `supabase/functions/
 * mcp-server/` should call the server-side `logMcpToolCall` at the
 * equivalent boundary after merge. The two sinks share the same
 * `analytics_mcp_calls` table.
 */
export function wrapToolResult(
  payload: unknown,
  opts: { source: string; args?: unknown },
): McpToolResult {
  try {
    assertNoLeakage(payload, { source: opts.source });
  } catch (err) {
    // Leakage-blocked counts as its own telemetry status so the
    // dashboard can surface "MCP almost leaked X" without surfacing
    // the actual payload.
    void logMcpCallFromClient({
      toolName: opts.source,
      args: opts.args,
      status: 'leakage_blocked',
      errorClass: 'LeakageDetected',
    });
    throw err;
  }
  void logMcpCallFromClient({
    toolName: opts.source,
    args: opts.args,
    status: 'ok',
  });
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent:
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : { data: payload },
  };
}

/** Render an error into an MCP CallToolResult with `isError: true`. */
export function wrapToolError(
  err: unknown,
  source: string,
  args?: unknown,
): McpToolResult {
  // MOB-147: classify the error into a closed bucket and log. Never
  // logs the error message — that frequently contains user input.
  const status =
    err instanceof RateLimitedError ? 'rate_limited' : 'error';
  const errorClass =
    err instanceof RateLimitedError
      ? 'RateLimitedError'
      : err instanceof MuoviApiError
      ? 'MuoviApiError'
      : err instanceof Error
      ? err.name || 'Error'
      : 'Unknown';
  void logMcpCallFromClient({
    toolName: source,
    args,
    status,
    errorClass,
  });
  return {
    content: [
      {
        type: 'text',
        text: formatErrorMessage(err, source),
      },
    ],
    isError: true,
  };
}

export function formatErrorMessage(err: unknown, source: string): string {
  if (err instanceof RateLimitedError) {
    const retry =
      err.retryAfterSeconds !== null
        ? ` Retry after ${err.retryAfterSeconds} second(s).`
        : '';
    return `Muovi API rate-limited (${source}). ${err.message}${retry}`;
  }
  if (err instanceof MuoviApiError) {
    return `Muovi API error (${source}, status ${err.status}, code ${err.code}): ${err.message}`;
  }
  if (err instanceof Error) {
    return `Muovi MCP tool error (${source}): ${err.message}`;
  }
  return `Muovi MCP tool error (${source}): ${String(err)}`;
}
