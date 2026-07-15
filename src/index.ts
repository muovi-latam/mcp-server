/**
 * Stdio entrypoint for `@muovi/mcp-server`.
 *
 * Invoked by Claude Desktop / Cursor / Claude Code via the `muovi-mcp-server`
 * bin shim (which exec's `dist/index.js`). Reads JSON-RPC from stdin,
 * writes responses to stdout. All log output MUST go to stderr to avoid
 * corrupting the JSON-RPC channel.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, PACKAGE_NAME, PACKAGE_VERSION, TOOL_NAMES } from './server.js';

export { buildServer, PACKAGE_NAME, PACKAGE_VERSION, TOOL_NAMES } from './server.js';
export {
  MuoviApiClient,
  MuoviApiError,
  RateLimitedError,
  DEFAULT_BASE_URL,
} from './api-client.js';
export { assertNoLeakage, findLeaks } from './anti-leakage.js';

export async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  // Write a startup line to stderr only — never to stdout (JSON-RPC channel).
  process.stderr.write(
    `${PACKAGE_NAME} v${PACKAGE_VERSION} ready on stdio (${TOOL_NAMES.length} tools).\n`,
  );
  await server.connect(transport);
}

// Detect direct execution (not when imported as a module).
const invokedDirectly = (() => {
  try {
    if (typeof process === 'undefined') return false;
    const arg1 = process.argv?.[1];
    if (!arg1) return false;
    // Compare resolved path of the entry script to this file's URL.
    return import.meta.url.endsWith(arg1.replace(/\\/g, '/').split('/').pop() ?? '__never__');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`[muovi-mcp-server] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
