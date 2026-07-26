import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SERVER_VERSION } from "../src/domain/contract.js";

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
) as PackageManifest;
const releaseTag =
  process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? process.argv[2];

if (manifest.name !== "circuitarium-mcp") {
  throw new Error("package.json must retain the circuitarium-mcp package identity");
}
if (typeof manifest.version !== "string" || manifest.version !== SERVER_VERSION) {
  throw new Error(
    `Version mismatch: package.json=${String(manifest.version)}, server=${SERVER_VERSION}`,
  );
}
if (releaseTag !== undefined && releaseTag !== `v${manifest.version}`) {
  throw new Error(
    `Release tag ${releaseTag} must exactly match v${manifest.version}`,
  );
}

const npmTag = manifest.version.includes("-") ? "next" : "latest";
process.stdout.write(
  `Release metadata is coherent: ${manifest.name}@${manifest.version} (npm tag ${npmTag}).\n`,
);
