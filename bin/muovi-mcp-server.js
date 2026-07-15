#!/usr/bin/env node
// Bin shim for `@muovi/mcp-server`. Loads the compiled stdio entrypoint
// from `dist/` and runs `main()` so the process speaks JSON-RPC over
// stdin/stdout immediately.
//
// Invoked by `npx @muovi/mcp-server` and by Claude Desktop / Cursor
// command definitions.
import { main } from '../dist/index.js';

main().catch((err) => {
  process.stderr.write(
    `[muovi-mcp-server] fatal: ${err && err.stack ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
