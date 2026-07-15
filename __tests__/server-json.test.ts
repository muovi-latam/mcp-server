/**
 * MCP registry manifest guard.
 *
 * Parses the committed `server.json` (the Model Context Protocol registry
 * manifest) and asserts it stays consistent with the real package metadata
 * and source constants:
 *   - the registry namespace is identical in `server.json` and `package.json`;
 *   - every version field agrees (manifest, npm package entry, package.json,
 *     and the `PACKAGE_VERSION` constant in `src/server.ts`);
 *   - the npm package entry points at the real package with a stdio transport;
 *   - exactly one remote endpoint is advertised;
 *   - the human-facing description is non-empty and within the MCP Registry's
 *     100-character limit (the registry rejects longer descriptions with 422).
 *
 * Fails CI if a version bump misses a field, the namespace drifts between the
 * two files, or the description grows past the registry's publish limit.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME, PACKAGE_VERSION } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_JSON_PATH = resolve(__dirname, '../server.json');
const PACKAGE_JSON_PATH = resolve(__dirname, '../package.json');

interface ServerJsonPackage {
  registryType: string;
  identifier: string;
  version: string;
  transport: { type: string };
}

interface ServerJsonRemote {
  type: string;
  url: string;
}

interface ServerJson {
  name: string;
  description: string;
  version: string;
  packages: ServerJsonPackage[];
  remotes: ServerJsonRemote[];
}

interface PackageJson {
  name: string;
  version: string;
  mcpName: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

describe('server.json — MCP registry manifest mirrors package + source', () => {
  it('parses as valid JSON', () => {
    expect(() => readJson<ServerJson>(SERVER_JSON_PATH)).not.toThrow();
  });

  it('namespace matches package.json mcpName exactly', () => {
    const server = readJson<ServerJson>(SERVER_JSON_PATH);
    const pkg = readJson<PackageJson>(PACKAGE_JSON_PATH);
    // String equality (not a hardcoded namespace) so a human can swap the
    // reverse-DNS namespace later without breaking this guard.
    expect(server.name).toBe(pkg.mcpName);
  });

  it('every version field agrees with package.json and PACKAGE_VERSION', () => {
    const server = readJson<ServerJson>(SERVER_JSON_PATH);
    const pkg = readJson<PackageJson>(PACKAGE_JSON_PATH);

    expect(server.version).toBe(pkg.version);
    expect(server.version).toBe(PACKAGE_VERSION);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0]?.version).toBe(PACKAGE_VERSION);
  });

  it('npm package entry points at the real package via stdio', () => {
    const server = readJson<ServerJson>(SERVER_JSON_PATH);
    const pkg = readJson<PackageJson>(PACKAGE_JSON_PATH);
    const entry = server.packages[0];

    expect(entry?.registryType).toBe('npm');
    expect(entry?.identifier).toBe(pkg.name);
    // PACKAGE_NAME in src is the same npm identifier — keep all three aligned.
    expect(entry?.identifier).toBe(PACKAGE_NAME);
    expect(entry?.transport.type).toBe('stdio');
  });

  it('advertises exactly one hosted remote endpoint', () => {
    const server = readJson<ServerJson>(SERVER_JSON_PATH);

    expect(server.remotes).toHaveLength(1);
    const remote = server.remotes[0];
    expect(remote?.url).toBe('https://mcp.muovi.com.ar/');
    expect(['streamable-http', 'sse']).toContain(remote?.type);
  });

  it('description is non-empty and within the registry 100-char limit', () => {
    const server = readJson<ServerJson>(SERVER_JSON_PATH);
    // The MCP Registry rejects server.json on publish (422) when the
    // description exceeds 100 characters, so enumerating every tool no longer
    // fits — guard the registry's actual constraint instead.
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.description).toContain('Muovi');
  });
});
