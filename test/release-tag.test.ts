import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type ReleaseReadinessInput,
  verifyReleaseReadiness,
} from "../scripts/verify-release-tag.js";

function readyInput(
  overrides: Partial<ReleaseReadinessInput> = {},
): ReleaseReadinessInput {
  return {
    manifest: {
      name: "circuitarium-mcp",
      version: "0.3.0",
    },
    serverVersion: "0.3.0",
    releaseTag: "v0.3.0",
    changelog: [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "## [0.3.0] - 2026-07-28",
      "",
      "### Added",
      "",
      "- Added Logisim support.",
      "",
    ].join("\n"),
    readme: [
      "# Circuitarium MCP",
      "",
      "```text",
      "npx -y circuitarium-mcp@0.3.0",
      "```",
      "",
      "Version 0.3.0 provides 22 tools.",
      "",
    ].join("\n"),
    ...overrides,
  };
}

describe("release readiness", () => {
  it("accepts one dated changelog section and a matching front-door install", () => {
    assert.deepEqual(verifyReleaseReadiness(readyInput()), {
      npmTag: "latest",
      prerelease: false,
      version: "0.3.0",
    });
  });

  it("classifies prerelease identifiers without confusing build metadata", () => {
    const stableWithBuild = readyInput({
      manifest: {
        name: "circuitarium-mcp",
        version: "0.3.0+build-7",
      },
      serverVersion: "0.3.0+build-7",
      releaseTag: "v0.3.0+build-7",
      changelog: "## [0.3.0+build-7] - 2026-07-28\n",
      readme: "npx -y circuitarium-mcp@0.3.0+build-7\n",
    });
    assert.deepEqual(verifyReleaseReadiness(stableWithBuild), {
      npmTag: "latest",
      prerelease: false,
      version: "0.3.0+build-7",
    });

    const prerelease = readyInput({
      manifest: {
        name: "circuitarium-mcp",
        version: "0.3.0-rc.1+build-7",
      },
      serverVersion: "0.3.0-rc.1+build-7",
      releaseTag: "v0.3.0-rc.1+build-7",
      changelog: "## [0.3.0-rc.1+build-7] - 2026-07-28\n",
      readme: "npx -y circuitarium-mcp@0.3.0-rc.1+build-7\n",
    });
    assert.deepEqual(verifyReleaseReadiness(prerelease), {
      npmTag: "next",
      prerelease: true,
      version: "0.3.0-rc.1+build-7",
    });
  });

  it("rejects Unreleased source docs before release notes are cut", () => {
    const currentStyleInput = readyInput({
      changelog: [
        "# Changelog",
        "",
        "## [Unreleased]",
        "",
        "- Added Logisim support.",
        "",
        "## [0.2.1] - 2026-07-28",
        "",
      ].join("\n"),
      readme: [
        "# Circuitarium MCP",
        "",
        "npx -y circuitarium-mcp@0.2.1",
        "",
        "The Unreleased 0.3.0 source tree provides 22 tools.",
        "",
      ].join("\n"),
    });

    assert.throws(
      () => verifyReleaseReadiness(currentStyleInput),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(
          error.message,
          /CHANGELOG\.md must contain exactly one dated/,
        );
        assert.match(error.message, /still calls 0\.3\.0 Unreleased/);
        assert.match(
          error.message,
          /front-door npx install must pin circuitarium-mcp@0\.3\.0/,
        );
        return true;
      },
    );
  });

  it("rejects duplicate target-version changelog sections", () => {
    const duplicateHeadingInput = readyInput({
      changelog: [
        "## [0.3.0] - 2026-07-28",
        "",
        "## [0.3.0] - 2026-07-29",
        "",
      ].join("\n"),
    });

    assert.throws(
      () => verifyReleaseReadiness(duplicateHeadingInput),
      /exactly one dated/,
    );
  });

  it("retains package, server, and tag identity checks", () => {
    assert.throws(
      () =>
        verifyReleaseReadiness(
          readyInput({
            releaseTag: "v0.3.1",
          }),
        ),
      /must exactly match v0\.3\.0/,
    );
    assert.throws(
      () =>
        verifyReleaseReadiness(
          readyInput({
            serverVersion: "0.3.1",
          }),
        ),
      /Version mismatch/,
    );
  });
});
