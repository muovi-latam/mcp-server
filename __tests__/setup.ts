/**
 * Vitest setup for the @muovi/mcp-server tests.
 *
 * MOB-147: disable client telemetry by default so existing tool tests
 * (which spy on `globalThis.fetch`) aren't fooled by the
 * fire-and-forget telemetry POST. Individual telemetry tests override
 * this via `delete process.env.MUOVI_DISABLE_TELEMETRY` in their
 * `beforeEach`.
 */
process.env.MUOVI_DISABLE_TELEMETRY = '1';
