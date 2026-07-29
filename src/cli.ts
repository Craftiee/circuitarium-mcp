#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CRUMB_FIXTURE_KINDS,
  generateFixture,
  type CrumbFixtureKind,
} from "./adapters/crumb/fixtures.js";
import { validateCru } from "./adapters/crumb/format.js";
import { workspaceRef, writeCruFile } from "./adapters/crumb/io.js";
import { callToolLocally } from "./server.js";

function usage(): string {
  return `Circuitarium MCP CLI

Read commands run the same registered MCP tools as the stdio server, with the
same validation, bounds, and result envelopes:
  list [dir]
  inspect <file.cru>
  analyze <file.cru> [summary|components|connections] [limit] [cursor]
  compare <baseline.cru> <candidate.cru> [summary|root|components] [limit] [cursor]
  component <file.cru> <componentId>
  netlist <file.cru> [limit] [cursor]
  trace-net <file.cru> <componentId> <terminalIndex> [limit] [cursor]
  check <file.cru>
  bom <file.cru>
  ic [label-or-package-query]
  validate <file.cru>
  validate-experiment <experiment.json>
  plan-verification <request.json>
  validate-run-record <record.json>

Logisim-evolution commands use the same MCP envelopes. Runtime commands need
Java 21 and CIRCUITARIUM_LOGISIM_JAR pointing at the official 4.1.0 all-JAR:
  logisim-list [dir]
  logisim-analyze <file.circ> [circuit]
  logisim-netlist <file.circ> [circuit] [limit] [cursor]
  logisim-stats <file.circ> [circuit]
  logisim-table <file.circ> [circuit] [limit]
  logisim-test <file.circ> <file.vec> [circuit]

Fixture maintenance commands write directly and support --force overwrite,
which the MCP surface never does:
  generate <fixture-kind> <output.cru> [name] [--force]
  generate-all [output-directory] [--force]
`;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  options: { failWhenDataInvalid?: boolean } = {},
): Promise<void> {
  const { envelope, isError } = await callToolLocally(name, args);
  printJson(envelope);
  if (isError) {
    process.exitCode = 1;
    return;
  }
  if (options.failWhenDataInvalid) {
    const data = envelope.data as { valid?: boolean } | undefined;
    if (data?.valid === false) {
      process.exitCode = 1;
    }
  }
}

function requirePath(value: string | undefined, command: string): string {
  if (!value) {
    throw new Error(`${command} requires a .cru path`);
  }
  return value;
}

function requireLogisimPath(
  value: string | undefined,
  command: string,
): string {
  if (!value) {
    throw new Error(`${command} requires a .circ path`);
  }
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter((argument) => argument !== "--force");

  switch (command) {
    case "list": {
      await runTool("crumb_list_projects", {
        ...(positional[0] === undefined ? {} : { dir: positional[0] }),
      });
      return;
    }
    case "inspect": {
      await runTool("crumb_inspect_design", {
        path: requirePath(positional[0], "inspect"),
      });
      return;
    }
    case "analyze": {
      const path = requirePath(positional[0], "analyze");
      const view = positional[1] ?? "summary";
      const limit = Number.parseInt(positional[2] ?? "50", 10);
      const cursor = positional[3];
      await runTool("crumb_analyze_design", {
        path,
        view,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return;
    }
    case "compare": {
      const baselinePath = positional[0];
      const candidatePath = positional[1];
      if (!baselinePath || !candidatePath) {
        throw new Error("compare requires baseline and candidate .cru paths");
      }
      const view = positional[2] ?? "summary";
      const limit = Number.parseInt(positional[3] ?? "50", 10);
      const cursor = positional[4];
      await runTool("crumb_compare_designs", {
        baselinePath,
        candidatePath,
        view,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return;
    }
    case "component": {
      const path = requirePath(positional[0], "component");
      const componentId = positional[1];
      if (!componentId) {
        throw new Error("component requires a componentId");
      }
      await runTool("crumb_get_component", { path, componentId });
      return;
    }
    case "netlist": {
      const limit = Number.parseInt(positional[1] ?? "50", 10);
      const cursor = positional[2];
      await runTool("crumb_export_netlist", {
        path: requirePath(positional[0], "netlist"),
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return;
    }
    case "trace-net": {
      const path = requirePath(positional[0], "trace-net");
      const componentId = positional[1];
      if (!componentId) {
        throw new Error("trace-net requires a componentId");
      }
      const terminalIndex = Number.parseInt(positional[2] ?? "", 10);
      if (!Number.isInteger(terminalIndex) || terminalIndex < 0) {
        throw new Error("trace-net requires a nonnegative terminalIndex");
      }
      const limit = Number.parseInt(positional[3] ?? "50", 10);
      const cursor = positional[4];
      await runTool("crumb_trace_net", {
        path,
        componentId,
        terminalIndex,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return;
    }
    case "check": {
      await runTool(
        "crumb_check_design",
        { path: requirePath(positional[0], "check") },
        { failWhenDataInvalid: true },
      );
      return;
    }
    case "bom": {
      await runTool("crumb_bom", { path: requirePath(positional[0], "bom") });
      return;
    }
    case "ic": {
      await runTool("crumb_ic_reference", {
        ...(positional[0] === undefined ? {} : { query: positional[0] }),
      });
      return;
    }
    case "validate": {
      await runTool(
        "crumb_validate_design",
        { path: requirePath(positional[0], "validate") },
        { failWhenDataInvalid: true },
      );
      return;
    }
    case "validate-experiment": {
      const path = positional[0];
      if (!path) {
        throw new Error("validate-experiment requires a JSON path");
      }
      const experiment = JSON.parse(
        await readFile(resolve(path), "utf8"),
      ) as unknown;
      await runTool(
        "electronics_validate_experiment",
        { experiment },
        { failWhenDataInvalid: true },
      );
      return;
    }
    case "plan-verification": {
      const path = positional[0];
      if (!path) {
        throw new Error("plan-verification requires a JSON path");
      }
      const request = JSON.parse(
        await readFile(resolve(path), "utf8"),
      ) as unknown;
      if (
        request === null ||
        typeof request !== "object" ||
        Array.isArray(request)
      ) {
        throw new Error(
          "plan-verification JSON must contain one request object",
        );
      }
      await runTool(
        "electronics_plan_verification",
        request as Record<string, unknown>,
      );
      return;
    }
    case "validate-run-record": {
      const path = positional[0];
      if (!path) {
        throw new Error("validate-run-record requires a JSON path");
      }
      const serializedRecord = await readFile(resolve(path), "utf8");
      await runTool(
        "electronics_validate_run_record",
        { serializedRecord },
        { failWhenDataInvalid: true },
      );
      return;
    }
    case "logisim-list": {
      await runTool("logisim_list_projects", {
        ...(positional[0] === undefined ? {} : { dir: positional[0] }),
      });
      return;
    }
    case "logisim-analyze": {
      await runTool("logisim_analyze_design", {
        path: requireLogisimPath(positional[0], "logisim-analyze"),
        ...(positional[1] === undefined ? {} : { circuit: positional[1] }),
      });
      return;
    }
    case "logisim-netlist": {
      const limit = Number.parseInt(positional[2] ?? "50", 10);
      const cursor = positional[3];
      await runTool("logisim_export_netlist", {
        path: requireLogisimPath(positional[0], "logisim-netlist"),
        ...(positional[1] === undefined ? {} : { circuit: positional[1] }),
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return;
    }
    case "logisim-stats": {
      await runTool("logisim_component_stats", {
        path: requireLogisimPath(positional[0], "logisim-stats"),
        ...(positional[1] === undefined ? {} : { circuit: positional[1] }),
      });
      return;
    }
    case "logisim-table": {
      const limit = Number.parseInt(positional[2] ?? "256", 10);
      await runTool("logisim_truth_table", {
        path: requireLogisimPath(positional[0], "logisim-table"),
        ...(positional[1] === undefined ? {} : { circuit: positional[1] }),
        limit,
      });
      return;
    }
    case "logisim-test": {
      const projectPath = requireLogisimPath(positional[0], "logisim-test");
      const vectorPath = positional[1];
      if (!vectorPath) {
        throw new Error("logisim-test requires a .vec or .txt path");
      }
      await runTool(
        "logisim_run_test_vector",
        {
          path: projectPath,
          vectorPath,
          ...(positional[2] === undefined ? {} : { circuit: positional[2] }),
        },
        { failWhenDataInvalid: true },
      );
      return;
    }
    case "generate": {
      const [kind, path, name] = positional;
      if (!kind || !CRUMB_FIXTURE_KINDS.includes(kind as CrumbFixtureKind)) {
        throw new Error(
          `generate kind must be one of: ${CRUMB_FIXTURE_KINDS.join(", ")}`,
        );
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
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
