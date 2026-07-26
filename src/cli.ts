#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CRUMB_FIXTURE_KINDS,
  generateFixture,
  type CrumbFixtureKind,
} from "./adapters/crumb/fixtures.js";
import { analyzeCru } from "./adapters/crumb/analyze.js";
import { compareCru } from "./adapters/crumb/compare.js";
import { inspectCru, validateCru } from "./adapters/crumb/format.js";
import {
  readCruFile,
  requireCruComparisonSize,
  workspaceRef,
  writeCruFile,
} from "./adapters/crumb/io.js";
import { validateExperiment } from "./domain/experiment.js";

function usage(): string {
  return `Circuitarium MCP CLI

Commands:
  inspect <file.cru>
  analyze <file.cru> [summary|components|connections] [limit]
  compare <baseline.cru> <candidate.cru> [summary|root|components] [limit]
  validate <file.cru>
  validate-experiment <experiment.json>
  generate <fixture-kind> <output.cru> [name] [--force]
  generate-all [output-directory] [--force]
`;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter((argument) => argument !== "--force");

  switch (command) {
    case "inspect": {
      const path = positional[0];
      if (!path) {
        throw new Error("inspect requires a .cru path");
      }
      const file = await readCruFile(path);
      printJson({ path: workspaceRef(file.path), inspection: inspectCru(file.xml) });
      return;
    }
    case "analyze": {
      const path = positional[0];
      const view = positional[1] ?? "summary";
      const limit = Number.parseInt(positional[2] ?? "50", 10);
      if (!path) {
        throw new Error("analyze requires a .cru path");
      }
      if (!["summary", "components", "connections"].includes(view)) {
        throw new Error("analyze view must be summary, components, or connections");
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new Error("analyze limit must be an integer from 1 through 200");
      }
      const file = await readCruFile(path);
      const analysis = analyzeCru(file.xml);
      const base = {
        path: workspaceRef(file.path),
        analysisVersion: analysis.analysisVersion,
        projectDigest: analysis.projectDigest,
        designName: analysis.designName,
        designNameInfo: analysis.designNameInfo,
        summary: analysis.summary,
        connectivity: {
          scope: analysis.connectivity.scope,
          confidence: analysis.connectivity.confidence,
          topologyMode: analysis.connectivity.topologyMode,
          groupCount: analysis.connectivity.groupCount,
          isolatedAttachmentGroupCount:
            analysis.connectivity.isolatedAttachmentGroupCount,
          limitations: analysis.connectivity.limitations,
        },
        conversion: analysis.conversion,
        diagnostics: analysis.diagnostics,
      };
      if (view === "components") {
        printJson({
          ...base,
          view,
          page: {
            returned: Math.min(limit, analysis.components.length),
            total: analysis.components.length,
            limit,
          },
          components: analysis.components.slice(0, limit),
        });
      } else if (view === "connections") {
        printJson({
          ...base,
          view,
          page: {
            returned: Math.min(limit, analysis.connectivity.groups.length),
            total: analysis.connectivity.groups.length,
            limit,
          },
          connections: analysis.connectivity.groups.slice(0, limit),
        });
      } else {
        printJson({ ...base, view });
      }
      return;
    }
    case "compare": {
      const baselinePath = positional[0];
      const candidatePath = positional[1];
      const view = positional[2] ?? "summary";
      const limit = Number.parseInt(positional[3] ?? "50", 10);
      if (!baselinePath || !candidatePath) {
        throw new Error(
          "compare requires baseline and candidate .cru paths",
        );
      }
      if (!["summary", "root", "components"].includes(view)) {
        throw new Error(
          "compare view must be summary, root, or components",
        );
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new Error("compare limit must be an integer from 1 through 200");
      }
      const [baselineFile, candidateFile] = await Promise.all([
        readCruFile(baselinePath),
        readCruFile(candidatePath),
      ]);
      requireCruComparisonSize(
        baselineFile.bytes,
        candidateFile.bytes,
      );
      const baselineValidation = validateCru(baselineFile.xml);
      const candidateValidation = validateCru(candidateFile.xml);
      if (!baselineValidation.valid || !candidateValidation.valid) {
        printJson({
          valid: false,
          baseline: {
            path: workspaceRef(baselineFile.path),
            validation: baselineValidation,
          },
          candidate: {
            path: workspaceRef(candidateFile.path),
            validation: candidateValidation,
          },
        });
        process.exitCode = 1;
        return;
      }
      const comparison = compareCru(baselineFile.xml, candidateFile.xml, {
        baselineByteDigest: baselineFile.digest,
        candidateByteDigest: candidateFile.digest,
      });
      const {
        root,
        componentChanges,
        diagnostics,
        ...summary
      } = comparison;
      const base = {
        baseline: {
          path: workspaceRef(baselineFile.path),
          bytes: baselineFile.bytes,
          digest: baselineFile.digest,
        },
        candidate: {
          path: workspaceRef(candidateFile.path),
          bytes: candidateFile.bytes,
          digest: candidateFile.digest,
        },
        ...summary,
        diagnostics,
      };
      if (view === "root") {
        printJson({ ...base, view, root });
      } else if (view === "components") {
        printJson({
          ...base,
          view,
          page: {
            returned: Math.min(limit, componentChanges.length),
            total: componentChanges.length,
            limit,
          },
          componentChanges: componentChanges.slice(0, limit),
        });
      } else {
        printJson({ ...base, view });
      }
      return;
    }
    case "validate": {
      const path = positional[0];
      if (!path) {
        throw new Error("validate requires a .cru path");
      }
      const file = await readCruFile(path);
      const result = validateCru(file.xml);
      printJson({ path: workspaceRef(file.path), ...result });
      if (!result.valid) {
        process.exitCode = 1;
      }
      return;
    }
    case "validate-experiment": {
      const path = positional[0];
      if (!path) {
        throw new Error("validate-experiment requires a JSON path");
      }
      const input = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
      const result = validateExperiment(input);
      printJson(result);
      if (!result.valid) {
        process.exitCode = 1;
      }
      return;
    }
    case "generate": {
      const [kind, path, name] = positional;
      if (!kind || !CRUMB_FIXTURE_KINDS.includes(kind as CrumbFixtureKind)) {
        throw new Error(`generate kind must be one of: ${CRUMB_FIXTURE_KINDS.join(", ")}`);
      }
      if (!path) {
        throw new Error("generate requires an output .cru path");
      }
      const xml = generateFixture(kind as CrumbFixtureKind, name);
      const writtenPath = await writeCruFile(path, xml, {
        overwrite: force,
        createParent: true,
      });
      printJson({
        kind,
        path: workspaceRef(writtenPath),
        validation: validateCru(xml),
      });
      return;
    }
    case "generate-all": {
      const outputDirectory = resolve(positional[0] ?? "fixtures/crumb");
      const written = [];
      for (const kind of CRUMB_FIXTURE_KINDS) {
        const path = join(outputDirectory, `${kind}.cru`);
        const xml = generateFixture(kind);
        written.push(
          await writeCruFile(path, xml, {
            overwrite: force,
            createParent: true,
          }),
        );
      }
      printJson({
        outputDirectory: workspaceRef(outputDirectory),
        files: written.map(workspaceRef),
      });
      return;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage());
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
