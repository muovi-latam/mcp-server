/**
 * The package identity, in a module of its own so `api-client.ts` can read the
 * version for its User-Agent without importing `server.ts`, which imports it.
 */

export const PACKAGE_NAME = '@muovi/mcp-server';
export const PACKAGE_VERSION = '0.4.1';
