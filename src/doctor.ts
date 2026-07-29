import { createHash } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { generateFixture } from "./adapters/crumb/fixtures.js";
import { probeLogisimRuntime } from "./adapters/logisim/runtime.js";
import { SERVER_NAME, SERVER_VERSION } from "./identity.js";
import type { DoctorCommandOptions, DoctorCommandResult } from "./terminal.js";

const DOCTOR_SCHEMA_VERSION = "circuitarium.doctor/0.1";
const EXPECTED_LOGISIM_VERSION = "4.1.0";
const MINIMUM_NODE_MAJOR = 22;
const SMOKE_FIXTURE_NAME = "Circuitarium doctor synthetic fixture";
const SMOKE_FIXTURE_FILE = "doctor-smoke.cru";
const SMOKE_WORKSPACE_PREFIX = "circuitarium-doctor-";

type DoctorCheckStatus = "fail" | "pass" | "skip";

interface DoctorCheck {
  id: string;
  required: boolean;
  status: DoctorCheckStatus;
  summary: string;
}

interface DoctorSmokeDetails {
  artifactDigest?: string;
  artifactKind: "generated-breadboard-led";
  cleaned: boolean;
  workspace: "temporary";
}

interface DoctorReport {
  checks: DoctorCheck[];
  mode: {
    json: boolean;
    smoke: boolean;
  };
  ok: boolean;
  schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  server: {
    name: typeof SERVER_NAME;
    nodeRuntime: string;
    registeredToolCount: number;
    version: typeof SERVER_VERSION;
  };
  smoke?: DoctorSmokeDetails;
}

interface ContractEnvelope {
  context?: {
    projectDigest?: unknown;
  };
  data?: Record<string, unknown>;
  ok?: unknown;
}

function addCheck(checks: DoctorCheck[], check: DoctorCheck): void {
  checks.push(check);
}

function cleanEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function currentServerLaunch(): {
  args: string[];
  command: string;
} {
  const entry = process.argv[1];
  if (entry === undefined) {
    throw new Error("The current Circuitarium entrypoint cannot be resolved");
  }
  const resolvedEntry = resolve(entry);
  return {
    command: process.execPath,
    args:
      extname(resolvedEntry).toLowerCase() === ".ts"
        ? ["--import", "tsx", resolvedEntry]
        : [resolvedEntry],
  };
}

function envelopeOf(value: unknown): ContractEnvelope {
  if (value === null || typeof value !== "object") {
    throw new Error("The MCP tool returned no structured result");
  }
  const structuredContent = (value as { structuredContent?: unknown })
    .structuredContent;
  if (
    structuredContent === null ||
    typeof structuredContent !== "object" ||
    Array.isArray(structuredContent)
  ) {
    throw new Error("The MCP tool returned no structured envelope");
  }
  return structuredContent as ContractEnvelope;
}

function requireSuccessfulEnvelope(
  value: unknown,
  expectedDigest: string,
): Record<string, unknown> {
  const envelope = envelopeOf(value);
  if (envelope.ok !== true) {
    throw new Error("The MCP tool returned an error envelope");
  }
  if (envelope.context?.projectDigest !== expectedDigest) {
    throw new Error("The MCP tool did not bind results to the smoke artifact");
  }
  if (envelope.data === undefined) {
    throw new Error("The MCP tool returned no data");
  }
  return envelope.data;
}

async function pathIsMissing(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function assertSafeSmokeWorkspace(path: string): void {
  const resolvedPath = resolve(path);
  if (
    dirname(resolvedPath) !== resolve(tmpdir()) ||
    !basename(resolvedPath).startsWith(SMOKE_WORKSPACE_PREFIX)
  ) {
    throw new Error("Refusing to clean an unexpected smoke workspace path");
  }
}

async function runSmokeChecks(
  checks: DoctorCheck[],
  registeredToolNames: readonly string[],
): Promise<DoctorSmokeDetails> {
  const details: DoctorSmokeDetails = {
    artifactKind: "generated-breadboard-led",
    cleaned: false,
    workspace: "temporary",
  };
  let workspace: string | undefined;
  let client: Client | undefined;
  try {
    workspace = await mkdtemp(join(tmpdir(), SMOKE_WORKSPACE_PREFIX));
    const xml = generateFixture("breadboard-led", SMOKE_FIXTURE_NAME);
    const bytes = Buffer.from(xml, "utf8");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    details.artifactDigest = digest;
    await writeFile(join(workspace, SMOKE_FIXTURE_FILE), bytes, {
      flag: "wx",
    });
    addCheck(checks, {
      id: "smoke-workspace",
      required: true,
      status: "pass",
      summary:
        "Created a new isolated workspace containing one generated synthetic CRUMB artifact.",
    });

    const launch = currentServerLaunch();
    const transport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      // Keep the install/source working directory so a development entrypoint
      // can resolve its loader. The child's file boundary is still the
      // temporary directory supplied through CIRCUITARIUM_MCP_ROOT.
      cwd: process.cwd(),
      env: {
        ...cleanEnvironment(process.env),
        CIRCUITARIUM_MCP_ROOT: workspace,
      },
      stderr: "pipe",
    });
    client = new Client({
      name: `${SERVER_NAME}-doctor`,
      version: SERVER_VERSION,
    });
    await client.connect(transport);
    addCheck(checks, {
      id: "stdio-startup",
      required: true,
      status: "pass",
      summary: "Started and connected to a fresh stdio MCP server process.",
    });

    const listed = await client.listTools();
    const actualNames = listed.tools.map((tool) => tool.name);
    const expectedNames = [...registeredToolNames];
    const missingNames = expectedNames.filter(
      (name) => !actualNames.includes(name),
    );
    const extraNames = actualNames.filter(
      (name) => !expectedNames.includes(name),
    );
    if (
      missingNames.length > 0 ||
      extraNames.length > 0 ||
      actualNames.length !== expectedNames.length
    ) {
      throw new Error(
        `tools/list differed from local registration (${missingNames.length} missing, ${extraNames.length} extra)`,
      );
    }
    addCheck(checks, {
      id: "tools-list",
      required: true,
      status: "pass",
      summary: `tools/list returned all ${actualNames.length} registered tools.`,
    });

    const analysisResult = await client.callTool({
      name: "crumb_analyze_design",
      arguments: {
        path: SMOKE_FIXTURE_FILE,
        view: "summary",
      },
    });
    const analysis = requireSuccessfulEnvelope(analysisResult, digest);
    const analysisSummary = analysis.summary as
      | { componentCount?: unknown; recognizedComponentCount?: unknown }
      | undefined;
    if (
      analysis.analysisVersion !== "crumb.analysis/0.2" ||
      analysis.designName !== SMOKE_FIXTURE_NAME ||
      analysisSummary?.componentCount !== 2 ||
      analysisSummary.recognizedComponentCount !== 2
    ) {
      throw new Error("The synthetic CRUMB analysis was not deterministic");
    }
    addCheck(checks, {
      id: "crumb-analyze",
      required: true,
      status: "pass",
      summary:
        "Analyzed the generated artifact and recognized both expected components.",
    });

    const ercResult = await client.callTool({
      name: "crumb_check_design",
      arguments: {
        path: SMOKE_FIXTURE_FILE,
      },
    });
    const erc = requireSuccessfulEnvelope(ercResult, digest);
    const totals = erc.totals as
      | { errors?: unknown; findings?: unknown; warnings?: unknown }
      | undefined;
    if (
      erc.ercVersion !== "crumb.erc/0.1" ||
      erc.valid !== true ||
      totals?.findings !== 2 ||
      totals.errors !== 0 ||
      totals.warnings !== 2
    ) {
      throw new Error("The synthetic CRUMB ERC result was not deterministic");
    }
    addCheck(checks, {
      id: "crumb-erc",
      required: true,
      status: "pass",
      summary:
        "ERC completed with the expected two floating-terminal warnings and no errors.",
    });
  } catch (error) {
    addCheck(checks, {
      id: "smoke-execution",
      required: true,
      status: "fail",
      summary:
        error instanceof Error
          ? error.message
          : "The smoke check failed with an unknown error.",
    });
  } finally {
    if (client !== undefined) {
      try {
        await client.close();
      } catch {
        // Cleanup below remains mandatory even if the child already exited.
      }
    }
    if (workspace !== undefined) {
      try {
        assertSafeSmokeWorkspace(workspace);
        await rm(workspace, { recursive: true });
        details.cleaned = await pathIsMissing(workspace);
      } catch {
        details.cleaned = false;
      }
    }
    addCheck(checks, {
      id: "smoke-cleanup",
      required: true,
      status: details.cleaned ? "pass" : "fail",
      summary: details.cleaned
        ? "Removed the temporary smoke workspace."
        : "Could not confirm removal of the temporary smoke workspace.",
    });
  }
  return details;
}

function renderTextReport(report: DoctorReport): string {
  const lines = [
    `${SERVER_NAME} doctor`,
    `Server version: ${report.server.version}`,
    `Node runtime: ${report.server.nodeRuntime}`,
    `Registered tools: ${report.server.registeredToolCount}`,
  ];
  for (const check of report.checks) {
    const status = check.status.toUpperCase().padEnd(4, " ");
    lines.push(`[${status}] ${check.summary}`);
  }
  lines.push(
    report.ok
      ? "Overall: ready"
      : "Overall: one or more required checks failed",
  );
  return `${lines.join("\n")}\n`;
}

export async function runDoctor(
  options: DoctorCommandOptions,
  registeredToolNames: readonly string[],
): Promise<DoctorCommandResult> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "",
    10,
  );
  addCheck(checks, {
    id: "node-runtime",
    required: true,
    status:
      Number.isInteger(nodeMajor) && nodeMajor >= MINIMUM_NODE_MAJOR
        ? "pass"
        : "fail",
    summary:
      Number.isInteger(nodeMajor) && nodeMajor >= MINIMUM_NODE_MAJOR
        ? `Node.js ${process.versions.node} satisfies the >=${MINIMUM_NODE_MAJOR} requirement.`
        : `Node.js ${process.versions.node} does not satisfy the >=${MINIMUM_NODE_MAJOR} requirement.`,
  });

  const requiredStaticTools = [
    "crumb_analyze_design",
    "crumb_check_design",
    "logisim_analyze_design",
  ];
  const missingStaticTools = requiredStaticTools.filter(
    (name) => !registeredToolNames.includes(name),
  );
  addCheck(checks, {
    id: "tool-registration",
    required: true,
    status:
      registeredToolNames.length > 0 && missingStaticTools.length === 0
        ? "pass"
        : "fail",
    summary:
      registeredToolNames.length > 0 && missingStaticTools.length === 0
        ? `${registeredToolNames.length} tools are registered, including both static adapters.`
        : `Static tool registration is incomplete (${missingStaticTools.join(", ") || "no tools"}).`,
  });

  const jarConfigured =
    (process.env.CIRCUITARIUM_LOGISIM_JAR?.trim().length ?? 0) > 0 ||
    (process.env.LOGISIM_JAR?.trim().length ?? 0) > 0;
  if (!jarConfigured) {
    addCheck(checks, {
      id: "logisim-runtime",
      required: false,
      status: "skip",
      summary:
        "Logisim JAR runtime: optional, not configured; static Logisim tools remain available.",
    });
  } else {
    try {
      const probe = await probeLogisimRuntime();
      addCheck(checks, {
        id: "logisim-runtime",
        required: true,
        status:
          probe.logisimVersion === EXPECTED_LOGISIM_VERSION ? "pass" : "fail",
        summary:
          probe.logisimVersion === EXPECTED_LOGISIM_VERSION
            ? `Logisim runtime is ready (${probe.displayName}; ${probe.javaRuntime}).`
            : `Logisim runtime reported ${probe.logisimVersion}; expected ${EXPECTED_LOGISIM_VERSION}.`,
      });
    } catch {
      addCheck(checks, {
        id: "logisim-runtime",
        required: true,
        status: "fail",
        summary:
          "Logisim runtime is configured but unavailable; check the JAR path, Java executable, and Java 21 installation.",
      });
    }
  }

  const smoke = options.smoke
    ? await runSmokeChecks(checks, registeredToolNames)
    : undefined;
  const ok = checks.every(
    (check) => !check.required || check.status !== "fail",
  );
  const report: DoctorReport = {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    ok,
    mode: options,
    server: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      nodeRuntime: process.version,
      registeredToolCount: registeredToolNames.length,
    },
    checks,
    ...(smoke === undefined ? {} : { smoke }),
  };
  return {
    exitCode: ok ? 0 : 1,
    text: options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderTextReport(report),
  };
}
