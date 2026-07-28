import { appendFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SERVER_VERSION } from "../src/domain/contract.js";

export interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

export interface ReleaseReadinessInput {
  manifest: PackageManifest;
  serverVersion: string;
  releaseTag: string | undefined;
  changelog: string;
  readme: string;
}

export interface ReleaseReadiness {
  npmTag: "latest" | "next";
  prerelease: boolean;
  version: string;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateReleaseDocumentation(
  version: string,
  changelog: string,
  readme: string,
): void {
  const issues: string[] = [];
  const escapedVersion = escapeRegularExpression(version);
  const releaseHeading = new RegExp(
    `^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`,
  );
  const matchingHeadings = changelog
    .split(/\r?\n/)
    .filter((line) => releaseHeading.test(line));

  if (matchingHeadings.length !== 1) {
    issues.push(
      `CHANGELOG.md must contain exactly one dated "## [${version}] - YYYY-MM-DD" section`,
    );
  }

  const unreleasedVersionLines = readme
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + 1, line }))
    .filter(
      ({ line }) =>
        line.includes(version) && /\bunreleased\b/i.test(line),
    )
    .map(({ index }) => index);
  if (unreleasedVersionLines.length > 0) {
    issues.push(
      `README.md still calls ${version} Unreleased on line(s) ${unreleasedVersionLines.join(", ")}`,
    );
  }

  const frontDoorInstall = readme.match(
    /^\s*npx\s+-y\s+circuitarium-mcp@([^\s`]+)\s*$/m,
  );
  if (frontDoorInstall?.[1] !== version) {
    issues.push(
      `README.md's first front-door npx install must pin circuitarium-mcp@${version}`,
    );
  }

  if (issues.length > 0) {
    throw new Error(
      `Release documentation is not ready for v${version}:\n- ${issues.join("\n- ")}`,
    );
  }
}

export function verifyReleaseReadiness(
  input: ReleaseReadinessInput,
): ReleaseReadiness {
  if (input.manifest.name !== "circuitarium-mcp") {
    throw new Error(
      "package.json must retain the circuitarium-mcp package identity",
    );
  }
  if (
    typeof input.manifest.version !== "string" ||
    input.manifest.version !== input.serverVersion
  ) {
    throw new Error(
      `Version mismatch: package.json=${String(input.manifest.version)}, server=${input.serverVersion}`,
    );
  }
  if (
    input.releaseTag !== undefined &&
    input.releaseTag !== `v${input.manifest.version}`
  ) {
    throw new Error(
      `Release tag ${input.releaseTag} must exactly match v${input.manifest.version}`,
    );
  }

  validateReleaseDocumentation(
    input.manifest.version,
    input.changelog,
    input.readme,
  );

  const versionWithoutBuildMetadata =
    input.manifest.version.split("+", 1)[0] ?? input.manifest.version;
  const prerelease = versionWithoutBuildMetadata.includes("-");
  return {
    npmTag: prerelease ? "next" : "latest",
    prerelease,
    version: input.manifest.version,
  };
}

function invokedAsMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [manifestText, changelog, readme] = await Promise.all([
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    readFile(resolve(repositoryRoot, "CHANGELOG.md"), "utf8"),
    readFile(resolve(repositoryRoot, "README.md"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as PackageManifest;
  const releaseTag =
    process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? process.argv[2];
  const readiness = verifyReleaseReadiness({
    manifest,
    serverVersion: SERVER_VERSION,
    releaseTag,
    changelog,
    readme,
  });

  process.stdout.write(
    `Release metadata and documentation are coherent: ${manifest.name}@${readiness.version} (npm tag ${readiness.npmTag}).\n`,
  );
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined && githubOutput.length > 0) {
    await appendFile(
      githubOutput,
      `npm_tag=${readiness.npmTag}\nprerelease=${String(readiness.prerelease)}\n`,
      "utf8",
    );
  }
}

if (invokedAsMainModule()) {
  await main();
}
