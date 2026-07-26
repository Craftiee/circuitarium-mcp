#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { analyzeCru } from "./adapters/crumb/analyze.js";
import { listCrumbComponentDefinitions } from "./adapters/crumb/catalog.js";
import { compareCru } from "./adapters/crumb/compare.js";
import { CRUMB_COMPATIBILITY_PROFILE } from "./adapters/crumb/compatibility.js";
import { listCrumbEvidenceVocabulary } from "./adapters/crumb/evidence.js";
import {
  CRUMB_FIXTURE_KINDS,
  generateFixture,
  type CrumbFixtureKind,
} from "./adapters/crumb/fixtures.js";
import {
  inspectCru,
  validateCru,
  type CruInspection,
} from "./adapters/crumb/format.js";
import { listCrumbIcs } from "./adapters/crumb/icCatalog.js";
import {
  MAX_CRU_BYTES,
  MAX_CRU_COMPARISON_BYTES,
  readCruFile,
  requireCruComparisonSize,
  workspaceRef,
  writeCruFile,
} from "./adapters/crumb/io.js";
import {
  CALLABLE_BACKENDS,
  GENERAL_TOOLSET,
  ROADMAP_BACKENDS,
  VOCABULARY,
  WORKFLOWS,
} from "./domain/capabilities.js";
import {
  boundCollection,
  boundDiagnostics,
  MAX_COMPONENT_GEOMETRY_POINTS_RETURNED,
  MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
  MAX_COMPONENT_TERMINALS_RETURNED,
  MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
  MAX_CRU_GUID_TOKEN_CHARACTERS,
  MAX_CRU_DOCUMENT_CHARACTERS,
  MAX_CRU_MARKUP_DELIMITERS,
  MAX_CRU_NUMERIC_LEXICAL_CHARACTERS,
  MAX_CRU_TEXT_NODE_CHARACTERS,
  MAX_CRU_XML_NAME_CHARACTERS,
  MAX_CRU_XSI_TYPE_CHARACTERS,
  MAX_DESIGN_NAME_PREVIEW_CHARACTERS,
  MAX_DIAGNOSTIC_CODE_CHARACTERS,
  MAX_DIAGNOSTIC_MESSAGE_CHARACTERS,
  MAX_DIAGNOSTIC_PATH_CHARACTERS,
  MAX_INSPECTION_TOOL_COUNTS_RETURNED,
  MAX_KIND_COUNTS_RETURNED,
  MAX_PARAMETER_COLLECTION_ITEMS_RETURNED,
  MAX_RESULT_DIAGNOSTICS_RETURNED,
  MAX_UNKNOWN_PAYLOAD_KEYS_RETURNED_PER_COMPONENT,
} from "./domain/bounds.js";
import {
  CONTRACT_VERSION,
  SERVER_VERSION,
  type ContractContext,
  type ContractEnvelope,
  type NextAction,
  type ToolError,
} from "./domain/contract.js";
import { envelopeSchema } from "./domain/contract.js";
import { validateExperiment } from "./domain/experiment.js";
import {
  CapabilitiesDataSchema,
  CrumbAnalysisDataSchema,
  CrumbCatalogDataSchema,
  CrumbComparisonDataSchema,
  CrumbFixtureDataSchema,
  CrumbInspectionDataSchema,
  CrumbValidationDataSchema,
  ExperimentValidationDataSchema,
} from "./domain/toolSchemas.js";

const SERVER_NAME = "circuitarium-mcp";
const CRUMB_BACKEND_ID = "crumb.file";
const CRUMB_ADAPTER_VERSION = "crumb.file/0.2";
const ADAPTER_TESTED_CRUMB_COMPATIBILITY = [
  "CRUMB 1.3.5 (Unity save format)",
];
const serverInstanceId = randomUUID();
const MAX_PROJECT_REF_CHARACTERS = 4096;
const MAX_PROJECT_DIGEST_CHARACTERS = 71;
const MAX_CURSOR_CHARACTERS = 2048;
const MAX_FIXTURE_NAME_CHARACTERS = 256;

const ElectronicsCapabilitiesInputSchema = z.object({});
const ElectronicsExperimentInputSchema = z.object({
  experiment: z.json(),
});
const CrumbCatalogInputSchema = z.object({
  toolId: z.number().int().nonnegative().optional(),
});
const CrumbAnalyzeInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative .cru project ref"),
  expectedProjectDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional()
    .describe("Optional sha256: digest from a prior cross-model handoff"),
  view: z.enum(["summary", "components", "connections"]).default("summary"),
  cursor: z.string().min(1).max(MAX_CURSOR_CHARACTERS).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  includeGeometry: z.boolean().default(false),
  includeSourceCode: z.boolean().default(false),
  topologyMode: z
    .enum(["direct-only", "known-board-v1.3.5"])
    .default("known-board-v1.3.5"),
});
const CrumbArtifactReadInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative .cru project ref"),
  expectedProjectDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional()
    .describe("Optional sha256: digest from a prior cross-model handoff"),
});
const CrumbCompareInputSchema = z.object({
  baselinePath: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative baseline .cru project ref"),
  candidatePath: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative candidate .cru project ref"),
  expectedBaselineDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional()
    .describe("Optional sha256: digest previously recorded for the baseline"),
  expectedCandidateDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional()
    .describe("Optional sha256: digest previously recorded for the candidate"),
  compatibilityProfile: z
    .literal(CRUMB_COMPATIBILITY_PROFILE)
    .default(CRUMB_COMPATIBILITY_PROFILE),
  view: z.enum(["summary", "root", "components"]).default("summary"),
  cursor: z.string().min(1).max(MAX_CURSOR_CHARACTERS).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  includeGeometry: z.boolean().default(false),
  topologyMode: z
    .enum(["direct-only", "known-board-v1.3.5"])
    .default("known-board-v1.3.5"),
});
const CrumbFixtureInputSchema = z.object({
  kind: z.enum(CRUMB_FIXTURE_KINDS),
  name: z.string().min(1).max(MAX_FIXTURE_NAME_CHARACTERS).optional(),
  outputPath: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .optional(),
  includeXml: z.boolean().default(false),
});

interface EnvelopeToolRegistration {
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  registeredTool: RegisteredTool;
  context: () => ContractContext;
}

const envelopeTools = new Map<string, EnvelopeToolRegistration>();

const server = new McpServer(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    instructions:
      "Call electronics_capabilities first when the workflow is unclear. All tools use electronics.mcp/0.2 envelopes: ok=false means the tool call failed, while ok=true with data.valid=false means validation ran and found an invalid design. Use workspace-relative project refs, SHA-256 digests, and compatibilityProfile for handoff between ChatGPT, Claude, and local models. Use crumb_compare_designs for a read-only, digest-guarded comparison after a controlled Unity edit or Save As operation. The component catalog returns machine-readable evidenceVocabulary; do not treat confidence strings as electrical-model accuracy. CRUMBLE is Circuitarium MCP's experimental integration family for CRUMB-specific rulesets and file interoperability. Its callable backend reads and writes save files only; it does not control a live simulation. CRUMB topology is version-pinned to the observed CRUMB 1.3.5 Unity save format and is not a claim of compatibility with newer Godot builds.",
  },
);

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Only JSON values can be digested");
}

function makeContext(
  overrides: Partial<Omit<ContractContext, "serverInstanceId" | "sessionScope">> = {},
): ContractContext {
  return {
    serverInstanceId,
    sessionScope: "process",
    ...overrides,
  };
}

function makeCrumbContext(
  overrides: Partial<
    Omit<
      ContractContext,
      | "serverInstanceId"
      | "sessionScope"
      | "backendId"
      | "adapterVersion"
      | "compatibilityProfile"
    >
  > = {},
): ContractContext {
  return makeContext({
    backendId: CRUMB_BACKEND_ID,
    adapterVersion: CRUMB_ADAPTER_VERSION,
    compatibilityProfile: CRUMB_COMPATIBILITY_PROFILE,
    ...overrides,
  });
}

function result<T>(envelope: ContractEnvelope<T>) {
  const structuredContent = envelope as unknown as Record<string, unknown>;
  return {
    ...(envelope.ok ? {} : { isError: true as const }),
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(envelope, null, 2),
      },
    ],
    structuredContent,
  };
}

function successResult<T>(options: {
  summary: string;
  data: T;
  diagnostics?: ContractEnvelope<T>["diagnostics"];
  context?: ContractContext;
  nextActions?: NextAction[];
}) {
  return result<T>({
    contractVersion: CONTRACT_VERSION,
    ok: true,
    summary: options.summary,
    data: options.data,
    diagnostics: boundDiagnostics(options.diagnostics ?? []),
    context: options.context ?? makeContext(),
    nextActions: options.nextActions ?? [],
  });
}

class ContractFailure extends Error {
  constructor(readonly details: ToolError) {
    super(details.message);
  }
}

function invalidArgument(
  message: string,
  argumentPath: string,
  recovery: string[],
): ContractFailure {
  return new ContractFailure({
    code: "INVALID_ARGUMENT",
    category: "argument",
    message,
    retryable: false,
    argumentPath,
    recovery,
  });
}

function requireExpectedProjectDigest(
  expectedProjectDigest: string | undefined,
  actualProjectDigest: string,
  argumentPath = "expectedProjectDigest",
): void {
  if (expectedProjectDigest === undefined) {
    return;
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(expectedProjectDigest)) {
    throw invalidArgument(
      `${argumentPath} must be a lowercase SHA-256 value prefixed with sha256:.`,
      argumentPath,
      ["Copy context.projectDigest unchanged from a prior tool result."],
    );
  }
  if (expectedProjectDigest !== actualProjectDigest) {
    throw new ContractFailure({
      code: "PROJECT_STATE_CONFLICT",
      category: "project",
      message:
        "The project bytes changed since the supplied digest was recorded.",
      retryable: false,
      argumentPath,
      recovery: [
        `Analyze the project again without ${argumentPath}.`,
        "Review the changed digest before continuing the handoff.",
      ],
    });
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function classifyError(
  error: unknown,
  fallback: "INTERNAL_ERROR" | "FORMAT_INVALID" = "INTERNAL_ERROR",
): ToolError {
  if (error instanceof ContractFailure) {
    return error.details;
  }

  const message = error instanceof Error ? error.message : String(error);
  const filesystemCode = nodeErrorCode(error);
  if (message.includes("outside CIRCUITARIUM_MCP_ROOT")) {
    return {
      code: "PATH_DENIED",
      category: "filesystem",
      message: "The requested path is outside the configured MCP workspace.",
      retryable: false,
      recovery: ["Use a workspace-relative path returned by another tool."],
    };
  }
  if (filesystemCode === "ENOENT") {
    return {
      code: "NOT_FOUND",
      category: "filesystem",
      message: "The requested file or parent directory does not exist.",
      retryable: false,
      recovery: ["Check the workspace-relative project ref and try again."],
    };
  }
  if (filesystemCode === "EEXIST") {
    return {
      code: "ALREADY_EXISTS",
      category: "filesystem",
      message: "The destination already exists; this server does not overwrite files.",
      retryable: false,
      recovery: ["Choose a new outputPath.", "Validate or inspect the existing file."],
    };
  }
  if (message.startsWith("Expected a .cru path")) {
    return {
      code: "UNSUPPORTED_FORMAT",
      category: "format",
      message: "CRUMB file tools require a path ending in .cru.",
      retryable: false,
      argumentPath: "path",
      recovery: ["Pass a .cru project ref."],
    };
  }
  if (
    fallback === "FORMAT_INVALID" ||
    message.includes("DOCTYPE") ||
    message.includes("ENTITY") ||
    message.includes("Expected CRUMB root element") ||
    message.includes("Invalid XML")
  ) {
    return {
      code: "FORMAT_INVALID",
      category: "format",
      message: "The file is not a supported, parseable CRUMB save.",
      retryable: false,
      recovery: [
        "Run crumb_validate_design for bounded diagnostics.",
        "Restore the file from a known-good CRUMB save.",
      ],
    };
  }
  return {
    code: "INTERNAL_ERROR",
    category: "internal",
    message: "The operation failed unexpectedly.",
    retryable: false,
    recovery: ["Retry once, then inspect the local MCP server logs."],
  };
}

function errorResult(
  error: unknown,
  options: {
    context?: ContractContext;
    fallback?: "INTERNAL_ERROR" | "FORMAT_INVALID";
  } = {},
) {
  const details = classifyError(error, options.fallback);
  const context = options.context ?? makeContext();
  const nextActions: NextAction[] =
    details.code === "PROJECT_STATE_CONFLICT" && context.projectRef !== undefined
      ? [
          {
            tool: "crumb_analyze_design",
            reason:
              "Re-baseline the changed artifact and review its current digest.",
            arguments: {
              path: context.projectRef,
              view: "summary",
            },
          },
        ]
      : details.code === "PROJECT_INVALID" && context.projectRef !== undefined
        ? [
            {
              tool: "crumb_validate_design",
              reason: "Read the structural diagnostics before attempting analysis.",
              arguments: { path: context.projectRef },
            },
          ]
        : [
            {
              tool: "electronics_capabilities",
              reason: "Review callable backends, constraints, and recovery workflows.",
              arguments: {},
            },
          ];
  return result<never>({
    contractVersion: CONTRACT_VERSION,
    ok: false,
    summary: `Tool call failed: ${details.code}.`,
    diagnostics: [
      {
        severity: "error",
        code: details.code,
        path: details.argumentPath ?? "",
        message: details.message,
      },
    ],
    context,
    nextActions,
    error: details,
  });
}

function compactInspection(inspection: CruInspection) {
  const boundedToolCounts = boundCollection(
    Object.entries(inspection.toolCounts),
    MAX_INSPECTION_TOOL_COUNTS_RETURNED,
  );
  return {
    format: inspection.format,
    name: inspection.name,
    nameInfo: inspection.nameInfo,
    componentCount: inspection.componentCount,
    toolCounts: Object.fromEntries(boundedToolCounts.items),
    toolCountBounds: boundedToolCounts.bounds,
    imageDataBytes: inspection.imageDataBytes,
    imageDataFormat: inspection.imageDataFormat,
    settings: inspection.settings,
  };
}

function crumbArtifact(
  xml: string,
  ref?: string,
  byteIdentity?: { bytes: number; digest: string },
) {
  return {
    ...(ref === undefined ? {} : { ref }),
    format: "crumb-cru" as const,
    mediaType: "application/vnd.crumb.cru+xml" as const,
    bytes: byteIdentity?.bytes ?? Buffer.byteLength(xml, "utf8"),
    digest: byteIdentity?.digest ?? sha256(xml),
    adapterTestedCompatibility: ADAPTER_TESTED_CRUMB_COMPATIBILITY,
  };
}

type AnalysisView = "summary" | "components" | "connections";

interface PageCursor {
  version: 1;
  view: Exclude<AnalysisView, "summary">;
  offset: number;
  projectDigest: string;
}

interface ComparisonPageCursor {
  version: 1;
  kind: "crumb-comparison";
  view: "components";
  offset: number;
  baselineDigest: string;
  candidateDigest: string;
  topologyMode: "direct-only" | "known-board-v1.3.5";
  includeGeometry: boolean;
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function encodeComparisonCursor(cursor: ComparisonPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(
  value: string | undefined,
  view: AnalysisView,
  projectDigest: string,
  total: number,
): number {
  if (value === undefined) {
    return 0;
  }
  if (view === "summary") {
    throw invalidArgument(
      "Pagination cursors are only valid for components or connections views.",
      "cursor",
      ["Remove cursor or select a paginated view."],
    );
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<PageCursor>;
    if (
      decoded.version !== 1 ||
      decoded.view !== view ||
      decoded.projectDigest !== projectDigest ||
      !Number.isInteger(decoded.offset) ||
      decoded.offset! < 0 ||
      decoded.offset! > total
    ) {
      throw new Error("cursor mismatch");
    }
    return decoded.offset!;
  } catch {
    throw invalidArgument(
      "The cursor is invalid, belongs to another view, or targets a changed project.",
      "cursor",
      ["Restart pagination without a cursor using the current project ref."],
    );
  }
}

function decodeComparisonCursor(
  value: string | undefined,
  options: {
    view: "summary" | "root" | "components";
    baselineDigest: string;
    candidateDigest: string;
    topologyMode: "direct-only" | "known-board-v1.3.5";
    includeGeometry: boolean;
    total: number;
  },
): number {
  if (value === undefined) {
    return 0;
  }
  if (options.view !== "components") {
    throw invalidArgument(
      "Pagination cursors are only valid for the components comparison view.",
      "cursor",
      ["Remove cursor or select view=components."],
    );
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ComparisonPageCursor>;
    if (
      decoded.version !== 1 ||
      decoded.kind !== "crumb-comparison" ||
      decoded.view !== "components" ||
      decoded.baselineDigest !== options.baselineDigest ||
      decoded.candidateDigest !== options.candidateDigest ||
      decoded.topologyMode !== options.topologyMode ||
      decoded.includeGeometry !== options.includeGeometry ||
      !Number.isInteger(decoded.offset) ||
      decoded.offset! < 0 ||
      decoded.offset! > options.total
    ) {
      throw new Error("cursor mismatch");
    }
    return decoded.offset!;
  } catch {
    throw invalidArgument(
      "The comparison cursor is invalid, targets changed files, or belongs to different options.",
      "cursor",
      [
        "Restart comparison pagination without a cursor using the current baseline and candidate refs.",
      ],
    );
  }
}

function pageResult<T>(
  items: T[],
  offset: number,
  limit: number,
  view: Exclude<AnalysisView, "summary">,
  projectDigest: string,
) {
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    page: {
      returned: pageItems.length,
      total: items.length,
      limit,
      ...(nextOffset < items.length
        ? {
            nextCursor: encodeCursor({
              version: 1,
              view,
              offset: nextOffset,
              projectDigest,
            }),
          }
        : {}),
    },
  };
}

function comparisonPageResult<T>(
  items: T[],
  offset: number,
  limit: number,
  options: {
    baselineDigest: string;
    candidateDigest: string;
    topologyMode: "direct-only" | "known-board-v1.3.5";
    includeGeometry: boolean;
  },
) {
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    page: {
      returned: pageItems.length,
      total: items.length,
      limit,
      ...(nextOffset < items.length
        ? {
            nextCursor: encodeComparisonCursor({
              version: 1,
              kind: "crumb-comparison",
              view: "components",
              offset: nextOffset,
              baselineDigest: options.baselineDigest,
              candidateDigest: options.candidateDigest,
              topologyMode: options.topologyMode,
              includeGeometry: options.includeGeometry,
            }),
          }
        : {}),
    },
  };
}

const ElectronicsCapabilitiesOutputSchema = envelopeSchema(
  CapabilitiesDataSchema,
);
const electronicsCapabilitiesTool = server.registerTool(
  "electronics_capabilities",
  {
    title: "Orient to Circuitarium MCP",
    description:
      "Zero-argument onboarding for model-neutral conventions, callable backends, truthful limitations, and recommended workflows. Call this first when unsure.",
    inputSchema: ElectronicsCapabilitiesInputSchema,
    outputSchema: ElectronicsCapabilitiesOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () =>
    successResult({
      summary:
        "The experimental CRUMBLE integration provides one local CRUMB file backend; live simulation backends remain external or planned.",
      data: {
        server: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
          transport: "stdio",
          contractVersion: CONTRACT_VERSION,
          crossModelHandoff: "artifact-ref-and-digest",
          sharedSessionsAcrossHosts: false,
        },
        filesystem: {
          rootRef: ".",
          pathStyle: "workspace-relative-posix",
          maxCruBytes: MAX_CRU_BYTES,
          maxCruComparisonBytes: MAX_CRU_COMPARISON_BYTES,
          writesOverwriteExistingFiles: false,
        },
        portableExperiment: {
          schemaVersion: "0.1",
          concerns: [...GENERAL_TOOLSET.concerns],
          fidelityLevels: [...GENERAL_TOOLSET.fidelityLevels],
          validationTool: "electronics_validate_experiment",
        },
        callableBackends: CALLABLE_BACKENDS,
        roadmapBackends: ROADMAP_BACKENDS,
        workflows: WORKFLOWS,
        vocabulary: [...VOCABULARY],
        toolConventions: {
          validationFailureIsToolError: false,
          paginationCursorIsOpaque: true,
          embeddedSourceReturnedByDefault: false,
          embeddedBinaryReturnedByDefault: false,
          rawCruXmlReturnedByDefault: false,
          callCapabilitiesWhenUnsure: true,
        },
      },
      nextActions: [
        {
          tool: "crumb_analyze_design",
          reason: "Understand an existing CRUMB design with a bounded summary.",
          arguments: {
            path: "fixtures/crumb/breadboard-resistor.cru",
            view: "summary",
          },
        },
        {
          tool: "electronics_validate_experiment",
          reason: "Validate a simulator-neutral electronics experiment.",
          arguments: {
            experiment: {
              schemaVersion: "0.1",
              id: "minimal-check",
              title: "Minimal portable experiment",
              components: [],
              nets: [],
              execution: {
                fidelity: "behavioral",
                pacing: "as-fast-as-possible",
              },
            },
          },
        },
      ],
    }),
);
envelopeTools.set("electronics_capabilities", {
  inputSchema: ElectronicsCapabilitiesInputSchema,
  outputSchema: ElectronicsCapabilitiesOutputSchema,
  registeredTool: electronicsCapabilitiesTool,
  context: makeContext,
});

const ElectronicsExperimentOutputSchema = envelopeSchema(
  ExperimentValidationDataSchema,
);
const electronicsExperimentTool = server.registerTool(
  "electronics_validate_experiment",
  {
    title: "Validate a portable electronics experiment",
    description:
      "Checks an arbitrary JSON value against the simulator-neutral circuit, firmware, probe, assertion, and timing contract. Invalid input returns ok=true and data.valid=false with diagnostics.",
    inputSchema: ElectronicsExperimentInputSchema,
    outputSchema: ElectronicsExperimentOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ experiment }) => {
    const validation = validateExperiment(experiment);
    const normalized = validation.experiment;
    const projectDigest =
      normalized === undefined ? undefined : sha256(canonicalJson(normalized));
    const errorCount = validation.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ).length;
    return successResult({
      summary: validation.valid
        ? "The portable electronics experiment is valid."
        : `Validation completed and found ${errorCount} error${errorCount === 1 ? "" : "s"}.`,
      data: {
        valid: validation.valid,
        ...(normalized === undefined
          ? {}
          : {
              schemaVersion: normalized.schemaVersion,
              projectDigest,
              counts: {
                components: normalized.components.length,
                nets: normalized.nets.length,
                firmware: normalized.firmware.length,
                probes: normalized.probes.length,
                assertions: normalized.assertions.length,
              },
            }),
      },
      diagnostics: validation.diagnostics,
      context: makeContext({
        ...(projectDigest === undefined ? {} : { projectDigest }),
      }),
      nextActions: validation.valid
        ? []
        : [
            {
              tool: "electronics_capabilities",
              reason: "Review the neutral experiment model and workflow conventions.",
              arguments: {},
            },
          ],
    });
  },
);
envelopeTools.set("electronics_validate_experiment", {
  inputSchema: ElectronicsExperimentInputSchema,
  outputSchema: ElectronicsExperimentOutputSchema,
  registeredTool: electronicsExperimentTool,
  context: makeContext,
});

const CrumbCatalogOutputSchema = envelopeSchema(CrumbCatalogDataSchema);
const crumbCatalogTool = server.registerTool(
  "crumb_component_catalog",
  {
    title: "List recognized CRUMB component schemas",
    description:
      "Returns the version-pinned CRUMB tool-ID catalog, payload signatures, typed parameters, terminal labels, confidence values, and their machine-readable evidence vocabulary. Optionally filter by toolId.",
    inputSchema: CrumbCatalogInputSchema,
    outputSchema: CrumbCatalogOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ toolId }) => {
    const allDefinitions = listCrumbComponentDefinitions();
    const definitions =
      toolId === undefined
        ? allDefinitions
        : allDefinitions.filter((definition) => definition.toolId === toolId);
    const matched = definitions.length > 0;
    const icVariants =
      toolId === undefined || toolId === 5 ? listCrumbIcs() : undefined;
    return successResult({
      summary:
        toolId === undefined
          ? `The adapter recognizes ${definitions.length} version-pinned CRUMB component schemas.`
          : matched
            ? `Tool ID ${toolId} is recognized.`
            : `Tool ID ${toolId} is not semantically recognized yet.`,
      data: {
        catalogVersion: "crumb.catalog/0.2",
        backendId: CRUMB_BACKEND_ID,
        testedCompatibility: ADAPTER_TESTED_CRUMB_COMPATIBILITY,
        evidenceVocabulary: listCrumbEvidenceVocabulary(),
        ...(toolId === undefined ? {} : { requestedToolId: toolId }),
        matched,
        definitionCount: definitions.length,
        definitions,
        ...(icVariants === undefined ? {} : { icVariants }),
      },
      diagnostics: matched
        ? []
        : [
            {
              severity: "warning",
              code: "unsupported-component",
              path: "toolId",
              message: `CRUMB tool ID ${toolId} has no verified semantic schema in this adapter.`,
            },
          ],
      context: makeCrumbContext(),
    });
  },
);
envelopeTools.set("crumb_component_catalog", {
  inputSchema: CrumbCatalogInputSchema,
  outputSchema: CrumbCatalogOutputSchema,
  registeredTool: crumbCatalogTool,
  context: makeCrumbContext,
});

const CrumbAnalysisOutputSchema = envelopeSchema(CrumbAnalysisDataSchema);
const crumbAnalysisTool = server.registerTool(
  "crumb_analyze_design",
  {
    title: "Analyze a CRUMB design semantically",
    description:
      "Recognizes version-pinned component parameters, terminal attachments, and inferred connection groups. Summary is the bounded default; components and connections use opaque cursors. Embedded firmware and geometry require explicit opt-in.",
    inputSchema: CrumbAnalyzeInputSchema,
    outputSchema: CrumbAnalysisOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    path,
    expectedProjectDigest,
    view,
    cursor,
    limit,
    includeGeometry,
    includeSourceCode,
    topologyMode,
  }) => {
    let operationContext = makeCrumbContext();
    try {
      const file = await readCruFile(path);
      const ref = workspaceRef(file.path);
      const project = crumbArtifact(file.xml, ref, file);
      operationContext = makeCrumbContext({
        projectRef: ref,
        projectDigest: project.digest,
      });
      requireExpectedProjectDigest(expectedProjectDigest, project.digest);
      const structuralValidation = validateCru(file.xml);
      if (!structuralValidation.valid) {
        throw new ContractFailure({
          code: "PROJECT_INVALID",
          category: "project",
          message:
            "The CRUMB save has structural errors and cannot be analyzed safely.",
          retryable: false,
          recovery: [
            "Call crumb_validate_design for detailed structural diagnostics.",
            "Repair or restore the save before semantic analysis.",
          ],
        });
      }
      const includeDetailedComponents = view === "components";
      const effectiveLimit =
        includeDetailedComponents && includeSourceCode
          ? Math.min(limit, 5)
          : includeDetailedComponents && includeGeometry
            ? Math.min(limit, 25)
            : limit;
      const analysis = analyzeCru(file.xml, {
        includeGeometry: includeDetailedComponents && includeGeometry,
        includeSourceCode: includeDetailedComponents && includeSourceCode,
        topologyMode,
      });
      const total =
        view === "components"
          ? analysis.components.length
          : view === "connections"
            ? analysis.connectivity.groups.length
            : 0;
      const offset = decodeCursor(cursor, view, project.digest, total);
      const responseDiagnostics = [
        ...structuralValidation.diagnostics,
        ...analysis.diagnostics,
      ];
      if (effectiveLimit !== limit) {
        responseDiagnostics.push({
          severity: "info",
          code: "page-limit-reduced",
          path: "limit",
          message: includeSourceCode
            ? "Component pages with embedded source are capped at 5 items."
            : "Component pages with geometry are capped at 25 items.",
        });
      }

      const baseData = {
        analysisVersion: analysis.analysisVersion,
        view,
        project: {
          ...project,
          ref,
        },
        designName: analysis.designName,
        designNameInfo: analysis.designNameInfo,
        summary: analysis.summary,
        connectivity: {
          scope: analysis.connectivity.scope,
          confidence: analysis.connectivity.confidence,
          topologyMode: analysis.connectivity.topologyMode,
          topologyLinksApplied: analysis.connectivity.topologyLinksApplied,
          groupCount: analysis.connectivity.groupCount,
          isolatedAttachmentGroupCount:
            analysis.connectivity.isolatedAttachmentGroupCount,
          limitations: analysis.connectivity.limitations,
        },
        conversion: {
          portableDraftStatus: analysis.conversion.portableDraftStatus,
          safeForAutomaticConversion:
            analysis.conversion.safeForAutomaticConversion,
          losses: analysis.conversion.losses.map((loss) => ({
            category: loss.category,
            message: loss.message,
            componentCount: loss.componentIds.length,
            componentIdSample: loss.componentIds.slice(0, 20),
            sampleTruncated: loss.componentIds.length > 20,
          })),
        },
        disclosure: {
          geometryIncluded: includeDetailedComponents && includeGeometry,
          sourceCodeIncluded: includeDetailedComponents && includeSourceCode,
          embeddedBinaryIncluded: false as const,
          annotationTextMode: "untrusted-bounded-preview" as const,
          rawXmlIncluded: false as const,
          limits: {
            designNamePreviewCharacters:
              MAX_DESIGN_NAME_PREVIEW_CHARACTERS,
            componentGeometryPoints:
              MAX_COMPONENT_GEOMETRY_POINTS_RETURNED,
            componentTerminals: MAX_COMPONENT_TERMINALS_RETURNED,
            componentPayloadEntries:
              MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
            unknownPayloadKeysPerComponent:
              MAX_UNKNOWN_PAYLOAD_KEYS_RETURNED_PER_COMPONENT,
            parameterCollectionItems:
              MAX_PARAMETER_COLLECTION_ITEMS_RETURNED,
            connectionGroupMembersPerField:
              MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
            kindCounts: MAX_KIND_COUNTS_RETURNED,
            diagnostics: MAX_RESULT_DIAGNOSTICS_RETURNED,
            diagnosticCodeCharacters: MAX_DIAGNOSTIC_CODE_CHARACTERS,
            diagnosticPathCharacters: MAX_DIAGNOSTIC_PATH_CHARACTERS,
            diagnosticMessageCharacters:
              MAX_DIAGNOSTIC_MESSAGE_CHARACTERS,
            cruXsiTypeCharacters: MAX_CRU_XSI_TYPE_CHARACTERS,
            cruNumericLexicalCharacters:
              MAX_CRU_NUMERIC_LEXICAL_CHARACTERS,
            cruGuidTokenCharacters: MAX_CRU_GUID_TOKEN_CHARACTERS,
            cruXmlNameCharacters: MAX_CRU_XML_NAME_CHARACTERS,
            cruTextNodeCharacters: MAX_CRU_TEXT_NODE_CHARACTERS,
            cruMarkupDelimiters: MAX_CRU_MARKUP_DELIMITERS,
            cruDocumentCharacters: MAX_CRU_DOCUMENT_CHARACTERS,
          },
        },
      };

      let data;
      let nextActions: NextAction[];
      if (view === "components") {
        const paged = pageResult(
          analysis.components,
          offset,
          effectiveLimit,
          "components",
          project.digest,
        );
        data = { ...baseData, page: paged.page, components: paged.items };
        nextActions = paged.page.nextCursor
          ? [
              {
                tool: "crumb_analyze_design",
                reason: "Continue the component inventory without overlap.",
                arguments: {
                  path: ref,
                  view,
                  cursor: paged.page.nextCursor,
                  limit: effectiveLimit,
                  includeGeometry,
                  includeSourceCode,
                  topologyMode,
                  expectedProjectDigest: project.digest,
                },
              },
            ]
          : [
              {
                tool: "crumb_analyze_design",
                reason: "Inspect inferred electrical connection groups.",
                arguments: {
                  path: ref,
                  view: "connections",
                  limit: 50,
                  topologyMode,
                  expectedProjectDigest: project.digest,
                },
              },
            ];
      } else if (view === "connections") {
        const paged = pageResult(
          analysis.connectivity.groups,
          offset,
          effectiveLimit,
          "connections",
          project.digest,
        );
        data = { ...baseData, page: paged.page, connections: paged.items };
        nextActions = paged.page.nextCursor
          ? [
              {
                tool: "crumb_analyze_design",
                reason: "Continue the connection inventory without overlap.",
                arguments: {
                  path: ref,
                  view,
                  cursor: paged.page.nextCursor,
                  limit: effectiveLimit,
                  topologyMode,
                  expectedProjectDigest: project.digest,
                },
              },
            ]
          : [];
      } else {
        data = baseData;
        nextActions = [
          {
            tool: "crumb_analyze_design",
            reason: "Read recognized component parameters and attachments.",
            arguments: {
              path: ref,
              view: "components",
              limit: 50,
              topologyMode,
              expectedProjectDigest: project.digest,
            },
          },
          {
            tool: "crumb_analyze_design",
            reason: "Read inferred electrical connection groups.",
            arguments: {
              path: ref,
              view: "connections",
              limit: 50,
              topologyMode,
              expectedProjectDigest: project.digest,
            },
          },
          {
            tool: "crumb_validate_design",
            reason: "Check structural validity before opening or sharing the file.",
            arguments: {
              path: ref,
              expectedProjectDigest: project.digest,
            },
          },
        ];
      }

      return successResult({
        summary: `Analyzed ${analysis.summary.componentCount} components and ${analysis.connectivity.groupCount} connection groups.`,
        data,
        diagnostics: responseDiagnostics,
        context: operationContext,
        nextActions,
      });
    } catch (error) {
      return errorResult(error, {
        fallback: "FORMAT_INVALID",
        context: operationContext,
      });
    }
  },
);
envelopeTools.set("crumb_analyze_design", {
  inputSchema: CrumbAnalyzeInputSchema,
  outputSchema: CrumbAnalysisOutputSchema,
  registeredTool: crumbAnalysisTool,
  context: makeCrumbContext,
});

const CrumbComparisonOutputSchema = envelopeSchema(
  CrumbComparisonDataSchema,
);
const crumbComparisonTool = server.registerTool(
  "crumb_compare_designs",
  {
    title: "Compare CRUMB files under the Unity profile",
    description:
      "Read-only, GUID-matched comparison of a baseline and candidate .cru under crumb.unity/1.3.5. Distinguishes exact bytes, modeled equivalence, root changes, component changes, and unverified payload signatures without returning raw XML, firmware, EEPROM bytes, or thumbnails.",
    inputSchema: CrumbCompareInputSchema,
    outputSchema: CrumbComparisonOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    baselinePath,
    candidatePath,
    expectedBaselineDigest,
    expectedCandidateDigest,
    compatibilityProfile,
    view,
    cursor,
    limit,
    includeGeometry,
    topologyMode,
  }) => {
    let operationContext = makeCrumbContext();
    try {
      const readComparisonFile = async (
        path: string,
        argumentPath: "baselinePath" | "candidatePath",
      ) => {
        try {
          return await readCruFile(path);
        } catch (error) {
          const details = classifyError(error, "FORMAT_INVALID");
          throw new ContractFailure({
            ...details,
            argumentPath:
              details.argumentPath === undefined ||
              details.argumentPath === "path"
                ? argumentPath
                : details.argumentPath,
          });
        }
      };
      const [baselineFile, candidateFile] = await Promise.all([
        readComparisonFile(baselinePath, "baselinePath"),
        readComparisonFile(candidatePath, "candidatePath"),
      ]);
      requireCruComparisonSize(
        baselineFile.bytes,
        candidateFile.bytes,
      );
      const baselineRef = workspaceRef(baselineFile.path);
      const candidateRef = workspaceRef(candidateFile.path);
      const baselineProject = crumbArtifact(
        baselineFile.xml,
        baselineRef,
        baselineFile,
      );
      const candidateProject = crumbArtifact(
        candidateFile.xml,
        candidateRef,
        candidateFile,
      );

      operationContext = makeCrumbContext({
        projectRef: baselineRef,
        projectDigest: baselineProject.digest,
      });
      requireExpectedProjectDigest(
        expectedBaselineDigest,
        baselineProject.digest,
        "expectedBaselineDigest",
      );
      operationContext = makeCrumbContext({
        projectRef: candidateRef,
        projectDigest: candidateProject.digest,
      });
      requireExpectedProjectDigest(
        expectedCandidateDigest,
        candidateProject.digest,
        "expectedCandidateDigest",
      );

      const baselineValidation = validateCru(baselineFile.xml);
      if (!baselineValidation.valid) {
        operationContext = makeCrumbContext({
          projectRef: baselineRef,
          projectDigest: baselineProject.digest,
        });
        throw new ContractFailure({
          code: "PROJECT_INVALID",
          category: "project",
          message:
            "The baseline CRUMB save has structural errors and cannot be compared safely.",
          retryable: false,
          argumentPath: "baselinePath",
          recovery: [
            "Call crumb_validate_design for the baseline artifact.",
            "Repair or restore the baseline before comparing it.",
          ],
        });
      }
      const candidateValidation = validateCru(candidateFile.xml);
      if (!candidateValidation.valid) {
        throw new ContractFailure({
          code: "PROJECT_INVALID",
          category: "project",
          message:
            "The candidate CRUMB save has structural errors and cannot be compared safely.",
          retryable: false,
          argumentPath: "candidatePath",
          recovery: [
            "Call crumb_validate_design for the candidate artifact.",
            "Repair or restore the candidate before comparing it.",
          ],
        });
      }

      const comparison = compareCru(
        baselineFile.xml,
        candidateFile.xml,
        {
          includeGeometry,
          topologyMode,
          baselineByteDigest: baselineFile.digest,
          candidateByteDigest: candidateFile.digest,
        },
      );
      const effectiveLimit = includeGeometry ? Math.min(limit, 25) : limit;
      const offset = decodeComparisonCursor(cursor, {
        view,
        baselineDigest: baselineProject.digest,
        candidateDigest: candidateProject.digest,
        topologyMode,
        includeGeometry,
        total: comparison.componentChanges.length,
      });
      const baseData = {
        comparisonVersion: comparison.comparisonVersion,
        view,
        compatibilityProfile,
        topologyMode: comparison.topologyMode,
        baseline: { ...baselineProject, ref: baselineRef },
        candidate: { ...candidateProject, ref: candidateRef },
        equivalence: comparison.equivalence,
        profileAssessment: comparison.profileAssessment,
        summary: comparison.summary,
        schemaCandidates: comparison.schemaCandidates,
        schemaCandidateBounds: comparison.schemaCandidateBounds,
        disclosure: {
          ...comparison.disclosure,
          geometryIncluded:
            view === "components" && comparison.disclosure.geometryIncluded,
        },
        limitations: comparison.limitations,
      };
      let data: Record<string, unknown> = baseData;
      let nextActions: NextAction[] = [];

      if (view === "root") {
        data = { ...baseData, root: comparison.root };
        if (comparison.componentChanges.length > 0) {
          nextActions = [
            {
              tool: "crumb_compare_designs",
              reason: "Inspect the bounded component changes.",
              arguments: {
                baselinePath: baselineRef,
                candidatePath: candidateRef,
                expectedBaselineDigest: baselineProject.digest,
                expectedCandidateDigest: candidateProject.digest,
                view: "components",
                limit: effectiveLimit,
                includeGeometry,
                topologyMode,
              },
            },
          ];
        }
      } else if (view === "components") {
        const paged = comparisonPageResult(
          comparison.componentChanges,
          offset,
          effectiveLimit,
          {
            baselineDigest: baselineProject.digest,
            candidateDigest: candidateProject.digest,
            topologyMode,
            includeGeometry,
          },
        );
        data = {
          ...baseData,
          page: paged.page,
          componentChanges: paged.items,
        };
        nextActions =
          paged.page.nextCursor === undefined
            ? []
            : [
                {
                  tool: "crumb_compare_designs",
                  reason:
                    "Continue the component comparison without overlap.",
                  arguments: {
                    baselinePath: baselineRef,
                    candidatePath: candidateRef,
                    expectedBaselineDigest: baselineProject.digest,
                    expectedCandidateDigest: candidateProject.digest,
                    view,
                    cursor: paged.page.nextCursor,
                    limit: effectiveLimit,
                    includeGeometry,
                    topologyMode,
                  },
                },
              ];
      } else {
        if (comparison.summary.rootFieldChangeCount > 0) {
          nextActions.push({
            tool: "crumb_compare_designs",
            reason: "Inspect the modeled root and metadata changes.",
            arguments: {
              baselinePath: baselineRef,
              candidatePath: candidateRef,
              expectedBaselineDigest: baselineProject.digest,
              expectedCandidateDigest: candidateProject.digest,
              view: "root",
              topologyMode,
            },
          });
        }
        if (comparison.componentChanges.length > 0) {
          nextActions.push({
            tool: "crumb_compare_designs",
            reason: "Inspect the bounded component changes.",
            arguments: {
              baselinePath: baselineRef,
              candidatePath: candidateRef,
              expectedBaselineDigest: baselineProject.digest,
              expectedCandidateDigest: candidateProject.digest,
              view: "components",
              limit: effectiveLimit,
              includeGeometry,
              topologyMode,
            },
          });
        }
      }

      return successResult({
        summary:
          comparison.equivalence.assessment === "exact"
            ? "The baseline and candidate CRUMB saves are byte-identical."
            : `Compared the .cru files under crumb.unity/1.3.5: ${comparison.equivalence.assessment}; ${comparison.componentChanges.length} component change${comparison.componentChanges.length === 1 ? "" : "s"} and ${comparison.summary.rootFieldChangeCount} root-field change${comparison.summary.rootFieldChangeCount === 1 ? "" : "s"}.`,
        data,
        diagnostics: comparison.diagnostics,
        context: operationContext,
        nextActions,
      });
    } catch (error) {
      return errorResult(error, {
        fallback: "FORMAT_INVALID",
        context: operationContext,
      });
    }
  },
);
envelopeTools.set("crumb_compare_designs", {
  inputSchema: CrumbCompareInputSchema,
  outputSchema: CrumbComparisonOutputSchema,
  registeredTool: crumbComparisonTool,
  context: makeCrumbContext,
});

const CrumbInspectionOutputSchema = envelopeSchema(CrumbInspectionDataSchema);
const crumbInspectionTool = server.registerTool(
  "crumb_inspect_design",
  {
    title: "Inspect compact CRUMB metadata",
    description:
      "Returns a bounded save summary and tool-ID counts. Use crumb_analyze_design for paginated semantic component and connection details.",
    inputSchema: CrumbArtifactReadInputSchema,
    outputSchema: CrumbInspectionOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, expectedProjectDigest }) => {
    let operationContext = makeCrumbContext();
    try {
      const file = await readCruFile(path);
      const ref = workspaceRef(file.path);
      const inspection = inspectCru(file.xml);
      const project = crumbArtifact(file.xml, ref, file);
      operationContext = makeCrumbContext({
        projectRef: ref,
        projectDigest: project.digest,
      });
      requireExpectedProjectDigest(expectedProjectDigest, project.digest);
      return successResult({
        summary: `Inspected ${inspection.componentCount} CRUMB components.`,
        data: {
          project: { ...project, ref },
          inspection: compactInspection(inspection),
        },
        context: operationContext,
        nextActions: [
          {
            tool: "crumb_analyze_design",
            reason: "Get a semantic, version-pinned understanding of the design.",
            arguments: {
              path: ref,
              view: "summary",
              expectedProjectDigest: project.digest,
            },
          },
        ],
      });
    } catch (error) {
      return errorResult(error, {
        fallback: "FORMAT_INVALID",
        context: operationContext,
      });
    }
  },
);
envelopeTools.set("crumb_inspect_design", {
  inputSchema: CrumbArtifactReadInputSchema,
  outputSchema: CrumbInspectionOutputSchema,
  registeredTool: crumbInspectionTool,
  context: makeCrumbContext,
});

const CrumbValidationOutputSchema = envelopeSchema(CrumbValidationDataSchema);
const crumbValidationTool = server.registerTool(
  "crumb_validate_design",
  {
    title: "Validate a CRUMB design",
    description:
      "Performs XML and CRUMB structural checks without launching the game. A bad design returns ok=true and data.valid=false.",
    inputSchema: CrumbArtifactReadInputSchema,
    outputSchema: CrumbValidationOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, expectedProjectDigest }) => {
    let operationContext = makeCrumbContext();
    try {
      const file = await readCruFile(path);
      const ref = workspaceRef(file.path);
      const validation = validateCru(file.xml);
      const project = crumbArtifact(file.xml, ref, file);
      operationContext = makeCrumbContext({
        projectRef: ref,
        projectDigest: project.digest,
      });
      requireExpectedProjectDigest(expectedProjectDigest, project.digest);
      const errorCount = validation.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ).length;
      return successResult({
        summary: validation.valid
          ? "The CRUMB design is structurally valid."
          : `Validation completed and found ${errorCount} structural error${errorCount === 1 ? "" : "s"}.`,
        data: {
          project: { ...project, ref },
          valid: validation.valid,
          ...(validation.inspection === undefined
            ? {}
            : { inspection: compactInspection(validation.inspection) }),
        },
        diagnostics: validation.diagnostics,
        context: operationContext,
        nextActions: validation.valid
          ? [
              {
                tool: "crumb_analyze_design",
                reason: "Understand recognized components and inferred connections.",
                arguments: {
                  path: ref,
                  view: "summary",
                  expectedProjectDigest: project.digest,
                },
              },
            ]
          : [],
      });
    } catch (error) {
      return errorResult(error, {
        context: operationContext,
      });
    }
  },
);
envelopeTools.set("crumb_validate_design", {
  inputSchema: CrumbArtifactReadInputSchema,
  outputSchema: CrumbValidationOutputSchema,
  registeredTool: crumbValidationTool,
  context: makeCrumbContext,
});

const CrumbFixtureOutputSchema = envelopeSchema(CrumbFixtureDataSchema);
const crumbFixtureTool = server.registerTool(
  "crumb_generate_fixture",
  {
    title: "Generate a synthetic CRUMB fixture",
    description:
      "Creates one known fixture without overwriting. Provide outputPath for a file artifact; raw XML is returned only when includeXml=true.",
    inputSchema: CrumbFixtureInputSchema,
    outputSchema: CrumbFixtureOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ kind, name, outputPath, includeXml }) => {
    try {
      if (outputPath === undefined && !includeXml) {
        throw invalidArgument(
          "Provide outputPath, or explicitly set includeXml=true for an in-memory artifact.",
          "outputPath",
          ["Set outputPath to a new .cru project ref.", "Set includeXml=true."],
        );
      }
      const xml = generateFixture(kind as CrumbFixtureKind, name);
      const validation = validateCru(xml);
      let ref: string | undefined;
      if (outputPath !== undefined) {
        const writtenPath = await writeCruFile(outputPath, xml, {
          overwrite: false,
          createParent: true,
        });
        ref = workspaceRef(writtenPath);
      }
      const project = crumbArtifact(xml, ref);
      return successResult({
        summary:
          ref === undefined
            ? `Generated the ${kind} CRUMB fixture in memory.`
            : `Generated and validated ${ref}.`,
        data: {
          kind,
          project,
          valid: validation.valid,
          ...(includeXml ? { xml } : {}),
        },
        diagnostics: validation.diagnostics,
        context: makeCrumbContext({
          ...(ref === undefined ? {} : { projectRef: ref }),
          projectDigest: project.digest,
        }),
        nextActions:
          ref === undefined
            ? []
            : [
                {
                  tool: "crumb_analyze_design",
                  reason: "Confirm the generated component and connection semantics.",
                  arguments: {
                    path: ref,
                    view: "summary",
                    expectedProjectDigest: project.digest,
                  },
                },
              ],
      });
    } catch (error) {
      return errorResult(error, {
        context: makeCrumbContext(),
      });
    }
  },
);
envelopeTools.set("crumb_generate_fixture", {
  inputSchema: CrumbFixtureInputSchema,
  outputSchema: CrumbFixtureOutputSchema,
  registeredTool: crumbFixtureTool,
  context: makeCrumbContext,
});

/**
 * McpServer normally validates tool arguments before invoking a registered
 * callback. Its validation failure is plain text, so it cannot carry this
 * server's typed envelope or CRUMB compatibility profile. Replace only the
 * public underlying tools/call handler: tools/list remains SDK-generated from
 * the original strict schemas, while this dispatcher validates those same
 * schemas and preserves the uniform result contract.
 */
server.server.removeRequestHandler("tools/call");
server.server.setRequestHandler(
  CallToolRequestSchema,
  async (request, extra) => {
    const registration = envelopeTools.get(request.params.name);
    if (registration === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: "MCP error -32602: Requested tool is not registered.",
          },
        ],
        isError: true as const,
      };
    }

    const context = registration.context();
    const parsedArguments = await registration.inputSchema.safeParseAsync(
      request.params.arguments ?? {},
    );
    if (!parsedArguments.success) {
      const issue = parsedArguments.error.issues[0];
      const argumentPath =
        issue === undefined || issue.path.length === 0
          ? "arguments"
          : issue.path.map((segment) => String(segment)).join(".");
      return errorResult(
        invalidArgument(
          `Invalid arguments for ${request.params.name}: ${
            issue?.message ?? "the input does not match the published schema"
          }`,
          argumentPath,
          [
            `Use the published input schema for ${request.params.name} and retry.`,
            "Call electronics_capabilities if the intended workflow is unclear.",
          ],
        ),
        { context },
      );
    }

    try {
      const handler = registration.registeredTool.handler;
      if (typeof handler !== "function") {
        throw new Error("Task-based tools are not supported by this dispatcher");
      }
      const invoke = handler as unknown as (
        args: unknown,
        handlerExtra: typeof extra,
      ) => unknown | Promise<unknown>;
      const rawResult = await invoke(parsedArguments.data, extra);
      const callResult = await CallToolResultSchema.safeParseAsync(rawResult);
      if (!callResult.success) {
        throw new Error("The tool returned an invalid MCP CallToolResult");
      }
      const output = await registration.outputSchema.safeParseAsync(
        callResult.data.structuredContent,
      );
      if (!output.success) {
        throw new Error("The tool returned structured content outside its output schema");
      }
      return callResult.data;
    } catch (error) {
      return errorResult(error, { context });
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
