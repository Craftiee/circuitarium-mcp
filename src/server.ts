#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  analyzeCru,
  fullConnectionGroupMembership,
} from "./adapters/crumb/analyze.js";
import { buildBom } from "./adapters/crumb/bom.js";
import { listCrumbComponentDefinitions } from "./adapters/crumb/catalog.js";
import { compareCru } from "./adapters/crumb/compare.js";
import { CRUMB_COMPATIBILITY_PROFILE } from "./adapters/crumb/compatibility.js";
import { checkNetlist } from "./adapters/crumb/erc.js";
import { listCrumbEvidenceVocabulary } from "./adapters/crumb/evidence.js";
import { buildNetlist } from "./adapters/crumb/netlist.js";
import {
  CRUMB_FIXTURE_KINDS,
  generateFixture,
  type CrumbFixtureKind,
} from "./adapters/crumb/fixtures.js";
import {
  CruFormatError,
  decodeCru,
  inspectCru,
  validateCru,
  type CruDecodedDataValue,
  type CruInspection,
} from "./adapters/crumb/format.js";
import {
  CRUMB_IC_CATALOG_TARGET,
  listCrumbIcs,
} from "./adapters/crumb/icCatalog.js";
import {
  CruFileChangedDuringReadError,
  CruFileTooLargeError,
  listCruFiles,
  MAX_CRU_BYTES,
  NotADirectoryError,
  NotAFileError,
  readCruFile,
  UnsupportedCruPathError,
  workspaceRef,
  WorkspacePathDeniedError,
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
  MAX_CRU_COMPONENTS,
  MAX_CRU_DATA_VALUES_PER_COMPONENT,
  MAX_CRU_GUID_TOKEN_CHARACTERS,
  MAX_CRU_NUMERIC_LEXICAL_CHARACTERS,
  MAX_CRU_XML_DEPTH,
  MAX_CRU_XML_ELEMENTS,
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
import { validateExperiment, type Diagnostic } from "./domain/experiment.js";
import {
  CapabilitiesDataSchema,
  CrumbAnalysisDataSchema,
  CrumbBomDataSchema,
  CrumbCatalogDataSchema,
  CrumbComparisonDataSchema,
  CrumbComponentDetailDataSchema,
  CrumbErcDataSchema,
  CrumbFixtureDataSchema,
  CrumbIcReferenceDataSchema,
  CrumbInspectionDataSchema,
  CrumbNetlistDataSchema,
  CrumbValidationDataSchema,
  CrumbWorkspaceDataSchema,
  ExperimentValidationDataSchema,
} from "./domain/toolSchemas.js";
import { SERVER_NAME } from "./identity.js";
import { executeServerCommand, processCommandIo } from "./terminal.js";

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
const MAX_DIGEST_BYTES_PER_LISTING = 256 * 1024 * 1024;
const MAX_CRU_COMPARISON_BYTES = 5 * 1024 * 1024;

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
const CrumbListProjectsInputSchema = z.object({
  dir: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .default(".")
    .describe("Workspace-relative directory ref to list"),
  recursive: z.boolean().default(true),
  includeDigests: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(100),
});
const CrumbGetComponentInputSchema = z.object({
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
  componentId: z
    .string()
    .min(1)
    .max(128)
    .describe("Component id from analyze/netlist output; matching is case-insensitive"),
  includeGeometry: z.boolean().default(true),
  includeSourceCode: z.boolean().default(false),
  sourceOffset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Character offset into embedded firmware source for continued reads"),
  topologyMode: z
    .enum(["direct-only", "known-board-v1.3.5"])
    .default("known-board-v1.3.5"),
});
const CrumbBomInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative .cru project ref"),
  expectedProjectDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
const CrumbIcReferenceInputSchema = z.object({
  prefabId: z.number().int().nonnegative().optional(),
  query: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe("Case-insensitive substring matched against IC label and package name"),
});
const CrumbNetlistInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative .cru project ref"),
  expectedProjectDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional(),
  topologyMode: z
    .enum(["direct-only", "known-board-v1.3.5"])
    .default("known-board-v1.3.5"),
  applySwitchStates: z
    .boolean()
    .default(false)
    .describe("Merge nets across saved switch positions using installed-build semantics"),
  cursor: z.string().min(1).max(MAX_CURSOR_CHARACTERS).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
const CrumbErcInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative .cru project ref"),
  expectedProjectDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional(),
  topologyMode: z
    .enum(["direct-only", "known-board-v1.3.5"])
    .default("known-board-v1.3.5"),
  applySwitchStates: z.boolean().default(false),
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
      "Call electronics_capabilities first when the workflow is unclear. All tools use electronics.mcp/0.2 envelopes: ok=false means the tool call failed, while ok=true with data.valid=false means validation ran and found an invalid design. Use workspace-relative project refs, SHA-256 digests, and compatibilityProfile for handoff between ChatGPT, Claude, and local models. The component catalog returns machine-readable evidenceVocabulary; do not treat confidence strings as electrical-model accuracy. CRUMBLE is Circuitarium MCP's experimental integration family for CRUMB-specific rulesets and file interoperability. Its callable backend reads and writes save files only; it does not control a live simulation. CRUMB topology is version-pinned to the observed CRUMB 1.3.5 Unity save format and is not a claim of compatibility with newer Godot builds.",
  },
);

function sha256(value: string | Buffer): string {
  const hash = createHash("sha256");
  if (typeof value === "string") {
    hash.update(value, "utf8");
  } else {
    hash.update(value);
  }
  return `sha256:${hash.digest("hex")}`;
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
        // Compact serialization: hosts that surface only text content still
        // receive the full envelope, without pretty-printing token overhead.
        text: JSON.stringify(envelope),
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

  const filesystemCode = nodeErrorCode(error);
  if (error instanceof WorkspacePathDeniedError) {
    return {
      code: "PATH_DENIED",
      category: "filesystem",
      message: "The requested path is outside the configured MCP workspace.",
      retryable: false,
      recovery: ["Use a workspace-relative path returned by another tool."],
    };
  }
  if (filesystemCode === "ENOENT" || error instanceof NotAFileError) {
    return {
      code: "NOT_FOUND",
      category: "filesystem",
      message:
        error instanceof NotAFileError
          ? "The requested path exists but is not a regular file."
          : "The requested file or parent directory does not exist.",
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
  if (error instanceof CruFileTooLargeError) {
    return {
      code: "QUOTA_EXCEEDED",
      category: "filesystem",
      message: `The file exceeds the fixed ${MAX_CRU_BYTES}-byte safety limit.`,
      retryable: false,
      recovery: [
        "Work with a smaller .cru file; the byte limit is fixed in this build.",
      ],
    };
  }
  if (error instanceof CruFileChangedDuringReadError) {
    return {
      code: "PROJECT_STATE_CONFLICT",
      category: "project",
      message: "The project changed while one coherent file snapshot was being read.",
      retryable: true,
      recovery: ["Wait for the save operation to finish, then retry the read."],
    };
  }
  if (error instanceof UnsupportedCruPathError) {
    return {
      code: "UNSUPPORTED_FORMAT",
      category: "format",
      message: "CRUMB file tools require a path ending in .cru.",
      retryable: false,
      argumentPath: "path",
      recovery: ["Pass a .cru project ref."],
    };
  }
  if (error instanceof NotADirectoryError) {
    return {
      code: "INVALID_ARGUMENT",
      category: "argument",
      message: "The requested directory ref is not a directory.",
      retryable: false,
      argumentPath: "dir",
      recovery: ["Pass a workspace-relative directory ref, or omit dir for the root."],
    };
  }
  if (fallback === "FORMAT_INVALID" || error instanceof CruFormatError) {
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

function crumbArtifact(content: string | Buffer, ref?: string) {
  const bytes =
    typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return {
    ...(ref === undefined ? {} : { ref }),
    format: "crumb-cru" as const,
    mediaType: "application/vnd.crumb.cru+xml" as const,
    bytes: bytes.byteLength,
    digest: sha256(bytes),
    adapterTestedCompatibility: ADAPTER_TESTED_CRUMB_COMPATIBILITY,
  };
}

type AnalysisView = "summary" | "components" | "connections";
type PagedView =
  | "components"
  | "connections"
  | "netlist"
  | "comparison-components";

interface PageCursor {
  version: 2;
  view: PagedView;
  offset: number;
  projectDigest: string;
  optionsFingerprint: string;
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function paginationOptionsFingerprint(options: Record<string, unknown>): string {
  return sha256(canonicalJson(options));
}

function decodeCursor(
  value: string | undefined,
  view: PagedView | "summary",
  projectDigest: string,
  total: number,
  optionsFingerprint: string,
): number {
  if (value === undefined) {
    return 0;
  }
  if (view === "summary") {
    throw invalidArgument(
      "Pagination cursors are only valid for paginated views.",
      "cursor",
      ["Remove cursor or select a paginated view."],
    );
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<PageCursor>;
    if (
      decoded.version !== 2 ||
      decoded.view !== view ||
      decoded.projectDigest !== projectDigest ||
      decoded.optionsFingerprint !== optionsFingerprint ||
      !Number.isInteger(decoded.offset) ||
      decoded.offset! < 0 ||
      decoded.offset! > total
    ) {
      throw new Error("cursor mismatch");
    }
    return decoded.offset!;
  } catch {
    throw invalidArgument(
      "The cursor is invalid, belongs to another view or option set, or targets a changed project.",
      "cursor",
      ["Restart pagination without a cursor using the current project ref."],
    );
  }
}

function pageResult<T>(
  items: T[],
  offset: number,
  limit: number,
  view: PagedView,
  projectDigest: string,
  optionsFingerprint: string,
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
              version: 2,
              view,
              offset: nextOffset,
              projectDigest,
              optionsFingerprint,
            }),
          }
        : {}),
    },
  };
}

/**
 * Shared read path for the semantic artifact tools: containment-checked read,
 * digest guard before any parse work, structural gate (PROJECT_INVALID), then
 * bounded analysis. publishContext runs as soon as the project identity is
 * known so error envelopes still carry the ref and digest.
 */
async function loadAnalyzedCruProject(
  args: {
    path: string;
    expectedProjectDigest: string | undefined;
    topologyMode?: "direct-only" | "known-board-v1.3.5";
    includeGeometry?: boolean;
  },
  publishContext: (context: ContractContext) => void,
) {
  const file = await readCruFile(args.path);
  const ref = workspaceRef(file.path);
  const project = crumbArtifact(file.bytes, ref);
  const context = makeCrumbContext({
    projectRef: ref,
    projectDigest: project.digest,
  });
  publishContext(context);
  requireExpectedProjectDigest(args.expectedProjectDigest, project.digest);
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
  const analysis = analyzeCru(file.xml, {
    includeGeometry: args.includeGeometry ?? false,
    includeSourceCode: false,
    topologyMode: args.topologyMode ?? "known-board-v1.3.5",
  });
  return {
    file,
    ref,
    project,
    context,
    structuralDiagnostics: structuralValidation.diagnostics,
    analysis,
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
      const project = crumbArtifact(file.bytes, ref);
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
      const optionsFingerprint = paginationOptionsFingerprint({
        topologyMode,
        ...(view === "components"
          ? {
              includeGeometry,
              includeSourceCode,
            }
          : {}),
      });
      const offset = decodeCursor(
        cursor,
        view,
        project.digest,
        total,
        optionsFingerprint,
      );
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
            cruXmlElements: MAX_CRU_XML_ELEMENTS,
            cruXmlDepth: MAX_CRU_XML_DEPTH,
            cruComponents: MAX_CRU_COMPONENTS,
            cruDataValuesPerComponent:
              MAX_CRU_DATA_VALUES_PER_COMPONENT,
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
          optionsFingerprint,
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
          optionsFingerprint,
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

const CrumbComparisonOutputSchema = envelopeSchema(CrumbComparisonDataSchema);
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
        maxBytes: number,
      ) => {
        try {
          return await readCruFile(path, { maxBytes });
        } catch (error) {
          if (error instanceof CruFileTooLargeError) {
            throw new ContractFailure({
              code: "QUOTA_EXCEEDED",
              category: "filesystem",
              message:
                `The baseline and candidate must fit the ` +
                `${MAX_CRU_COMPARISON_BYTES}-byte combined comparison limit.`,
              retryable: false,
              argumentPath,
              recovery: [
                "Compare smaller .cru artifacts or reduce the size of the other comparison input.",
              ],
            });
          }
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

      // Read stable snapshots under one combined budget. The second read gets
      // only the exact bytes left after the baseline, so oversized comparisons
      // fail before both payloads are held in memory.
      const baselineFile = await readComparisonFile(
        baselinePath,
        "baselinePath",
        MAX_CRU_COMPARISON_BYTES,
      );
      const candidateFile = await readComparisonFile(
        candidatePath,
        "candidatePath",
        MAX_CRU_COMPARISON_BYTES - baselineFile.bytes.byteLength,
      );
      const baselineRef = workspaceRef(baselineFile.path);
      const candidateRef = workspaceRef(candidateFile.path);
      const baselineProject = crumbArtifact(baselineFile.bytes, baselineRef);
      const candidateProject = crumbArtifact(candidateFile.bytes, candidateRef);

      // Publish and enforce both raw-byte identities before parsing either
      // artifact. This keeps cross-model handoff guards stronger than format
      // diagnostics, including for malformed or invalid UTF-8 saves.
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

      const effectiveIncludeGeometry =
        view === "components" && includeGeometry;
      const comparison = compareCru(baselineFile.xml, candidateFile.xml, {
        includeGeometry: effectiveIncludeGeometry,
        topologyMode,
        baselineByteDigest: baselineProject.digest,
        candidateByteDigest: candidateProject.digest,
      });
      const effectiveLimit = effectiveIncludeGeometry
        ? Math.min(limit, 25)
        : limit;
      const optionsFingerprint = paginationOptionsFingerprint({
        baselineDigest: baselineProject.digest,
        candidateDigest: candidateProject.digest,
        topologyMode,
        includeGeometry: effectiveIncludeGeometry,
      });
      if (view !== "components" && cursor !== undefined) {
        throw invalidArgument(
          "Pagination cursors are only valid for the components comparison view.",
          "cursor",
          ["Remove cursor or select view=components."],
        );
      }
      const offset =
        view === "components"
          ? decodeCursor(
              cursor,
              "comparison-components",
              candidateProject.digest,
              comparison.componentChanges.length,
              optionsFingerprint,
            )
          : 0;
      const responseDiagnostics: Diagnostic[] = [...comparison.diagnostics];
      if (effectiveLimit !== limit) {
        responseDiagnostics.push({
          severity: "info",
          code: "page-limit-reduced",
          path: "limit",
          message: "Component comparison pages with geometry are capped at 25 items.",
        });
      }

      const baseData = {
        comparisonVersion: comparison.comparisonVersion,
        view,
        compatibilityProfile,
        topologyMode: comparison.topologyMode,
        baseline: baselineProject,
        candidate: candidateProject,
        equivalence: comparison.equivalence,
        profileAssessment: comparison.profileAssessment,
        summary: comparison.summary,
        schemaCandidates: comparison.schemaCandidates,
        schemaCandidateBounds: comparison.schemaCandidateBounds,
        disclosure: {
          ...comparison.disclosure,
          geometryIncluded: effectiveIncludeGeometry,
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
        const paged = pageResult(
          comparison.componentChanges,
          offset,
          effectiveLimit,
          "comparison-components",
          candidateProject.digest,
          optionsFingerprint,
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
                  reason: "Continue the component comparison without overlap.",
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
      const project = crumbArtifact(file.bytes, ref);
      operationContext = makeCrumbContext({
        projectRef: ref,
        projectDigest: project.digest,
      });
      requireExpectedProjectDigest(expectedProjectDigest, project.digest);
      const inspection = inspectCru(file.xml);
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
      const project = crumbArtifact(file.bytes, ref);
      operationContext = makeCrumbContext({
        projectRef: ref,
        projectDigest: project.digest,
      });
      requireExpectedProjectDigest(expectedProjectDigest, project.digest);
      const validation = validateCru(file.xml);
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

const CrumbWorkspaceOutputSchema = envelopeSchema(CrumbWorkspaceDataSchema);
const crumbListProjectsTool = server.registerTool(
  "crumb_list_projects",
  {
    title: "List CRUMB projects in the workspace",
    description:
      "Enumerates .cru files under the workspace root (or one subdirectory) with size, modification time, and SHA-256 digest, so a model can discover projects without being handed a path.",
    inputSchema: CrumbListProjectsInputSchema,
    outputSchema: CrumbWorkspaceOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ dir, recursive, includeDigests, limit }) => {
    try {
      const listing = await listCruFiles(dir, { recursive });
      const bounded = boundCollection(listing.entries, limit);
      const entries: Array<{
        ref: string;
        bytes: number;
        mtime: string;
        digest?: string;
        digestOmittedReason?:
          | "file-exceeds-size-limit"
          | "not-requested"
          | "unreadable"
          | "digest-budget-exhausted";
      }> = [];
      let digestBytesRead = 0;
      for (const entry of bounded.items) {
        if (!includeDigests) {
          entries.push({ ...entry, digestOmittedReason: "not-requested" as const });
        } else if (digestBytesRead >= MAX_DIGEST_BYTES_PER_LISTING) {
          entries.push({
            ...entry,
            digestOmittedReason: "digest-budget-exhausted" as const,
          });
        } else {
          try {
            const file = await readCruFile(entry.ref, {
              maxBytes: MAX_DIGEST_BYTES_PER_LISTING - digestBytesRead,
            });
            digestBytesRead += file.bytes.byteLength;
            entries.push({
              ref: entry.ref,
              bytes: file.bytes.byteLength,
              mtime: file.mtime,
              digest: sha256(file.bytes),
            });
          } catch (error) {
            if (error instanceof CruFileTooLargeError) {
              entries.push({
                ref: entry.ref,
                bytes: error.observedBytes ?? entry.bytes,
                mtime: error.observedMtime ?? entry.mtime,
                digestOmittedReason:
                  (error.observedBytes ?? entry.bytes) > MAX_CRU_BYTES
                    ? "file-exceeds-size-limit"
                    : "digest-budget-exhausted",
              });
            } else {
              entries.push({
                ...entry,
                digestOmittedReason: "unreadable" as const,
              });
            }
          }
        }
      }
      const diagnostics: Diagnostic[] = [];
      if (listing.scanTruncated) {
        diagnostics.push({
          severity: "warning",
          code: "directory-scan-truncated",
          path: "scan",
          message:
            "The directory walk stopped at its fixed entry budget; deeper files were not seen.",
        });
      }
      if (bounded.bounds.truncated) {
        diagnostics.push({
          severity: "warning",
          code: "listing-truncated",
          path: "entries",
          message: `Returned ${bounded.bounds.returned} of ${bounded.bounds.total} .cru files; raise limit or narrow dir.`,
        });
      }
      if (
        entries.some(
          (entry) => entry.digestOmittedReason === "digest-budget-exhausted",
        )
      ) {
        diagnostics.push({
          severity: "warning",
          code: "digest-budget-exhausted",
          path: "entries",
          message:
            `Digest computation stopped after ${MAX_DIGEST_BYTES_PER_LISTING} bytes for this call; ` +
            "narrow dir or lower limit to digest the remaining files.",
        });
      }
      return successResult({
        summary: `Found ${bounded.bounds.total} .cru file(s); returned ${entries.length}.`,
        data: {
          listingVersion: "crumb.workspace/0.1" as const,
          rootRef: "." as const,
          dirRef: workspaceRef(dir),
          recursive,
          scan: {
            scannedEntries: listing.scannedEntries,
            scanTruncated: listing.scanTruncated,
          },
          entries,
          entryBounds: bounded.bounds,
        },
        diagnostics,
        context: makeCrumbContext(),
        nextActions:
          entries[0] === undefined
            ? [
                {
                  tool: "crumb_generate_fixture",
                  reason: "No projects exist yet; create a known-good fixture to explore.",
                  arguments: { kind: "breadboard-led", outputPath: "generated/first-led.cru" },
                },
              ]
            : [
                {
                  tool: "crumb_analyze_design",
                  reason: "Understand the first discovered project.",
                  arguments: {
                    path: entries[0].ref,
                    view: "summary",
                    ...(entries[0].digest === undefined
                      ? {}
                      : { expectedProjectDigest: entries[0].digest }),
                  },
                },
              ],
      });
    } catch (error) {
      return errorResult(error, { context: makeCrumbContext() });
    }
  },
);
envelopeTools.set("crumb_list_projects", {
  inputSchema: CrumbListProjectsInputSchema,
  outputSchema: CrumbWorkspaceOutputSchema,
  registeredTool: crumbListProjectsTool,
  context: makeCrumbContext,
});

const CrumbComponentDetailOutputSchema = envelopeSchema(
  CrumbComponentDetailDataSchema,
);
const crumbGetComponentTool = server.registerTool(
  "crumb_get_component",
  {
    title: "Fetch one CRUMB component in full detail",
    description:
      "Returns a single component by id with parameters, terminals, geometry, its inferred connection groups, and windowed access to embedded firmware source past the analyze cap. The read-back companion for iterative work on one part.",
    inputSchema: CrumbGetComponentInputSchema,
    outputSchema: CrumbComponentDetailOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    path,
    expectedProjectDigest,
    componentId,
    includeGeometry,
    includeSourceCode,
    sourceOffset,
    topologyMode,
  }) => {
    let operationContext = makeCrumbContext();
    try {
      const loaded = await loadAnalyzedCruProject(
        { path, expectedProjectDigest, topologyMode, includeGeometry },
        (context) => {
          operationContext = context;
        },
      );
      const component = loaded.analysis.components.find(
        (candidate) => candidate.id.toLowerCase() === componentId.toLowerCase(),
      );
      if (component === undefined) {
        throw new ContractFailure({
          code: "NOT_FOUND",
          category: "project",
          message: `No component with id ${componentId} exists in this design.`,
          retryable: false,
          argumentPath: "componentId",
          recovery: [
            "List component ids with crumb_analyze_design view=components.",
          ],
        });
      }
      const componentKey = component.id.toLowerCase();
      const relatedGroups = loaded.analysis.connectivity.groups
        .filter((group) =>
          fullConnectionGroupMembership(group).componentTerminals.some(
            (terminal) =>
              terminal.componentId.toLowerCase() === componentKey,
          ),
        )
        .map((group) => {
          const fullTerminals =
            fullConnectionGroupMembership(group).componentTerminals;
          const focused = fullTerminals.filter(
            (terminal) =>
              terminal.componentId.toLowerCase() === componentKey,
          );
          const retained = group.componentTerminals.filter(
            (terminal) =>
              terminal.componentId.toLowerCase() !== componentKey,
          );
          return {
            ...group,
            componentTerminals: [...focused, ...retained].slice(
              0,
              MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
            ),
          };
        });
      const boundedGroups = boundCollection(relatedGroups, 32);
      const componentDiagnosticPrefix = `components.${component.index}`;
      const diagnostics: Diagnostic[] = [
        ...loaded.structuralDiagnostics,
        ...loaded.analysis.diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === "connection-membership-truncated" ||
            diagnostic.path === componentDiagnosticPrefix ||
            diagnostic.path.startsWith(`${componentDiagnosticPrefix}.`),
        ),
      ];

      let sourceWindow:
        | {
            offset: number;
            totalCharacters: number;
            returnedCharacters: number;
            content: string;
            truncated: boolean;
            nextOffset?: number;
          }
        | undefined;
      if (includeSourceCode) {
        if (component.sourceCode === undefined) {
          diagnostics.push({
            severity: "info",
            code: "no-embedded-source",
            path: "sourceWindow",
            message:
              "This component carries no readable embedded firmware source; sourceWindow is omitted.",
          });
        } else {
          const decoded = decodeCru(loaded.file.xml);
          const raw = decoded.components.find(
            (candidate) => candidate.index === component.index,
          );
          const strings =
            raw?.values.filter(
              (value): value is Extract<CruDecodedDataValue, { kind: "string" }> =>
                value.kind === "string",
            ) ?? [];
          const source = strings[0]?.value ?? "";
          const content = source.slice(sourceOffset, sourceOffset + 65_536);
          const nextOffset = sourceOffset + content.length;
          sourceWindow = {
            offset: sourceOffset,
            totalCharacters: source.length,
            returnedCharacters: content.length,
            content,
            truncated: nextOffset < source.length,
            ...(nextOffset < source.length ? { nextOffset } : {}),
          };
        }
      }

      return successResult({
        summary: `Returned ${component.kind} ${component.id} with ${boundedGroups.bounds.total} related connection group(s).`,
        data: {
          detailVersion: "crumb.component/0.1" as const,
          project: { ...loaded.project, ref: loaded.ref },
          topologyMode,
          component,
          connections: boundedGroups.items,
          connectionBounds: boundedGroups.bounds,
          ...(sourceWindow === undefined ? {} : { sourceWindow }),
        },
        diagnostics,
        context: operationContext,
        nextActions:
          sourceWindow?.truncated === true
            ? [
                {
                  tool: "crumb_get_component",
                  reason: "Continue reading the embedded firmware source.",
                  arguments: {
                    path: loaded.ref,
                    componentId: component.id,
                    includeGeometry,
                    includeSourceCode: true,
                    sourceOffset: sourceWindow.nextOffset ?? 0,
                    topologyMode,
                    expectedProjectDigest: loaded.project.digest,
                  },
                },
              ]
            : [
                {
                  tool: "crumb_export_netlist",
                  reason: "See every electrical net this component participates in.",
                  arguments: {
                    path: loaded.ref,
                    topologyMode,
                    expectedProjectDigest: loaded.project.digest,
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
envelopeTools.set("crumb_get_component", {
  inputSchema: CrumbGetComponentInputSchema,
  outputSchema: CrumbComponentDetailOutputSchema,
  registeredTool: crumbGetComponentTool,
  context: makeCrumbContext,
});

const CrumbBomOutputSchema = envelopeSchema(CrumbBomDataSchema);
const crumbBomTool = server.registerTool(
  "crumb_bom",
  {
    title: "Build a bill of materials",
    description:
      "Groups recognized components by kind and decoded part values into quantities. State values such as switch positions are excluded from part identity; unknown and schema-mismatched components stay visible as their own lines.",
    inputSchema: CrumbBomInputSchema,
    outputSchema: CrumbBomOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, expectedProjectDigest, limit }) => {
    let operationContext = makeCrumbContext();
    try {
      const loaded = await loadAnalyzedCruProject(
        { path, expectedProjectDigest },
        (context) => {
          operationContext = context;
        },
      );
      const bom = buildBom(loaded.analysis, limit);
      const diagnostics: Diagnostic[] = [
        ...loaded.structuralDiagnostics,
        ...loaded.analysis.diagnostics,
      ];
      if (bom.lineBounds.truncated) {
        diagnostics.push({
          severity: "warning",
          code: "bom-lines-truncated",
          path: "lines",
          message: `Returned ${bom.lineBounds.returned} of ${bom.lineBounds.total} BOM lines; raise limit for the rest.`,
        });
      }
      return successResult({
        summary: `Grouped ${bom.totals.components} component(s) into ${bom.totals.distinctLines} BOM line(s).`,
        data: {
          bomVersion: bom.bomVersion,
          project: { ...loaded.project, ref: loaded.ref },
          designName: loaded.analysis.designName,
          designNameInfo: loaded.analysis.designNameInfo,
          totals: bom.totals,
          lines: bom.lines,
          lineBounds: bom.lineBounds,
        },
        diagnostics,
        context: operationContext,
        nextActions: [
          {
            tool: "crumb_export_netlist",
            reason: "Promote connection groups to named electrical nets.",
            arguments: {
              path: loaded.ref,
              expectedProjectDigest: loaded.project.digest,
            },
          },
          {
            tool: "crumb_check_design",
            reason: "Run electrical rule checks over the design.",
            arguments: {
              path: loaded.ref,
              expectedProjectDigest: loaded.project.digest,
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
envelopeTools.set("crumb_bom", {
  inputSchema: CrumbBomInputSchema,
  outputSchema: CrumbBomOutputSchema,
  registeredTool: crumbBomTool,
  context: makeCrumbContext,
});

const CrumbIcReferenceOutputSchema = envelopeSchema(CrumbIcReferenceDataSchema);
const crumbIcReferenceTool = server.registerTool(
  "crumb_ic_reference",
  {
    title: "Look up CRUMB IC packages and pinouts",
    description:
      "Queries the version-pinned tool-5 IC registry by prefabId or by a label/package substring (for example \"74HC138\"). Returns package labels, ordered pin names, and explicit unresolved pins.",
    inputSchema: CrumbIcReferenceInputSchema,
    outputSchema: CrumbIcReferenceOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ prefabId, query }) => {
    const allVariants = listCrumbIcs();
    const normalizedQuery = query?.toLowerCase();
    const variants = allVariants.filter(
      (variant) =>
        (prefabId === undefined || variant.prefabId === prefabId) &&
        (normalizedQuery === undefined ||
          variant.label.toLowerCase().includes(normalizedQuery) ||
          variant.packageName.toLowerCase().includes(normalizedQuery)),
    );
    const matched = variants.length > 0;
    return successResult({
      summary: matched
        ? `Matched ${variants.length} version-pinned IC package(s).`
        : "No version-pinned IC package matches the request.",
      data: {
        referenceVersion: "crumb.ic-reference/0.1" as const,
        backendId: "crumb.file" as const,
        catalogTarget: { ...CRUMB_IC_CATALOG_TARGET },
        ...(prefabId === undefined ? {} : { requestedPrefabId: prefabId }),
        ...(query === undefined ? {} : { query }),
        matched,
        variantCount: variants.length,
        variants,
      },
      diagnostics: matched
        ? []
        : [
            {
              severity: "warning",
              code: "unsupported-component",
              path: prefabId === undefined ? "query" : "prefabId",
              message:
                "No tool-5 prefab in the version-pinned registry matches; the part may exist in CRUMB without adapter evidence.",
            },
          ],
      context: makeCrumbContext(),
      nextActions: [
        {
          tool: "crumb_component_catalog",
          reason: "Read the full tool-5 payload signature and evidence vocabulary.",
          arguments: { toolId: 5 },
        },
      ],
    });
  },
);
envelopeTools.set("crumb_ic_reference", {
  inputSchema: CrumbIcReferenceInputSchema,
  outputSchema: CrumbIcReferenceOutputSchema,
  registeredTool: crumbIcReferenceTool,
  context: makeCrumbContext,
});

const CrumbNetlistOutputSchema = envelopeSchema(CrumbNetlistDataSchema);
const crumbNetlistTool = server.registerTool(
  "crumb_export_netlist",
  {
    title: "Export named electrical nets",
    description:
      "Collapses jumper wires out of the inferred connection graph and returns paged electrical nets with component terminals, VCC/GND names inferred from DC supply terminals, and optional saved-switch-state merges. Provenance and confidence are explicit.",
    inputSchema: CrumbNetlistInputSchema,
    outputSchema: CrumbNetlistOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    path,
    expectedProjectDigest,
    topologyMode,
    applySwitchStates,
    cursor,
    limit,
  }) => {
    let operationContext = makeCrumbContext();
    try {
      const loaded = await loadAnalyzedCruProject(
        { path, expectedProjectDigest, topologyMode },
        (context) => {
          operationContext = context;
        },
      );
      const netlist = buildNetlist(loaded.analysis, { applySwitchStates });
      const optionsFingerprint = paginationOptionsFingerprint({
        topologyMode,
        applySwitchStates,
      });
      const offset = decodeCursor(
        cursor,
        "netlist",
        loaded.project.digest,
        netlist.nets.length,
        optionsFingerprint,
      );
      const paged = pageResult(
        netlist.nets,
        offset,
        limit,
        "netlist",
        loaded.project.digest,
        optionsFingerprint,
      );
      const diagnostics: Diagnostic[] = [
        ...loaded.structuralDiagnostics,
        ...loaded.analysis.diagnostics,
        ...netlist.diagnostics,
      ];
      return successResult({
        summary: `Exported ${netlist.stats.netCount} net(s), ${netlist.stats.namedNetCount} named, ${netlist.stats.floatingTerminalCount} floating terminal(s).`,
        data: {
          netlistVersion: netlist.netlistVersion,
          project: { ...loaded.project, ref: loaded.ref },
          topologyMode: netlist.topologyMode,
          scope: netlist.scope,
          provenance: netlist.provenance,
          stats: netlist.stats,
          page: paged.page,
          nets: paged.items,
          floatingTerminals: netlist.floatingTerminals,
          floatingTerminalBounds: netlist.floatingTerminalBounds,
        },
        diagnostics,
        context: operationContext,
        nextActions: paged.page.nextCursor
          ? [
              {
                tool: "crumb_export_netlist",
                reason: "Continue the net inventory without overlap.",
                arguments: {
                  path: loaded.ref,
                  cursor: paged.page.nextCursor,
                  limit,
                  topologyMode,
                  applySwitchStates,
                  expectedProjectDigest: loaded.project.digest,
                },
              },
            ]
          : [
              {
                tool: "crumb_check_design",
                reason: "Run electrical rule checks over these nets.",
                arguments: {
                  path: loaded.ref,
                  topologyMode,
                  applySwitchStates,
                  expectedProjectDigest: loaded.project.digest,
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
envelopeTools.set("crumb_export_netlist", {
  inputSchema: CrumbNetlistInputSchema,
  outputSchema: CrumbNetlistOutputSchema,
  registeredTool: crumbNetlistTool,
  context: makeCrumbContext,
});

const CrumbErcOutputSchema = envelopeSchema(CrumbErcDataSchema);
const crumbErcTool = server.registerTool(
  "crumb_check_design",
  {
    title: "Run electrical rule checks",
    description:
      "Lints the inferred netlist: supply shorts, LEDs directly across the rails, shorted two-terminal parts, floating IC power pins, resistor power ratings, and floating terminals. Findings carry evidence confidence and rule basis; a rule violation returns ok=true with data.valid=false.",
    inputSchema: CrumbErcInputSchema,
    outputSchema: CrumbErcOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, expectedProjectDigest, topologyMode, applySwitchStates }) => {
    let operationContext = makeCrumbContext();
    try {
      const loaded = await loadAnalyzedCruProject(
        { path, expectedProjectDigest, topologyMode },
        (context) => {
          operationContext = context;
        },
      );
      const netlist = buildNetlist(loaded.analysis, { applySwitchStates });
      const report = checkNetlist(loaded.analysis, netlist);
      const diagnostics: Diagnostic[] = [
        ...loaded.structuralDiagnostics,
        ...loaded.analysis.diagnostics,
        ...netlist.diagnostics,
      ];
      return successResult({
        summary: report.valid
          ? `Electrical rule check passed with ${report.totals.warnings} warning(s).`
          : `Electrical rule check found ${report.totals.errors} error(s) and ${report.totals.warnings} warning(s).`,
        data: {
          ercVersion: report.ercVersion,
          project: { ...loaded.project, ref: loaded.ref },
          valid: report.valid,
          topologyMode,
          applySwitchStates,
          ruleSet: report.ruleSet,
          totals: report.totals,
          findings: report.findings,
          findingBounds: report.findingBounds,
          limitations: report.limitations,
        },
        diagnostics,
        context: operationContext,
        nextActions: [
          {
            tool: "crumb_export_netlist",
            reason: "Inspect the nets each finding references.",
            arguments: {
              path: loaded.ref,
              topologyMode,
              applySwitchStates,
              expectedProjectDigest: loaded.project.digest,
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
envelopeTools.set("crumb_check_design", {
  inputSchema: CrumbErcInputSchema,
  outputSchema: CrumbErcOutputSchema,
  registeredTool: crumbErcTool,
  context: makeCrumbContext,
});

/**
 * Validates arguments against the published input schema, invokes the
 * registered handler, and enforces both the MCP result shape and the tool's
 * envelope output schema. Shared by the stdio dispatcher and the local CLI so
 * both surfaces run identical validation, bounding, and error envelopes.
 */
async function invokeEnvelopeTool(
  registration: EnvelopeToolRegistration,
  name: string,
  rawArguments: unknown,
  extra: unknown,
) {
  const context = registration.context();
  const parsedArguments = await registration.inputSchema.safeParseAsync(
    rawArguments ?? {},
  );
  if (!parsedArguments.success) {
    const issue = parsedArguments.error.issues[0];
    const argumentPath =
      issue === undefined || issue.path.length === 0
        ? "arguments"
        : issue.path.map((segment) => String(segment)).join(".");
    return errorResult(
      invalidArgument(
        `Invalid arguments for ${name}: ${
          issue?.message ?? "the input does not match the published schema"
        }`,
        argumentPath,
        [
          `Use the published input schema for ${name} and retry.`,
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
}

/**
 * In-process tool invocation for the CLI: the same schemas, handlers, and
 * envelopes as the stdio surface, without a transport.
 */
export async function callToolLocally(
  name: string,
  args: unknown,
): Promise<{ envelope: Record<string, unknown>; isError: boolean }> {
  const registration = envelopeTools.get(name);
  if (registration === undefined) {
    throw new Error(`Tool is not registered: ${name}`);
  }
  const result = (await invokeEnvelopeTool(registration, name, args, {})) as {
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  return {
    envelope: result.structuredContent ?? {},
    isError: result.isError ?? false,
  };
}

export function listRegisteredToolNames(): string[] {
  return [...envelopeTools.keys()];
}

export async function startStdioServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

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
    return invokeEnvelopeTool(
      registration,
      request.params.name,
      request.params.arguments,
      extra,
    );
  },
);

function invokedAsMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    const entryHref = pathToFileURL(realpathSync(entry)).href;
    return process.platform === "win32"
      ? entryHref.toLowerCase() === import.meta.url.toLowerCase()
      : entryHref === import.meta.url;
  } catch {
    return false;
  }
}

// Importers (the CLI, tests) get the registered tools without a transport;
// only direct execution serves stdio.
if (invokedAsMainModule()) {
  const exitCode = await executeServerCommand(
    process.argv.slice(2),
    async () => {
      await startStdioServer();
      return listRegisteredToolNames().length;
    },
    processCommandIo(),
  );
  process.exitCode = exitCode;
}
