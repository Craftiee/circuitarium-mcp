import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  mcpName?: unknown;
  name?: unknown;
  repository?: {
    url?: unknown;
  };
  version?: unknown;
}

interface RegistryPackage {
  identifier?: unknown;
  registryType?: unknown;
  transport?: {
    type?: unknown;
  };
  version?: unknown;
}

interface RegistryMetadata {
  $schema?: unknown;
  description?: unknown;
  name?: unknown;
  packages?: unknown;
  repository?: {
    source?: unknown;
    url?: unknown;
  };
  title?: unknown;
  version?: unknown;
}

const OFFICIAL_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const GITHUB_NAMESPACE = /^io\.github\.Craftiee\/[a-z0-9][a-z0-9._-]*$/u;
const REPOSITORY_URL = "https://github.com/Craftiee/circuitarium-mcp";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const packageManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
) as PackageManifest;
const registryMetadata = JSON.parse(
  await readFile(resolve(repositoryRoot, "server.json"), "utf8"),
) as RegistryMetadata;

assert.equal(registryMetadata.$schema, OFFICIAL_SCHEMA);
assert.ok(typeof packageManifest.mcpName === "string");
assert.match(packageManifest.mcpName, GITHUB_NAMESPACE);
assert.equal(registryMetadata.name, packageManifest.mcpName);
assert.equal(registryMetadata.title, "Circuitarium MCP");
assert.equal(registryMetadata.version, packageManifest.version);
assert.equal(registryMetadata.repository?.source, "github");
assert.equal(registryMetadata.repository?.url, REPOSITORY_URL);
assert.equal(
  packageManifest.repository?.url,
  "git+https://github.com/Craftiee/circuitarium-mcp.git",
);

assert.ok(typeof registryMetadata.description === "string");
assert.ok(
  registryMetadata.description.length > 0 &&
    registryMetadata.description.length <= 100,
  "server.json description must contain 1-100 characters",
);

assert.ok(Array.isArray(registryMetadata.packages));
assert.equal(registryMetadata.packages.length, 1);
const registryPackage = registryMetadata.packages[0] as RegistryPackage;
assert.equal(registryPackage.registryType, "npm");
assert.equal(registryPackage.identifier, packageManifest.name);
assert.equal(registryPackage.version, packageManifest.version);
assert.equal(registryPackage.transport?.type, "stdio");

process.stdout.write(
  `Verified ${String(packageManifest.mcpName)}@${String(packageManifest.version)} Registry metadata.\n`,
);
