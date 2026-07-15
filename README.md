# @muovi/mcp-server

[![npm version](https://img.shields.io/npm/v/%40muovi%2Fmcp-server.svg)](https://www.npmjs.com/package/@muovi/mcp-server)

**Model Context Protocol (MCP) server for [Muovi](https://muovi.com.ar)** — Argentina's trust-first local services marketplace.

This package lets MCP-aware clients (Claude Desktop, Cursor, Claude Code, and any other MCP host) discover Muovi's verified Argentine service professionals, browse the service catalog and city list, read reviews, and deep-link a user into the on-platform task-creation flow. It is a thin, read-only wrapper over Muovi's public [`/v1` REST API](https://muovi.com.ar/openapi.yaml).

**Stdio mode.** The package ships an `npx`-runnable binary that speaks JSON-RPC over stdin/stdout. The hosted HTTP/SSE variant is tracked separately (Muovi MOB-142).

## What it exposes

Six tools, all read-only:

| Tool | Wraps | Purpose |
| --- | --- | --- |
| `muovi_search_professionals` | `GET /v1/professionals` | Search verified pros by service, city, neighborhood, verification status, min rating, min review count. |
| `muovi_get_professional` | `GET /v1/professionals/{slug}` | Fetch a single pro's full public profile (bio, portfolio, specialties, verifications). |
| `muovi_list_services` | `GET /v1/services` | The full live service catalog. |
| `muovi_list_cities` | `GET /v1/cities` | Every Argentine city Muovi serves, with neighborhoods. |
| `muovi_get_reviews` | `GET /v1/professionals/{slug}/reviews` | Paginated reviews for a pro, most-recent first. |
| `muovi_create_task_link` | (pure formatter) | Builds the canonical deep-link the user should follow to start a task with a specific pro for a specific service. Makes no HTTP call. |

## Anti-leakage policy

Muovi is on-platform-only. **Phone, email, and WhatsApp handles are never returned** by the public API — contact between consumers and professionals happens exclusively through Muovi's in-app conversation flow, reachable from each pro's `profile_url`.

This server enforces the policy twice:

1. The `/v1` API strips contact data server-side.
2. Every tool response in this package also runs through a local anti-leakage detector (a Node-compatible mirror of [`src/lib/anti-leakage/detector.ts`](https://github.com/muovi-ar/muovi-web/blob/main/src/lib/anti-leakage/detector.ts) in the Muovi web repo). If a leak is detected at the agent boundary the tool returns a stable error to the LLM client and refuses to surface the payload.

Hosts that integrate this server **must not** synthesise off-platform contact handles from any field. Driving the user to `profile_url` (optionally with the deep-link query string) is the only sanctioned contact channel.

## Installation & configuration

### Claude Desktop

Open `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and add the server under `mcpServers`:

```json
{
  "mcpServers": {
    "muovi": {
      "command": "npx",
      "args": ["-y", "@muovi/mcp-server"]
    }
  }
}
```

If you have a Muovi API key (see [Authentication](#authentication-optional) below), pass it via env:

```json
{
  "mcpServers": {
    "muovi": {
      "command": "npx",
      "args": ["-y", "@muovi/mcp-server"],
      "env": {
        "MUOVI_API_KEY": "your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop after editing the config.

### Cursor

Add to `~/.cursor/mcp.json` (or your workspace's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "muovi": {
      "command": "npx",
      "args": ["-y", "@muovi/mcp-server"]
    }
  }
}
```

### Claude Code

Register the server with the Claude Code CLI:

```bash
claude mcp add muovi --command "npx" --args "-y" "@muovi/mcp-server"
```

Or add it manually to your Claude Code settings:

```json
{
  "mcpServers": {
    "muovi": {
      "command": "npx",
      "args": ["-y", "@muovi/mcp-server"]
    }
  }
}
```

### Manual / scripting

```bash
npx -y @muovi/mcp-server
```

The process reads JSON-RPC on stdin and replies on stdout. All log output goes to stderr.

## Authentication (optional)

All `/v1` endpoints are public and unauthenticated by default. If your client has been issued a Muovi API key (higher rate-limit tier), set `MUOVI_API_KEY` in the server's environment and the package will forward it as the `X-API-Key` header on every request.

You can also override the API base URL for testing:

```bash
MUOVI_API_BASE_URL=https://staging.muovi.com.ar/api/v1 npx -y @muovi/mcp-server
```

## Example agent workflow

A typical Claude conversation that uses these tools:

1. User asks for "an electrician in Palermo who's properly licensed".
2. Agent calls `muovi_list_services` to map "electrician" → `electricidad`.
3. Agent calls `muovi_list_cities` to confirm `palermo` is a valid neighborhood under `caba`.
4. Agent calls `muovi_search_professionals` with `{ service: "electricidad", city: "caba", neighborhood: "palermo", has_matricula: true, min_rating: 4.5 }`.
5. Agent picks the top pro and calls `muovi_get_professional` for the full bio + portfolio.
6. Agent optionally calls `muovi_get_reviews` for social proof.
7. Agent calls `muovi_create_task_link` with `{ professional_slug, service_slug: "electricidad" }` and surfaces the resulting URL.
8. User follows the link, lands on Muovi, completes the on-platform task creation flow.

Step 8 — the on-platform flow — is Muovi's enforcement point for trust, payments, and disputes. MCP never bypasses it.

## Local development

This package lives inside the Muovi web monorepo under [`packages/mcp-server/`](https://github.com/muovi-ar/muovi-web/tree/main/packages/mcp-server) but has its own `package.json` and `node_modules` (no npm workspaces — fully standalone for publishing).

```bash
cd packages/mcp-server
npm install
npm test            # unit + integration + OpenAPI drift checks
npm run typecheck   # strict TypeScript
npm run build       # emits dist/
```

The OpenAPI drift test parses `public/openapi.yaml` and asserts each tool's input schema matches the corresponding operation's parameters exactly — adding a query param to `/v1` requires updating the corresponding tool (and vice versa).

## Publishing

`npm publish` is intentionally **not** wired into CI. Releases are cut manually from a clean tag:

```bash
cd packages/mcp-server
npm version patch    # or minor / major
npm publish --access public
git push --follow-tags
```

`prepublishOnly` runs `clean + build + test` before any publish.

### MCP Registry (mcp-publisher)

Beyond npm, this server is listed in the [Model Context Protocol registry](https://registry.modelcontextprotocol.io) via the committed [`server.json`](./server.json) manifest. Publishing to the registry is a **manual step — there is deliberately no CI auto-publish** (the registry is a low-frequency, human-gated surface, and namespace auth is interactive).

**Committed namespace:** `ar.com.muovi/mcp-server` — the reverse-DNS form of `muovi.com.ar`. This value lives in **both** `server.json` (`name`) and `package.json` (`mcpName`) and the two **must stay byte-identical** (the `server-json` test enforces equality). It must also match the identity you authenticate as with `mcp-publisher` (see below).

#### One-time namespace ownership setup

Prove ownership of the `ar.com.muovi` namespace once, before the first publish:

- **DNS (preferred):** add the TXT record that `mcp-publisher login dns` prints to the `muovi.com.ar` zone, then authenticate against that domain. This ties the namespace to the domain we already control.
- **GitHub OAuth (fallback):** `mcp-publisher login github` — authenticates via the `muovi-ar` GitHub org. Only use this if DNS verification is unavailable; the authenticated identity still has to line up with the committed `ar.com.muovi/mcp-server` namespace.

If the committed namespace and the authenticated identity disagree, `mcp-publisher publish` will reject the manifest — fix the namespace (in both files) or the login, do not force it.

#### Publish steps

```bash
cd packages/mcp-server
mcp-publisher validate ./server.json   # checks against the live registry schema
mcp-publisher publish                   # publishes server.json under the authenticated namespace
```

`validate` is the step that confirms the manifest matches the current registry schema version — run it every time; the pinned `$schema` in `server.json` is a hint, not a guarantee the live schema hasn't moved.

#### Version-bump discipline

The `server-json` test asserts that four version fields agree. On **every** version bump, update all of them together, then re-publish to both npm and the registry:

1. `package.json` → `version`
2. `src/server.ts` → `PACKAGE_VERSION`
3. `server.json` → `version`
4. `server.json` → `packages[0].version`

#### Honest gating notes

The manifest advertises capabilities that are not yet fully live. Keep these caveats in mind (and do not overstate them to users):

- **Remote transport** (`remotes[].url` = `https://mcp.muovi.com.ar/`) is only truthful once that endpoint reliably answers JSON-RPC `initialize` over streamable-HTTP. That hosted surface is tracked in **MOB-207**; until it lands, the **stdio** package (`npx @muovi/mcp-server`) is the only transport that actually works.
- **`muovi_get_professional`** and **`muovi_get_reviews`** remain broken against production until **MOB-263** deploys the backing `/v1` endpoints. The tools are registered and pass drift checks, but live calls will fail until then.

## License

[MIT](./LICENSE).

## Links

- [Muovi](https://muovi.com.ar)
- [Public `/v1` API spec](https://muovi.com.ar/openapi.yaml)
- [Model Context Protocol](https://modelcontextprotocol.io)
