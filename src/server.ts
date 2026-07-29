#!/usr/bin/env node

import { randomUUID } from "node:crypto";
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
  CRUMB_NET_TRACE_TRAVERSAL_VERSION,
  CrumbTraceSelectionError,
  buildCrumbNetTrace,
} from "./adapters/crumb/trace.js";
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
  listLogisimFiles,
  logisimWorkspaceRef,
  LogisimFileChangedDuringReadError,
  LogisimFileTooLargeError,
  LogisimNotADirectoryError,
  LogisimNotAFileError,
  LogisimWorkspacePathDeniedError,
  readLogisimFile,
  readLogisimVectorFile,
  UnsupportedLogisimPathError,
} from "./adapters/logisim/io.js";
import {
  LOGISIM_ADAPTER_VERSION,
  LOGISIM_BACKEND_ID,
  LOGISIM_COMPATIBILITY_PROFILE,
  LogisimFormatError,
  MAX_LOGISIM_CIRC_BYTES,
  assessLogisimRuntimeSafety,
  normalizeLogisim410TtyPinLabel,
  summarizeLogisimCircuitIo,
  type LogisimProject,
} from "./adapters/logisim/model.js";
import {
  logisimProjectToIr,
  parseLogisimCircBytes,
} from "./adapters/logisim/parser.js";
import {
  LogisimDisplayUnavailableError,
  LogisimRuntimeError,
  LogisimRuntimeVersionMismatchError,
  probeLogisimRuntime,
  resolveLogisimRuntimeConfig,
  runLogisimStatisticsWithRuntime,
  runLogisimTestVectorWithRuntime,
  runLogisimTruthTableWithRuntime,
  type LogisimRuntimeProbe,
} from "./adapters/logisim/runtime.js";
import {
  LogisimRuntimeJarStagingError,
  withStagedLogisimArtifacts,
} from "./adapters/logisim/staging.js";
import {
  CALLABLE_BACKENDS,
  GENERAL_TOOLSET,
  ROADMAP_BACKENDS,
  VOCABULARY,
  WORKFLOWS,
  type CallableBackendDescriptor,
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
  canonicalJson,
  sha256Bytes,
  sha256Text,
} from "./domain/canonical.js";
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
  KNOWLEDGE_PROMPT_NAMES,
  KNOWLEDGE_RESOURCE_URIS,
  registerKnowledgeSurfaces,
} from "./domain/knowledge.js";
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
  CrumbNetTraceDataSchema,
  CrumbValidationDataSchema,
  CrumbWorkspaceDataSchema,
  ExperimentValidationDataSchema,
} from "./domain/toolSchemas.js";
import {
  LogisimAnalysisDataSchema,
  LogisimComponentStatsDataSchema,
  MAX_LOGISIM_PUBLIC_STRING_CHARACTERS,
  LogisimNetlistDataSchema,
  LogisimTestVectorDataSchema,
  LogisimTruthTableDataSchema,
  LogisimWorkspaceDataSchema,
} from "./domain/logisimToolSchemas.js";
import {
  VerificationPlanDataSchema,
  VerificationPlanInputSchema,
  planVerification,
} from "./domain/verification.js";
import {
  RUN_RECORD_AUTHENTICITY,
  RUN_RECORD_RESOURCE_URI,
  RUN_RECORD_VERSION,
  RunRecordValidationDataSchema,
  RunRecordValidationInputSchema,
  validateAndSealRunRecord,
  validateAndSealSerializedRunRecord,
} from "./domain/runRecord.js";
import { runDoctor } from "./doctor.js";
import { SERVER_NAME } from "./identity.js";
import {
  executeServerCommand,
  processCommandIo,
  type DoctorCommandOptions,
} from "./terminal.js";

const CRUMB_BACKEND_ID = "crumb.file";
const CRUMB_ADAPTER_VERSION = "crumb.file/0.2";
const ADAPTER_TESTED_CRUMB_COMPATIBILITY = ["CRUMB 1.3.5 (Unity save format)"];
const LOGISIM_RUNTIME_VERSION = "4.1.0";
const MAX_LOGISIM_CIRCUITS_RETURNED = 128;
const MAX_LOGISIM_LIBRARIES_RETURNED = 128;
const MAX_LOGISIM_PINS_RETURNED = 256;
const MAX_LOGISIM_COMPONENT_TYPES_RETURNED = 256;
const MAX_LOGISIM_IR_LOSSES_RETURNED = 128;
const MAX_LOGISIM_NET_NODES_RETURNED = 256;
const MAX_LOGISIM_NET_WIRES_RETURNED = 512;
const MAX_LOGISIM_NET_MEMBERS_RETURNED = 256;
const MAX_LOGISIM_TEST_MISMATCHES_RETURNED = 256;
const MAX_LOGISIM_TRUTH_TABLE_INPUT_BITS = 12;
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
  outputPath: z.string().min(1).max(MAX_PROJECT_REF_CHARACTERS).optional(),
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
    .describe(
      "Component id from analyze/netlist output; matching is case-insensitive",
    ),
  includeGeometry: z.boolean().default(true),
  includeSourceCode: z.boolean().default(false),
  sourceOffset: z
    .number()
    .int()
    .min(1)
    .default(0)
    .describe(
      "Character offset into embedded firmware source for continued reads",
    ),
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
    .describe(
      "Case-insensitive substring matched against IC label and package name",
    ),
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
    .describe(
      "Merge nets across saved switch positions using installed-build semantics",
    ),
  cursor: z.string().min(1).max(MAX_CURSOR_CHARACTERS).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
const CrumbNetTraceInputSchema = z.object({
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
  componentId: z
    .string()
    .min(1)
    .max(128)
    .describe("Case-insensitive component id from CRUMB analysis"),
  terminalIndex: z
    .number()
    .int()
    .nonnegative()
    .max(65_535)
    .describe(
      "Zero-based terminal index; canonical within the exact project bytes",
    ),
  expectedTerminalName: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe("Optional exact-name guard for cross-model handoff"),
  topologyMode: z
    .enum(["direct-only", "known-board-v1.3.5"])
    .default("known-board-v1.3.5"),
  applySwitchStates: z
    .boolean()
    .default(false)
    .describe(
      "Apply persisted switch closures as conditional installed-build evidence",
    ),
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
const LogisimProjectReadInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative .circ project ref"),
  expectedProjectDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional()
    .describe("Optional sha256: digest from a prior cross-model handoff"),
  circuit: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe("Circuit name; defaults to the declared main circuit"),
});
const LogisimListProjectsInputSchema = z.object({
  dir: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .default(".")
    .describe("Workspace-relative directory ref to list"),
  recursive: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(100),
});
const LogisimNetlistInputSchema = LogisimProjectReadInputSchema.extend({
  cursor: z.string().min(1).max(MAX_CURSOR_CHARACTERS).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
const LogisimComponentStatsInputSchema = LogisimProjectReadInputSchema.extend({
  limit: z.number().int().min(1).max(2_048).default(256),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(15_000),
});
const LogisimTruthTableInputSchema = LogisimProjectReadInputSchema.extend({
  maxInputBits: z
    .number()
    .int()
    .min(1)
    .max(MAX_LOGISIM_TRUTH_TABLE_INPUT_BITS)
    .default(8),
  limit: z.number().int().min(1).max(4_096).default(256),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(15_000),
});
const LogisimTestVectorInputSchema = LogisimProjectReadInputSchema.extend({
  vectorPath: z
    .string()
    .min(1)
    .max(MAX_PROJECT_REF_CHARACTERS)
    .describe("Workspace-relative .vec or .txt test-vector ref"),
  expectedVectorDigest: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DIGEST_CHARACTERS)
    .optional(),
  maxFailures: z.number().int().min(1).max(1_024).default(100),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(15_000),
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
      "Call electronics_capabilities first when the workflow is unclear. Read circuitarium://capabilities or a narrower Circuitarium resource for static reference knowledge, and use the registered prompts only when the user explicitly chooses a reusable workflow. Component profiles and catalogs are source-cited planning knowledge: identity-only entries assert no ports or behavior, and semantic concepts never imply cross-simulator equivalence. electronics_plan_verification only organizes caller-reported, digest- and locus-bound evidence; it does not read files, run tools, authenticate receipts, approve hardware, or certify a design. electronics_validate_run_record validates, normalizes, and integrity-seals a caller-supplied process snapshot; it executes no recorded activity, authenticates no author, grants no permission, and certifies no design or hardware. Its evidenceDigest excludes volatile record metadata, while recordDigest covers the normalized record except its seal. Both are unsigned SHA-256 identities, not signatures. Bind Logisim receipts to the exact circuit, test-vector receipts to the exact vector reference/digest pair, and CRUMB topology receipts to the exact topology/switch options. Invalid claim/scope pairs are rejected; failed supporting receipts and unsafe-runtime facts fail affected runtime claims closed. If Logisim runtime status is unknown, inspect electronics_capabilities, record the exact status, and replan before requesting a JAR step. Exhaustive vector receipts must report the full declared case count and distinct input assignments. All tools use electronics.mcp/0.2 envelopes: ok=false means the tool call failed, while ok=true with data.valid=false means validation or simulation ran and found a failing design. Use workspace-relative project refs, SHA-256 digests, and compatibilityProfile for handoff between ChatGPT, Claude, and local models. Static parsing, netlists, and crumb_trace_net connectivity witnesses are not simulation evidence. CRUMBLE is Circuitarium MCP's experimental integration family for CRUMB-specific rulesets and file interoperability; it does not control a live simulation. The Logisim-evolution adapter distinguishes static .circ evidence, JAR project-load evidence, and bounded truth-table/test-vector simulation evidence. Logisim runtime tools require a separately installed official 4.1.0 all-JAR and Java 21; test-vector execution also requires X11 or Xvfb on Linux. CRUMB topology is version-pinned to the observed CRUMB 1.3.5 Unity save format and is not a claim of compatibility with newer Godot builds.",
  },
);
registerKnowledgeSurfaces(server);

function sha256(value: string | Buffer): string {
  return typeof value === "string" ? sha256Text(value) : sha256Bytes(value);
}

function makeContext(
  overrides: Partial<
    Omit<ContractContext, "serverInstanceId" | "sessionScope">
  > = {},
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

function makeLogisimContext(
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
    backendId: LOGISIM_BACKEND_ID,
    adapterVersion: LOGISIM_ADAPTER_VERSION,
    compatibilityProfile: LOGISIM_COMPATIBILITY_PROFILE,
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

interface SuccessResultOptions<T> {
  summary: string;
  data: T;
  diagnostics?: ContractEnvelope<T>["diagnostics"];
  context?: ContractContext;
  nextActions?: NextAction[];
}

function successResult<T>(options: SuccessResultOptions<T>) {
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

function requireExpectedVectorDigest(
  expectedVectorDigest: string | undefined,
  actualVectorDigest: string,
): void {
  if (expectedVectorDigest === undefined) {
    return;
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(expectedVectorDigest)) {
    throw invalidArgument(
      "expectedVectorDigest must be a lowercase SHA-256 value prefixed with sha256:.",
      "expectedVectorDigest",
      ["Copy the vector digest unchanged from a prior tool result."],
    );
  }
  if (expectedVectorDigest !== actualVectorDigest) {
    throw new ContractFailure({
      code: "PROJECT_STATE_CONFLICT",
      category: "project",
      message:
        "The test-vector bytes changed since the supplied vector digest was recorded.",
      retryable: false,
      argumentPath: "expectedVectorDigest",
      recovery: [
        "Run the test vector again without expectedVectorDigest.",
        "Review the changed vector digest before accepting new simulation evidence.",
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
  if (error instanceof LogisimWorkspacePathDeniedError) {
    return {
      code: "PATH_DENIED",
      category: "filesystem",
      message:
        "The requested Logisim path is outside the configured MCP workspace.",
      retryable: false,
      recovery: [
        "Use a workspace-relative ref returned by logisim_list_projects.",
      ],
    };
  }
  if (error instanceof LogisimNotAFileError) {
    return {
      code: "NOT_FOUND",
      category: "filesystem",
      message: "The requested Logisim path is not a regular file.",
      retryable: false,
      recovery: ["Check the workspace-relative project or vector ref."],
    };
  }
  if (error instanceof LogisimNotADirectoryError) {
    return {
      code: "INVALID_ARGUMENT",
      category: "argument",
      message: "The requested Logisim directory ref is not a directory.",
      retryable: false,
      argumentPath: "dir",
      recovery: ["Pass a workspace-relative directory ref, or omit dir."],
    };
  }
  if (error instanceof UnsupportedLogisimPathError) {
    return {
      code: "UNSUPPORTED_FORMAT",
      category: "format",
      message:
        "The Logisim adapter requires a .circ project or .vec/.txt vector.",
      retryable: false,
      recovery: ["Use a supported workspace-relative Logisim artifact ref."],
    };
  }
  if (error instanceof LogisimFileTooLargeError) {
    return {
      code: "QUOTA_EXCEEDED",
      category: "filesystem",
      message: "The Logisim artifact exceeds the fixed read-size safety limit.",
      retryable: false,
      recovery: ["Use a smaller .circ project or test-vector file."],
    };
  }
  if (error instanceof LogisimFileChangedDuringReadError) {
    return {
      code: "PROJECT_STATE_CONFLICT",
      category: "project",
      message: "The Logisim artifact changed during one coherent read.",
      retryable: true,
      recovery: ["Wait for the save operation to finish, then retry."],
    };
  }
  if (error instanceof LogisimFormatError) {
    return {
      code: "FORMAT_INVALID",
      category: "format",
      message:
        "The file is not a supported, safely parseable Logisim .circ project.",
      retryable: false,
      recovery: [
        "Open and resave the project with Logisim-evolution 4.1.0.",
        "Inspect the file for malformed XML or unsupported encoding.",
      ],
    };
  }
  if (error instanceof LogisimRuntimeError) {
    switch (error.code) {
      case "BACKEND_UNAVAILABLE":
        return {
          code: "BACKEND_UNAVAILABLE",
          category: "backend",
          message: error.message,
          retryable: false,
          recovery:
            error instanceof LogisimDisplayUnavailableError
              ? [
                  "Run the MCP host under xvfb-run -a, or start a trusted X server and expose its DISPLAY to the host.",
                  "Use logisim_truth_table when the circuit is combinational and a test-vector display is unavailable.",
                ]
              : [
                  "Set CIRCUITARIUM_LOGISIM_JAR to the official Logisim-evolution 4.1.0 all-JAR.",
                  "Install Java 21 or set CIRCUITARIUM_JAVA to its executable.",
                ],
        };
      case "TIMEOUT":
        return {
          code: "TIMEOUT",
          category: "backend",
          message: error.message,
          retryable: true,
          recovery: ["Retry with a larger timeoutMs, or simplify the circuit."],
        };
      case "OUTPUT_LIMIT":
        return {
          code: "QUOTA_EXCEEDED",
          category: "backend",
          message: error.message,
          retryable: false,
          recovery: ["Reduce circuit inputs or use a smaller test vector."],
        };
      case "PROJECT_INVALID":
        return {
          code: "PROJECT_INVALID",
          category: "project",
          message: error.message,
          retryable: false,
          recovery: ["Open and repair the project in Logisim-evolution 4.1.0."],
        };
      case "TEST_VECTOR_INVALID":
        return {
          code: "INVALID_ARGUMENT",
          category: "argument",
          message: error.message,
          retryable: false,
          argumentPath: "vectorPath",
          recovery: [
            "Check the vector header, circuit name, and expected pin labels.",
          ],
        };
      case "EXECUTION_FAILED":
      case "OUTPUT_INVALID":
        return {
          code: "BACKEND_UNAVAILABLE",
          category: "backend",
          message: error.message,
          retryable: false,
          recovery: [
            "Replace the configured JAR with a trusted upstream Logisim-evolution 4.1.0 release asset and verify its SHA-256.",
            "Retry the same project directly with Logisim's documented CLI.",
          ],
        };
    }
  }
  if (error instanceof LogisimRuntimeJarStagingError) {
    return {
      code: "BACKEND_UNAVAILABLE",
      category: "backend",
      message: error.message,
      retryable: false,
      recovery: [
        "Configure a trusted Logisim-evolution 4.1.0 all-JAR that can be copied into the private runtime directory.",
      ],
    };
  }
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
      message:
        "The destination already exists; this server does not overwrite files.",
      retryable: false,
      recovery: [
        "Choose a new outputPath.",
        "Validate or inspect the existing file.",
      ],
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
      message:
        "The project changed while one coherent file snapshot was being read.",
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
      recovery: [
        "Pass a workspace-relative directory ref, or omit dir for the root.",
      ],
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
    vectorConflict?: {
      projectPath: string;
      vectorPath: string;
      circuit?: string;
    };
  } = {},
) {
  const details = classifyError(error, options.fallback);
  const context = options.context ?? makeContext();
  const isLogisim = context.backendId === LOGISIM_BACKEND_ID;
  const nextActions: NextAction[] =
    details.code === "PROJECT_STATE_CONFLICT" &&
    details.argumentPath === "expectedVectorDigest" &&
    options.vectorConflict !== undefined
      ? [
          {
            tool: "logisim_run_test_vector",
            reason:
              "Re-run the changed vector without a stale vector digest, then review the new evidence.",
            arguments: {
              path: options.vectorConflict.projectPath,
              vectorPath: options.vectorConflict.vectorPath,
              ...(options.vectorConflict.circuit === undefined
                ? {}
                : { circuit: options.vectorConflict.circuit }),
              ...(context.projectDigest === undefined
                ? {}
                : { expectedProjectDigest: context.projectDigest }),
            },
          },
        ]
      : details.code === "PROJECT_STATE_CONFLICT" &&
          context.projectRef !== undefined
        ? [
            {
              tool: isLogisim
                ? "logisim_analyze_design"
                : "crumb_analyze_design",
              reason:
                "Re-baseline the changed artifact and review its current digest.",
              arguments: {
                path: context.projectRef,
                ...(isLogisim ? {} : { view: "summary" }),
              },
            },
          ]
        : details.code === "PROJECT_INVALID" &&
            context.projectRef !== undefined &&
            !isLogisim
          ? [
              {
                tool: "crumb_validate_design",
                reason:
                  "Read the structural diagnostics before attempting analysis.",
                arguments: { path: context.projectRef },
              },
            ]
          : [
              {
                tool: "electronics_capabilities",
                reason:
                  "Review callable backends, constraints, and recovery workflows.",
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

const MAX_LOGISIM_ENVELOPE_BYTES = 2 * 1024 * 1024;

function logisimPublicText(
  value: string,
  truncation: { count: number },
): string {
  if (value.length <= MAX_LOGISIM_PUBLIC_STRING_CHARACTERS) {
    return value;
  }
  truncation.count += 1;
  const marker =
    `... [truncated; characters=${value.length}; ` +
    `bytes=${Buffer.byteLength(value, "utf8")}; ${sha256(value)}]`;
  return `${value.slice(
    0,
    Math.max(0, MAX_LOGISIM_PUBLIC_STRING_CHARACTERS - marker.length),
  )}${marker}`;
}

function sanitizeLogisimPublicValue(
  value: unknown,
  truncation: { count: number },
): unknown {
  if (typeof value === "string") {
    return logisimPublicText(value, truncation);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogisimPublicValue(item, truncation));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeLogisimPublicValue(item, truncation),
      ]),
    );
  }
  return value;
}

function logisimSuccessResult<T>(options: SuccessResultOptions<T>) {
  const truncation = { count: 0 };
  const sanitized = sanitizeLogisimPublicValue(
    options,
    truncation,
  ) as SuccessResultOptions<T>;
  if (truncation.count > 0) {
    sanitized.diagnostics = [
      ...(sanitized.diagnostics ?? []),
      {
        severity: "warning",
        code: "logisim-public-text-truncated",
        path: "data",
        message:
          `${truncation.count} oversized text value(s) were replaced with ` +
          "bounded previews carrying original character/byte counts and SHA-256 digests.",
      },
    ];
  }
  const candidate = successResult(sanitized);
  const serialized = candidate.content[0]?.text ?? "";
  if (Buffer.byteLength(serialized, "utf8") <= MAX_LOGISIM_ENVELOPE_BYTES) {
    return candidate;
  }
  return errorResult(
    new ContractFailure({
      code: "QUOTA_EXCEEDED",
      category: "backend",
      message:
        "The bounded Logisim result still exceeds the fixed MCP response-byte limit.",
      retryable: false,
      recovery: [
        "Request a smaller page or lower result limit.",
        "Use a smaller circuit or shorter labels before retrying.",
      ],
    }),
    { context: options.context ?? makeLogisimContext() },
  );
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

function logisimArtifact(
  file: Awaited<ReturnType<typeof readLogisimFile>>,
  project: LogisimProject,
) {
  return {
    ref: file.ref,
    format: "logisim-circ" as const,
    mediaType: "application/xml" as const,
    bytes: file.size,
    digest: file.digest,
    sourceVersion: project.metadata.sourceVersion,
    fileFormatVersion: project.metadata.fileFormatVersion,
    mainCircuit: project.metadata.mainCircuitName,
  };
}

function selectLogisimCircuit(
  project: LogisimProject,
  requestedCircuit: string | undefined,
) {
  const circuitName =
    requestedCircuit ??
    project.metadata.mainCircuitName ??
    project.circuits[0]?.name;
  if (circuitName === undefined) {
    throw new ContractFailure({
      code: "PROJECT_INVALID",
      category: "project",
      message: "The Logisim project contains no circuits.",
      retryable: false,
      recovery: ["Create a circuit in Logisim-evolution and save the project."],
    });
  }
  const circuit = project.circuits.find(
    (candidate) => candidate.name === circuitName,
  );
  if (circuit === undefined) {
    throw invalidArgument(
      `Circuit ${JSON.stringify(circuitName)} is not present in the project.`,
      "circuit",
      ["Use a circuit name returned by logisim_analyze_design."],
    );
  }
  return circuit;
}

function requireSafeLogisimRuntimeProject(project: LogisimProject) {
  const assessment = assessLogisimRuntimeSafety(project);
  if (!assessment.safe) {
    throw new ContractFailure({
      code: "UNSUPPORTED_OPERATION",
      category: "project",
      message:
        "JAR execution is refused because static preflight found project constructs outside Circuitarium's safe runtime subset.",
      retryable: false,
      recovery: [
        "Call logisim_analyze_design and inspect data.runtimeSafety for bounded reason codes and counts.",
        "Remove external libraries, VHDL, unsafe resource paths, unsupported runtime components, and unknown or malformed constructs before retrying.",
      ],
    });
  }
  return assessment;
}

function logisimRuntimeEvidence(probe: LogisimRuntimeProbe) {
  return {
    engine: "Logisim-evolution" as const,
    version: probe.logisimVersion,
    buildId: probe.buildId,
    buildDate: probe.buildDate,
    javaRuntime: probe.javaRuntime,
    javaVendor: probe.javaVendor,
    invocation: "local-jar-subprocess" as const,
    authenticity: "self-reported-unverified" as const,
  };
}

const LOGISIM_RUNTIME_TOOL_NAMES = [
  "logisim_component_stats",
  "logisim_truth_table",
  "logisim_run_test_vector",
] as const;

function logisimRuntimeConfiguration() {
  return {
    jarEnvironment: "CIRCUITARIUM_LOGISIM_JAR",
    javaEnvironment: "CIRCUITARIUM_JAVA",
    javaRequirement: "Java 21 or newer",
  };
}

async function callableBackendsWithRuntimeStatus(): Promise<
  CallableBackendDescriptor[]
> {
  const configured =
    (process.env.CIRCUITARIUM_LOGISIM_JAR?.trim().length ?? 0) > 0 ||
    (process.env.LOGISIM_JAR?.trim().length ?? 0) > 0;

  let runtime: NonNullable<CallableBackendDescriptor["runtime"]> = {
    status: "unconfigured",
    requiredForTools: [...LOGISIM_RUNTIME_TOOL_NAMES],
    configuration: logisimRuntimeConfiguration(),
  };

  if (configured) {
    try {
      const probe = await probeLogisimRuntime({ timeoutMs: 5_000 });
      const detected = {
        simulatorVersion: probe.logisimVersion,
        javaRuntime: probe.javaRuntime,
        javaVendor: probe.javaVendor,
      };
      if (probe.logisimVersion === LOGISIM_RUNTIME_VERSION) {
        runtime = {
          ...runtime,
          status: "available",
          detected,
        };
      } else {
        runtime = {
          ...runtime,
          status: "version-mismatch",
          detected,
        };
      }
    } catch (error) {
      runtime = {
        ...runtime,
        status:
          error instanceof LogisimRuntimeVersionMismatchError
            ? "version-mismatch"
            : "unavailable",
        ...(error instanceof LogisimRuntimeVersionMismatchError
          ? {
              detected: {
                simulatorVersion: error.reportedVersion,
              },
            }
          : {}),
      };
    }
  }

  return CALLABLE_BACKENDS.map((backend) =>
    backend.backendId === LOGISIM_BACKEND_ID
      ? {
          ...backend,
          runtime,
        }
      : backend,
  );
}

async function loadLogisimProject(
  args: {
    path: string;
    expectedProjectDigest: string | undefined;
  },
  publishContext: (context: ContractContext) => void,
) {
  const file = await readLogisimFile(args.path);
  const context = makeLogisimContext({
    projectRef: file.ref,
    projectDigest: file.digest,
  });
  publishContext(context);
  requireExpectedProjectDigest(args.expectedProjectDigest, file.digest);
  const project = parseLogisimCircBytes(file.bytes);
  const artifact = logisimArtifact(file, project);
  const ir = logisimProjectToIr(project, {
    sourceRef: file.ref,
    sourceDigest: file.digest,
  });
  return { file, context, project, artifact, ir };
}

type AnalysisView = "summary" | "components" | "connections";
type PagedView =
  | "components"
  | "connections"
  | "netlist"
  | "net-trace"
  | "logisim-netlist"
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

function paginationOptionsFingerprint(
  options: Record<string, unknown>,
): string {
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
  async () => {
    const callableBackends = await callableBackendsWithRuntimeStatus();
    return successResult({
      summary:
        "Circuitarium provides local CRUMB file analysis plus version-pinned Logisim-evolution .circ analysis and optional configured-JAR non-interactive simulation; neither backend controls a live GUI session.",
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
          planningTool: "electronics_plan_verification",
        },
        portableRunRecord: {
          schemaVersion: RUN_RECORD_VERSION,
          validationTool: "electronics_validate_run_record",
          schemaResource: RUN_RECORD_RESOURCE_URI,
          authenticity: RUN_RECORD_AUTHENTICITY,
          evidenceDigestScope: "content",
          recordDigestScope: "record-excluding-seal",
        },
        callableBackends,
        roadmapBackends: ROADMAP_BACKENDS,
        workflows: WORKFLOWS,
        vocabulary: [...VOCABULARY],
        knowledgeSurfaces: {
          resources: [...KNOWLEDGE_RESOURCE_URIS],
          prompts: [...KNOWLEDGE_PROMPT_NAMES],
          resourcesAreStatic: true,
          liveAvailabilityTool: "electronics_capabilities",
        },
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
          tool: "logisim_analyze_design",
          reason:
            "Understand the included Logisim full-adder using static, explicitly partial evidence.",
          arguments: {
            path: "examples/logisim/full-adder.circ",
          },
        },
        {
          tool: "electronics_plan_verification",
          reason:
            "Turn explicit claims into a bounded, evidence-aware verification plan.",
          arguments: {
            target: {
              backendId: "logisim.evolution",
              projectRef: "examples/logisim/full-adder.circ",
              circuit: "Main",
            },
            claims: [
              {
                id: "full-adder-behavior",
                claimClass: "combinational-behavior",
                objective: "verify",
                scope: "selected-circuit",
              },
            ],
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
        {
          tool: "electronics_validate_run_record",
          reason:
            "Validate, normalize, and integrity-seal a simulator-neutral engineering run snapshot without executing it.",
          arguments: {
            record: {
              schemaVersion: RUN_RECORD_VERSION,
              recordId: "minimal-run",
              recordType: "run",
              recordStatus: "open",
              content: {
                intent: {
                  title: "Minimal engineering run",
                  summary:
                    "Capture intent before any construction or execution occurs.",
                },
                stages: [
                  {
                    id: "intent",
                    sequence: 1,
                    kind: "intent-architecture",
                    title: "Define intent",
                    status: "planned",
                  },
                ],
                disclosure: {
                  rawCommandsIncluded: false,
                  environmentValuesIncluded: false,
                  absolutePathsIncluded: false,
                  rawPayloadsIncluded: false,
                  userAuthoredTextMayContainSensitiveData: true,
                },
                completeness: {
                  status: "partial",
                  reasons: ["No execution evidence has been recorded yet."],
                },
              },
            },
          },
        },
      ],
    });
  },
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
              reason:
                "Review the neutral experiment model and workflow conventions.",
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

const ElectronicsVerificationPlanOutputSchema = envelopeSchema(
  VerificationPlanDataSchema,
);
const electronicsVerificationPlanTool = server.registerTool(
  "electronics_plan_verification",
  {
    title: "Plan evidence-aware electronics verification",
    description:
      "Builds a deterministic, simulator-neutral plan for explicit claims using bounded caller-reported evidence. It reads no files, runs no tools or simulators, authenticates no receipts, and never certifies physical hardware.",
    inputSchema: VerificationPlanInputSchema,
    outputSchema: ElectronicsVerificationPlanOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (input) => {
    const plan = planVerification(input);
    const firstRunnableSteps = plan.steps
      .filter(
        (
          step,
        ): step is Extract<
          (typeof plan.steps)[number],
          { actionType: "mcp-tool" }
        > => step.actionType === "mcp-tool",
      )
      .filter((step) => step.dependsOn.length === 0)
      .slice(0, 3);
    return successResult({
      summary:
        `Planned ${plan.steps.length} verification step(s) for ${plan.claims.length} claim(s); ` +
        `overall status is ${plan.overallStatus}.`,
      data: plan,
      context: makeContext({
        ...(plan.target.projectDigest === undefined
          ? {}
          : {
              projectRef: plan.target.projectRef,
              projectDigest: plan.target.projectDigest,
            }),
      }),
      nextActions: firstRunnableSteps.map((step) => ({
        tool: step.tool,
        reason:
          "Run this first dependency-free step, then record its exact digest-bound result as reported evidence before replanning.",
        arguments: step.arguments,
      })),
    });
  },
);
envelopeTools.set("electronics_plan_verification", {
  inputSchema: VerificationPlanInputSchema,
  outputSchema: ElectronicsVerificationPlanOutputSchema,
  registeredTool: electronicsVerificationPlanTool,
  context: makeContext,
});

const ElectronicsRunRecordOutputSchema = envelopeSchema(
  RunRecordValidationDataSchema,
);
const electronicsRunRecordTool = server.registerTool(
  "electronics_validate_run_record",
  {
    title: "Validate and seal an electronics run record",
    description:
      "Validates, normalizes, and deterministically SHA-256-seals a bounded simulator-neutral engineering run snapshot. Provide exactly one of record or serializedRecord; use serializedRecord for external JSON so duplicate keys can be rejected. Expected digests authenticate nothing unless obtained separately. The Tool executes no activity, authenticates no author, grants no permission, and never certifies a design, hardware, signoff, or fabrication handoff.",
    inputSchema: RunRecordValidationInputSchema,
    outputSchema: ElectronicsRunRecordOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    record,
    serializedRecord,
    expectedRecordDigest,
    expectedEvidenceDigest,
  }) => {
    const expected = {
      ...(expectedRecordDigest === undefined
        ? {}
        : { recordDigest: expectedRecordDigest }),
      ...(expectedEvidenceDigest === undefined
        ? {}
        : { evidenceDigest: expectedEvidenceDigest }),
    };
    const validation =
      serializedRecord === undefined
        ? validateAndSealRunRecord(record, expected)
        : validateAndSealSerializedRunRecord(serializedRecord, expected);
    const errorCount = validation.diagnostics.filter(
      (item) => item.severity === "error",
    ).length;
    const sealed = validation.record;
    return successResult({
      summary: validation.valid
        ? "The universal electronics run record is valid, normalized, and integrity-sealed as unsigned-unverified."
        : `Run-record validation completed and found ${errorCount} error${errorCount === 1 ? "" : "s"}.`,
      data: {
        valid: validation.valid,
        ...(sealed === undefined
          ? {}
          : {
              schemaVersion: sealed.schemaVersion,
              recordDigest: sealed.seal.recordDigest,
              evidenceDigest: sealed.seal.evidenceDigest,
              authenticity: sealed.seal.authenticity,
              sealedRecord: sealed,
              counts: sealed.seal.collectionBounds,
            }),
      },
      diagnostics: validation.diagnostics,
      nextActions: validation.valid
        ? []
        : [
            {
              tool: "electronics_capabilities",
              reason:
                "Review the run-record schema Resource and neutral evidence boundaries before correcting the record.",
              arguments: {},
            },
          ],
    });
  },
);
envelopeTools.set("electronics_validate_run_record", {
  inputSchema: RunRecordValidationInputSchema,
  outputSchema: ElectronicsRunRecordOutputSchema,
  registeredTool: electronicsRunRecordTool,
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
            designNamePreviewCharacters: MAX_DESIGN_NAME_PREVIEW_CHARACTERS,
            componentGeometryPoints: MAX_COMPONENT_GEOMETRY_POINTS_RETURNED,
            componentTerminals: MAX_COMPONENT_TERMINALS_RETURNED,
            componentPayloadEntries: MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
            parameterCollectionItems: MAX_PARAMETER_COLLECTION_ITEMS_RETURNED,
            connectionGroupMembersPerField:
              MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
            kindCounts: MAX_KIND_COUNTS_RETURNED,
            diagnostics: MAX_RESULT_DIAGNOSTICS_RETURNED,
            diagnosticCodeCharacters: MAX_DIAGNOSTIC_CODE_CHARACTERS,
            diagnosticPathCharacters: MAX_DIAGNOSTIC_PATH_CHARACTERS,
            diagnosticMessageCharacters: MAX_DIAGNOSTIC_MESSAGE_CHARACTERS,
            cruXsiTypeCharacters: MAX_CRU_XSI_TYPE_CHARACTERS,
            cruNumericLexicalCharacters: MAX_CRU_NUMERIC_LEXICAL_CHARACTERS,
            cruGuidTokenCharacters: MAX_CRU_GUID_TOKEN_CHARACTERS,
            cruXmlNameCharacters: MAX_CRU_XML_NAME_CHARACTERS,
            cruXmlElements: MAX_CRU_XML_ELEMENTS,
            cruXmlDepth: MAX_CRU_XML_DEPTH,
            cruComponents: MAX_CRU_COMPONENTS,
            cruDataValuesPerComponent: MAX_CRU_DATA_VALUES_PER_COMPONENT,
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
            reason:
              "Check structural validity before opening or sharing the file.",
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

      const effectiveIncludeGeometry = view === "components" && includeGeometry;
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
          message:
            "Component comparison pages with geometry are capped at 25 items.",
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
            reason:
              "Get a semantic, version-pinned understanding of the design.",
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
                reason:
                  "Understand recognized components and inferred connections.",
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
                  reason:
                    "Confirm the generated component and connection semantics.",
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
          entries.push({
            ...entry,
            digestOmittedReason: "not-requested" as const,
          });
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
                  reason:
                    "No projects exist yet; create a known-good fixture to explore.",
                  arguments: {
                    kind: "breadboard-led",
                    outputPath: "generated/first-led.cru",
                  },
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
            (terminal) => terminal.componentId.toLowerCase() === componentKey,
          ),
        )
        .map((group) => {
          const fullTerminals =
            fullConnectionGroupMembership(group).componentTerminals;
          const focused = fullTerminals.filter(
            (terminal) => terminal.componentId.toLowerCase() === componentKey,
          );
          const retained = group.componentTerminals.filter(
            (terminal) => terminal.componentId.toLowerCase() !== componentKey,
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
              (
                value,
              ): value is Extract<CruDecodedDataValue, { kind: "string" }> =>
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
                  reason:
                    "See every electrical net this component participates in.",
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
      'Queries the version-pinned tool-5 IC registry by prefabId or by a label/package substring (for example "74HC138"). Returns package labels, ordered pin names, and explicit unresolved pins.',
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
          reason:
            "Read the full tool-5 payload signature and evidence vocabulary.",
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

function traceSelectionFailure(
  error: CrumbTraceSelectionError,
): ContractFailure {
  if (error.kind === "terminal-name-mismatch") {
    return invalidArgument(error.message, "expectedTerminalName", [
      "Remove expectedTerminalName or copy the exact name from crumb_get_component.",
      "Keep componentId and terminalIndex unchanged when continuing a trace.",
    ]);
  }
  if (error.kind === "graph-quota-exceeded") {
    return new ContractFailure({
      code: "QUOTA_EXCEEDED",
      category: "backend",
      message: error.message,
      retryable: false,
      recovery: [
        "Reduce the project before tracing this net.",
        "Use crumb_export_netlist for the bounded net inventory.",
      ],
    });
  }
  if (error.kind === "component-ambiguous") {
    return new ContractFailure({
      code: "PROJECT_INVALID",
      category: "project",
      message: error.message,
      retryable: false,
      recovery: [
        "Repair duplicate component identifiers before relying on terminal identity.",
        "Call crumb_validate_design for structural diagnostics.",
      ],
    });
  }
  const argumentPath =
    error.details.argumentPath ??
    (error.kind === "component-not-found" ? "componentId" : "terminalIndex");
  return new ContractFailure({
    code: "NOT_FOUND",
    category: "project",
    message: error.message,
    retryable: false,
    argumentPath,
    recovery: [
      "Call crumb_get_component to confirm the component and its bounded terminal inventory.",
      ...(error.details.terminalCount === undefined
        ? []
        : [
            `Choose terminalIndex from 0 through ${Math.max(
              0,
              error.details.terminalCount - 1,
            )}.`,
          ]),
      "Restart without a pagination cursor after correcting the selector.",
    ],
  });
}

const CrumbNetTraceOutputSchema = envelopeSchema(CrumbNetTraceDataSchema);
const crumbNetTraceTool = server.registerTool(
  "crumb_trace_net",
  {
    title: "Trace one inferred CRUMB electrical net",
    description:
      "Selects one component terminal by stable index and returns a paged deterministic connectivity witness with structured attachment, board, jumper, and optional saved-switch provenance. It is static conductive inference, not current flow, path enumeration, or simulation.",
    inputSchema: CrumbNetTraceInputSchema,
    outputSchema: CrumbNetTraceOutputSchema,
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
    terminalIndex,
    expectedTerminalName,
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
      const trace = buildCrumbNetTrace(
        loaded.analysis,
        netlist,
        {
          componentId,
          terminalIndex,
          ...(expectedTerminalName === undefined
            ? {}
            : { expectedTerminalName }),
        },
        { applySwitchStates },
      );
      const optionsFingerprint = paginationOptionsFingerprint({
        traceVersion: trace.traceVersion,
        traversalVersion: CRUMB_NET_TRACE_TRAVERSAL_VERSION,
        topologyMode,
        applySwitchStates,
        componentId: trace.root.componentId.toLowerCase(),
        terminalIndex: trace.root.terminalIndex,
      });
      const offset = decodeCursor(
        cursor,
        "net-trace",
        loaded.project.digest,
        trace.visits.length,
        optionsFingerprint,
      );
      const paged = pageResult(
        trace.visits,
        offset,
        limit,
        "net-trace",
        loaded.project.digest,
        optionsFingerprint,
      );
      const diagnostics: Diagnostic[] = [
        ...loaded.structuralDiagnostics,
        ...loaded.analysis.diagnostics,
        ...netlist.diagnostics,
        ...trace.diagnostics,
      ];
      return successResult({
        summary:
          `Traced ${trace.resolvedNet.counts.terminals} terminal(s) across ` +
          `${trace.resolvedNet.counts.nodes} evidence node(s) on ${trace.resolvedNet.id}.`,
        data: {
          traceVersion: trace.traceVersion,
          traversalVersion: trace.traversalVersion,
          project: { ...loaded.project, ref: loaded.ref },
          root: trace.root,
          topologyMode: trace.topologyMode,
          scope: trace.scope,
          applySwitchStates: trace.applySwitchStates,
          resolvedNet: trace.resolvedNet,
          witness: trace.witness,
          provenance: trace.provenance,
          page: paged.page,
          visits: paged.items,
        },
        diagnostics,
        context: operationContext,
        nextActions:
          paged.page.nextCursor === undefined
            ? [
                {
                  tool: "crumb_check_design",
                  reason:
                    "Run static electrical rules over the complete inferred design.",
                  arguments: {
                    path: loaded.ref,
                    expectedProjectDigest: loaded.project.digest,
                    topologyMode,
                    applySwitchStates,
                  },
                },
              ]
            : [
                {
                  tool: "crumb_trace_net",
                  reason:
                    "Continue the same connectivity witness without overlap.",
                  arguments: {
                    path: loaded.ref,
                    expectedProjectDigest: loaded.project.digest,
                    componentId: trace.root.componentId,
                    terminalIndex: trace.root.terminalIndex,
                    expectedTerminalName: trace.root.terminalName,
                    topologyMode,
                    applySwitchStates,
                    cursor: paged.page.nextCursor,
                    limit,
                  },
                },
              ],
      });
    } catch (error) {
      return errorResult(
        error instanceof CrumbTraceSelectionError
          ? traceSelectionFailure(error)
          : error,
        {
          fallback: "FORMAT_INVALID",
          context: operationContext,
        },
      );
    }
  },
);
envelopeTools.set("crumb_trace_net", {
  inputSchema: CrumbNetTraceInputSchema,
  outputSchema: CrumbNetTraceOutputSchema,
  registeredTool: crumbNetTraceTool,
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

const LogisimWorkspaceOutputSchema = envelopeSchema(LogisimWorkspaceDataSchema);
const logisimListProjectsTool = server.registerTool(
  "logisim_list_projects",
  {
    title: "List Logisim-evolution projects",
    description:
      "Discovers workspace .circ projects with stable raw-byte digests. This is static file discovery and does not launch Logisim.",
    inputSchema: LogisimListProjectsInputSchema,
    outputSchema: LogisimWorkspaceOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ dir, recursive, limit }) => {
    try {
      const listing = await listLogisimFiles(dir, { recursive });
      const bounded = boundCollection(listing.entries, limit);
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
      if (listing.digestBudgetTruncated) {
        diagnostics.push({
          severity: "warning",
          code: "digest-budget-exhausted",
          path: "entries",
          message:
            "Some .circ files were omitted after the fixed listing digest-byte budget was exhausted.",
        });
      }
      if (bounded.bounds.truncated) {
        diagnostics.push({
          severity: "warning",
          code: "listing-truncated",
          path: "entries",
          message: `Returned ${bounded.bounds.returned} of ${bounded.bounds.total} discovered .circ files.`,
        });
      }
      const first = bounded.items[0];
      return logisimSuccessResult({
        summary:
          `Found ${bounded.bounds.total} .circ project(s) within the digest budget; ` +
          `returned ${bounded.bounds.returned}.`,
        data: {
          listingVersion: "logisim.workspace/0.1" as const,
          rootRef: "." as const,
          dirRef: logisimWorkspaceRef(dir),
          recursive,
          scan: {
            scannedEntries: listing.scannedEntries,
            scanTruncated: listing.scanTruncated,
          },
          entries: bounded.items,
          entryBounds: bounded.bounds,
        },
        diagnostics,
        context: makeLogisimContext(),
        nextActions:
          first === undefined
            ? []
            : [
                {
                  tool: "logisim_analyze_design",
                  reason: "Inspect the first discovered project statically.",
                  arguments: {
                    path: first.ref,
                    expectedProjectDigest: first.digest,
                  },
                },
              ],
      });
    } catch (error) {
      return errorResult(error, { context: makeLogisimContext() });
    }
  },
);
envelopeTools.set("logisim_list_projects", {
  inputSchema: LogisimListProjectsInputSchema,
  outputSchema: LogisimWorkspaceOutputSchema,
  registeredTool: logisimListProjectsTool,
  context: makeLogisimContext,
});

const LogisimAnalysisOutputSchema = envelopeSchema(LogisimAnalysisDataSchema);
const logisimAnalyzeTool = server.registerTool(
  "logisim_analyze_design",
  {
    title: "Analyze a Logisim-evolution project",
    description:
      "Parses bounded .circ XML into project, circuit, pin, clock, component, and explicit conversion-loss summaries. Static parsing is not simulation evidence.",
    inputSchema: LogisimProjectReadInputSchema,
    outputSchema: LogisimAnalysisOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, expectedProjectDigest }) => {
    let operationContext = makeLogisimContext();
    try {
      const loaded = await loadLogisimProject(
        { path, expectedProjectDigest },
        (context) => {
          operationContext = context;
        },
      );
      const boundedCircuits = boundCollection(
        loaded.project.circuits,
        MAX_LOGISIM_CIRCUITS_RETURNED,
      );
      const circuits = boundedCircuits.items.map((circuit) => {
        const pinSummary = summarizeLogisimCircuitIo(
          loaded.project,
          circuit.name,
        );
        const boundedPins = boundCollection(
          pinSummary.pins,
          MAX_LOGISIM_PINS_RETURNED,
        );
        const typeCounts = new Map<string, number>();
        for (const component of circuit.components) {
          typeCounts.set(
            component.name,
            (typeCounts.get(component.name) ?? 0) + 1,
          );
        }
        const boundedTypes = boundCollection(
          [...typeCounts.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          MAX_LOGISIM_COMPONENT_TYPES_RETURNED,
        );
        return {
          id: circuit.id,
          name: circuit.name,
          componentCount: circuit.components.length,
          wireCount: circuit.wires.length,
          clockCount: circuit.components.filter(
            (component) => component.kind === "clock",
          ).length,
          unknownComponentCount: circuit.components.filter(
            (component) => component.kind === "unknown",
          ).length,
          pinSummary: {
            ...pinSummary,
            pins: boundedPins.items,
            pinBounds: boundedPins.bounds,
          },
          componentTypes: boundedTypes.items,
          componentTypeBounds: boundedTypes.bounds,
        };
      });
      const boundedLibraries = boundCollection(
        loaded.project.libraries,
        MAX_LOGISIM_LIBRARIES_RETURNED,
      );
      const boundedLosses = boundCollection(
        loaded.ir.losses,
        MAX_LOGISIM_IR_LOSSES_RETURNED,
      );
      const allComponents = loaded.project.circuits.flatMap(
        (circuit) => circuit.components,
      );
      const runtimeSafety = assessLogisimRuntimeSafety(loaded.project);
      const diagnostics: Diagnostic[] = [];
      if (
        boundedCircuits.bounds.truncated ||
        boundedLibraries.bounds.truncated ||
        boundedLosses.bounds.truncated ||
        circuits.some(
          (circuit) =>
            circuit.pinSummary.pinBounds.truncated ||
            circuit.componentTypeBounds.truncated,
        )
      ) {
        diagnostics.push({
          severity: "warning",
          code: "analysis-response-truncated",
          path: "analysis",
          message:
            "One or more project summaries were bounded; full totals and truncation metadata are retained.",
        });
      }
      return logisimSuccessResult({
        summary:
          `Parsed ${loaded.project.circuits.length} circuit(s), ` +
          `${allComponents.length} component(s), and ` +
          `${loaded.project.unknownConstructs.totalCount} unknown construct(s).`,
        data: {
          analysisVersion: "logisim.analysis/0.1" as const,
          project: loaded.artifact,
          source: {
            sourceVersion: loaded.project.metadata.sourceVersion,
            fileFormatVersion: loaded.project.metadata.fileFormatVersion,
            mainCircuitName: loaded.project.metadata.mainCircuitName,
            compatibility: loaded.project.metadata.compatibility,
          },
          counts: {
            libraries: loaded.project.libraries.length,
            circuits: loaded.project.circuits.length,
            components: allComponents.length,
            wires: loaded.project.circuits.reduce(
              (total, circuit) => total + circuit.wires.length,
              0,
            ),
            pins: allComponents.filter((component) => component.kind === "pin")
              .length,
            clocks: allComponents.filter(
              (component) => component.kind === "clock",
            ).length,
            unknownComponents: allComponents.filter(
              (component) => component.kind === "unknown",
            ).length,
            unknownConstructs: loaded.project.unknownConstructs.totalCount,
          },
          circuits,
          circuitBounds: boundedCircuits.bounds,
          libraries: boundedLibraries.items.map((library) => ({
            id: library.id,
            descriptor: library.descriptor,
            external:
              library.descriptor.length > 0 &&
              !library.descriptor.startsWith("#"),
          })),
          libraryBounds: boundedLibraries.bounds,
          unknownConstructs: loaded.project.unknownConstructs,
          runtimeSafety,
          neutralIr: {
            irVersion: loaded.ir.irVersion,
            completeness: loaded.ir.completeness,
            losses: boundedLosses.items,
            lossBounds: boundedLosses.bounds,
          },
          limitations: [
            "The .circ parser recognizes structure and declared pin metadata; it does not execute built-in component behavior.",
            "Neutral connectivity includes exact coordinate endpoints and explicitly modeled Pin/Clock ports only.",
            "Use logisim_truth_table or logisim_run_test_vector for bounded behavioral evidence from the configured JAR.",
          ],
        },
        diagnostics,
        context: operationContext,
        nextActions: [
          {
            tool: "logisim_export_netlist",
            reason: "Inspect the explicitly partial coordinate netlist.",
            arguments: {
              path: loaded.file.ref,
              expectedProjectDigest: loaded.file.digest,
            },
          },
          {
            tool: "logisim_component_stats",
            reason:
              "Ask Logisim itself to load the project and count components.",
            arguments: {
              path: loaded.file.ref,
              expectedProjectDigest: loaded.file.digest,
            },
          },
        ],
      });
    } catch (error) {
      return errorResult(error, { context: operationContext });
    }
  },
);
envelopeTools.set("logisim_analyze_design", {
  inputSchema: LogisimProjectReadInputSchema,
  outputSchema: LogisimAnalysisOutputSchema,
  registeredTool: logisimAnalyzeTool,
  context: makeLogisimContext,
});

const LogisimNetlistOutputSchema = envelopeSchema(LogisimNetlistDataSchema);
const logisimNetlistTool = server.registerTool(
  "logisim_export_netlist",
  {
    title: "Export a partial Logisim netlist",
    description:
      "Exports simulator-neutral coordinate-endpoint nets with explicit loss markers. It does not infer unmodeled gate geometry, mid-segment junctions, or behavior.",
    inputSchema: LogisimNetlistInputSchema,
    outputSchema: LogisimNetlistOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, expectedProjectDigest, circuit, cursor, limit }) => {
    let operationContext = makeLogisimContext();
    try {
      const loaded = await loadLogisimProject(
        { path, expectedProjectDigest },
        (context) => {
          operationContext = context;
        },
      );
      const sourceCircuit = selectLogisimCircuit(loaded.project, circuit);
      const irCircuit = loaded.ir.circuits.find(
        (candidate) => candidate.id === sourceCircuit.id,
      );
      if (irCircuit === undefined) {
        throw new Error("Neutral IR omitted the selected circuit");
      }
      const fingerprint = paginationOptionsFingerprint({
        circuit: sourceCircuit.name,
        topologyMode: "coordinate-endpoints",
      });
      const offset = decodeCursor(
        cursor,
        "logisim-netlist",
        loaded.file.digest,
        irCircuit.netlist.nets.length,
        fingerprint,
      );
      const paged = pageResult(
        irCircuit.netlist.nets,
        offset,
        limit,
        "logisim-netlist",
        loaded.file.digest,
        fingerprint,
      );
      const nets = paged.items.map((net) => {
        const nodes = boundCollection(
          net.nodes,
          MAX_LOGISIM_NET_NODES_RETURNED,
        );
        const wires = boundCollection(
          net.wireIds,
          MAX_LOGISIM_NET_WIRES_RETURNED,
        );
        const members = boundCollection(
          net.members,
          MAX_LOGISIM_NET_MEMBERS_RETURNED,
        );
        return {
          id: net.id,
          nodes: nodes.items,
          nodeBounds: nodes.bounds,
          wireIds: wires.items,
          wireBounds: wires.bounds,
          members: members.items,
          memberBounds: members.bounds,
        };
      });
      const losses = boundCollection(
        irCircuit.losses,
        MAX_LOGISIM_IR_LOSSES_RETURNED,
      );
      const nestedTruncated = nets.some(
        (net) =>
          net.nodeBounds.truncated ||
          net.wireBounds.truncated ||
          net.memberBounds.truncated,
      );
      const diagnostics: Diagnostic[] = [];
      if (
        paged.page.nextCursor !== undefined ||
        nestedTruncated ||
        losses.bounds.truncated
      ) {
        diagnostics.push({
          severity: "warning",
          code: "netlist-response-truncated",
          path: "nets",
          message:
            "The netlist response is bounded; use page.nextCursor for more nets and inspect nested bounds.",
        });
      }
      return logisimSuccessResult({
        summary:
          `Returned ${paged.page.returned} of ${paged.page.total} ` +
          `partial coordinate net(s) for ${sourceCircuit.name}.`,
        data: {
          netlistVersion: irCircuit.netlist.netlistVersion,
          project: loaded.artifact,
          circuit: {
            id: sourceCircuit.id,
            name: sourceCircuit.name,
          },
          topologyMode: irCircuit.netlist.topologyMode,
          completeness: irCircuit.netlist.completeness,
          nets,
          page: paged.page,
          losses: losses.items,
          lossBounds: losses.bounds,
          limitations: [
            "This is a static coordinate graph, not Logisim simulation output.",
            "Only exact wire endpoints and explicitly located Pin/Clock ports become members.",
            "Unmodeled component port geometry and mid-segment junction semantics remain explicit losses.",
          ],
        },
        diagnostics,
        context: operationContext,
        nextActions: [
          {
            tool: "logisim_truth_table",
            reason:
              "Use Logisim's own non-interactive CLI when behavioral output is needed.",
            arguments: {
              path: loaded.file.ref,
              circuit: sourceCircuit.name,
              expectedProjectDigest: loaded.file.digest,
            },
          },
        ],
      });
    } catch (error) {
      return errorResult(error, { context: operationContext });
    }
  },
);
envelopeTools.set("logisim_export_netlist", {
  inputSchema: LogisimNetlistInputSchema,
  outputSchema: LogisimNetlistOutputSchema,
  registeredTool: logisimNetlistTool,
  context: makeLogisimContext,
});

const LogisimComponentStatsOutputSchema = envelopeSchema(
  LogisimComponentStatsDataSchema,
);
const logisimComponentStatsTool = server.registerTool(
  "logisim_component_stats",
  {
    title: "Load a project and count Logisim components",
    description:
      "Invokes the separately installed JAR, after it self-reports Logisim-evolution 4.1.0, with --tty stats. Success proves that configured process loaded the staged project, not behavioral simulation or binary authenticity.",
    inputSchema: LogisimComponentStatsInputSchema,
    outputSchema: LogisimComponentStatsOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, expectedProjectDigest, circuit, limit, timeoutMs }) => {
    let operationContext = makeLogisimContext();
    try {
      const loaded = await loadLogisimProject(
        { path, expectedProjectDigest },
        (context) => {
          operationContext = context;
        },
      );
      requireSafeLogisimRuntimeProject(loaded.project);
      const selected = selectLogisimCircuit(loaded.project, circuit);
      const execution = await withStagedLogisimArtifacts(
        { projectBytes: loaded.file.bytes },
        async ({ projectPath }) =>
          runLogisimStatisticsWithRuntime(projectPath, {
            toplevelCircuit: selected.name,
            maxComponentRows: limit,
            timeoutMs,
          }),
      );
      const probe = execution.runtime;
      const statistics = execution.result;
      return logisimSuccessResult({
        summary:
          `Logisim loaded ${selected.name} and reported ` +
          `${statistics.totalWithSubcircuits.recursiveCount} recursive component(s).`,
        data: {
          statisticsVersion: "logisim.statistics/0.1" as const,
          project: loaded.artifact,
          circuitName: selected.name,
          runtime: logisimRuntimeEvidence(probe),
          components: statistics.components,
          componentBounds: {
            total: statistics.componentRowsObserved,
            returned: statistics.components.length,
            limit,
            truncated: statistics.componentsTruncated,
          },
          totalWithoutSubcircuits: statistics.totalWithoutSubcircuits,
          totalWithSubcircuits: statistics.totalWithSubcircuits,
          evidence: {
            kind: "logisim-project-load" as const,
            proves: [
              "The configured JAR self-reported Logisim-evolution 4.1.0 and loaded the selected staged project and circuit.",
              "Component counts are Logisim CLI output, including its recursive totals.",
            ],
            doesNotProve: [
              "No input combinations were simulated by the statistics command.",
              "Static neutral-netlist conversion completeness is not implied.",
              "Version text does not authenticate the configured JAR binary; official-asset SHA-256 is verified only by this repository's CI fixture run.",
            ],
          },
        },
        context: operationContext,
        nextActions: [
          {
            tool: "logisim_truth_table",
            reason: "Run bounded combinational simulation when appropriate.",
            arguments: {
              path: loaded.file.ref,
              circuit: selected.name,
              expectedProjectDigest: loaded.file.digest,
            },
          },
        ],
      });
    } catch (error) {
      return errorResult(error, { context: operationContext });
    }
  },
);
envelopeTools.set("logisim_component_stats", {
  inputSchema: LogisimComponentStatsInputSchema,
  outputSchema: LogisimComponentStatsOutputSchema,
  registeredTool: logisimComponentStatsTool,
  context: makeLogisimContext,
});

const LogisimTruthTableOutputSchema = envelopeSchema(
  LogisimTruthTableDataSchema,
);
const logisimTruthTableTool = server.registerTool(
  "logisim_truth_table",
  {
    title: "Simulate a bounded Logisim truth table",
    description:
      "Invokes the separately installed JAR, after it self-reports Logisim-evolution 4.1.0, in CSV/binary table mode after statically bounding declared input width.",
    inputSchema: LogisimTruthTableInputSchema,
    outputSchema: LogisimTruthTableOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    path,
    expectedProjectDigest,
    circuit,
    maxInputBits,
    limit,
    timeoutMs,
  }) => {
    let operationContext = makeLogisimContext();
    try {
      const loaded = await loadLogisimProject(
        { path, expectedProjectDigest },
        (context) => {
          operationContext = context;
        },
      );
      requireSafeLogisimRuntimeProject(loaded.project);
      const selected = selectLogisimCircuit(loaded.project, circuit);
      const io = summarizeLogisimCircuitIo(loaded.project, selected.name);
      const pinLabels = io.pins
        .map((pin) => pin.label?.trim())
        .filter((label): label is string => label !== undefined);
      const interfaceIsComplete =
        io.inputBitTotalComplete &&
        io.pinCount > 0 &&
        io.outputPinCount > 0 &&
        pinLabels.length === io.pinCount &&
        pinLabels.every((label) => label.length > 0) &&
        new Set(pinLabels).size === pinLabels.length;
      if (!interfaceIsComplete) {
        throw new ContractFailure({
          code: "UNSUPPORTED_OPERATION",
          category: "project",
          message:
            "Truth-table generation is refused because the selected circuit does not expose at least one uniquely labeled output Pin plus complete metadata for every input/output Pin.",
          retryable: false,
          recovery: [
            "Add at least one output Pin, and give every input/output Pin a unique nonblank label and recognized direction/width.",
            "Use an explicit test vector after confirming its pin contract.",
          ],
        });
      }
      if (
        io.pins.some(
          (pin) =>
            pin.direction === "output" &&
            normalizeLogisim410TtyPinLabel(pin.label) === "halt",
        )
      ) {
        throw new ContractFailure({
          code: "UNSUPPORTED_OPERATION",
          category: "project",
          message:
            'Truth-table generation is refused because Logisim-evolution 4.1.0 treats an output Pin whose label normalizes to reserved "halt" as a TTY run-until-halt control instead of a combinational table output.',
          retryable: false,
          recovery: [
            'Rename the output Pin so Logisim does not normalize it to reserved label "halt".',
            "Use logisim_run_test_vector for bounded explicit assertions.",
          ],
        });
      }
      if (io.inputBitTotal > maxInputBits) {
        throw new ContractFailure({
          code: "QUOTA_EXCEEDED",
          category: "backend",
          message:
            `The selected circuit declares ${io.inputBitTotal} input bits; ` +
            `this call allows ${maxInputBits}.`,
          retryable: false,
          argumentPath: "maxInputBits",
          recovery: [
            `Raise maxInputBits up to ${MAX_LOGISIM_TRUTH_TABLE_INPUT_BITS}, or select a smaller circuit.`,
            "Use logisim_run_test_vector for targeted input cases.",
          ],
        });
      }
      const execution = await withStagedLogisimArtifacts(
        { projectBytes: loaded.file.bytes },
        async ({ projectPath }) =>
          runLogisimTruthTableWithRuntime(projectPath, {
            toplevelCircuit: selected.name,
            maxRows: limit,
            maxColumns: 256,
            timeoutMs,
          }),
      );
      const probe = execution.runtime;
      const table = execution.result;
      const expectedRows = 2 ** io.inputBitTotal;
      if (
        table.columns.length !== io.pinCount ||
        table.rowCount !== expectedRows
      ) {
        throw new LogisimRuntimeError(
          "Logisim's truth-table columns or row count did not match the statically bounded Pin interface.",
          "OUTPUT_INVALID",
          false,
        );
      }
      return logisimSuccessResult({
        summary:
          `Logisim simulated ${table.rowCount} truth-table row(s) for ` +
          `${io.inputBitTotal} declared input bit(s).`,
        data: {
          truthTableVersion: "logisim.truth-table/0.1" as const,
          project: loaded.artifact,
          circuitName: selected.name,
          runtime: logisimRuntimeEvidence(probe),
          inputs: {
            pinCount: io.inputPinCount,
            bitTotal: io.inputBitTotal,
            bitLimit: maxInputBits,
          },
          columns: table.columns,
          rows: table.rows,
          rowBounds: {
            total: table.rowCount,
            returned: table.rows.length,
            limit,
            truncated: table.rowsTruncated,
          },
          valueEncoding: table.valueEncoding,
          delimiter: table.delimiter,
          evidence: {
            kind: "logisim-noninteractive-simulation" as const,
            proves: [
              "The configured JAR self-reported Logisim-evolution 4.1.0 and evaluated the returned staged-project rows.",
              "Values use Logisim's binary CSV truth-table output for the selected circuit.",
            ],
            doesNotProve: [
              "Static parsing does not independently verify every built-in component's semantics.",
              "Sequential timing, analog behavior, and a live GUI session are not represented.",
              "Version text does not authenticate the configured JAR binary; official-asset SHA-256 is verified only by this repository's CI fixture run.",
            ],
          },
        },
        diagnostics: table.rowsTruncated
          ? [
              {
                severity: "warning",
                code: "truth-table-response-truncated",
                path: "rows",
                message:
                  "Logisim evaluated more rows than the response limit returned; raise limit for more rows.",
              },
            ]
          : [],
        context: operationContext,
        nextActions: [
          {
            tool: "logisim_run_test_vector",
            reason:
              "Use assertions in a workspace vector file for regression testing.",
            arguments: {
              path: loaded.file.ref,
              circuit: selected.name,
              vectorPath: "examples/logisim/full-adder.vec",
              expectedProjectDigest: loaded.file.digest,
            },
          },
        ],
      });
    } catch (error) {
      return errorResult(error, { context: operationContext });
    }
  },
);
envelopeTools.set("logisim_truth_table", {
  inputSchema: LogisimTruthTableInputSchema,
  outputSchema: LogisimTruthTableOutputSchema,
  registeredTool: logisimTruthTableTool,
  context: makeLogisimContext,
});

const LogisimTestVectorOutputSchema = envelopeSchema(
  LogisimTestVectorDataSchema,
);
const logisimTestVectorTool = server.registerTool(
  "logisim_run_test_vector",
  {
    title: "Run a Logisim test vector",
    description:
      "Invokes the separately installed JAR, after it self-reports Logisim-evolution 4.1.0, with staged snapshots of a workspace-contained project and .vec/.txt file. Assertion failures return ok=true with data.valid=false.",
    inputSchema: LogisimTestVectorInputSchema,
    outputSchema: LogisimTestVectorOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    path,
    expectedProjectDigest,
    circuit,
    vectorPath,
    expectedVectorDigest,
    maxFailures,
    timeoutMs,
  }) => {
    let operationContext = makeLogisimContext();
    try {
      const loaded = await loadLogisimProject(
        { path, expectedProjectDigest },
        (context) => {
          operationContext = context;
        },
      );
      requireSafeLogisimRuntimeProject(loaded.project);
      const selected = selectLogisimCircuit(loaded.project, circuit);
      const vector = await readLogisimVectorFile(vectorPath);
      requireExpectedVectorDigest(expectedVectorDigest, vector.digest);
      void vector.text;
      const configuredRuntime = resolveLogisimRuntimeConfig();
      const execution = await withStagedLogisimArtifacts(
        {
          projectBytes: loaded.file.bytes,
          vectorBytes: vector.bytes,
          runtimeJarPath: configuredRuntime.jarPath,
        },
        async ({ projectPath, vectorPath, runtimeJarPath }) => {
          if (vectorPath === undefined || runtimeJarPath === undefined) {
            throw new Error(
              "The staged test vector or isolated runtime is missing",
            );
          }
          return runLogisimTestVectorWithRuntime(
            projectPath,
            selected.name,
            vectorPath,
            {
              maxFailures,
              timeoutMs,
              runtime: {
                ...configuredRuntime,
                jarPath: runtimeJarPath,
              },
            },
          );
        },
      );
      const probe = execution.runtime;
      const testResult = execution.result;
      const failures = testResult.failures.map((failure) => {
        const mismatches = boundCollection(
          failure.mismatches,
          MAX_LOGISIM_TEST_MISMATCHES_RETURNED,
        );
        return {
          vectorIndex: failure.vectorIndex,
          mismatches: mismatches.items,
          mismatchBounds: mismatches.bounds,
        };
      });
      return logisimSuccessResult({
        summary: testResult.passed
          ? `Logisim passed all ${testResult.passedVectors} vector(s).`
          : `Logisim passed ${testResult.passedVectors} and failed ${testResult.failedVectors} vector(s).`,
        data: {
          testVectorVersion: "logisim.test-vector/0.1" as const,
          project: loaded.artifact,
          vector: {
            ref: vector.ref,
            bytes: vector.size,
            digest: vector.digest,
          },
          circuitName: selected.name,
          runtime: logisimRuntimeEvidence(probe),
          valid: testResult.passed,
          passedVectors: testResult.passedVectors,
          failedVectors: testResult.failedVectors,
          totalVectors: testResult.totalVectors,
          declaredVectors: testResult.declaredVectors,
          failures,
          failureBounds: {
            total: testResult.failureRowsObserved,
            returned: failures.length,
            limit: maxFailures,
            truncated: testResult.failuresTruncated,
          },
          evidence: {
            kind: "logisim-noninteractive-simulation" as const,
            proves: [
              "The configured JAR self-reported Logisim-evolution 4.1.0 and executed the staged project/vector snapshots.",
              "Pass/fail counts come from Logisim's final summary, not its process exit code.",
            ],
            doesNotProve: [
              "Only vectors present in the supplied file were tested.",
              "No live GUI session, analog behavior, or performance timing is claimed.",
              "Version text does not authenticate the configured JAR binary; official-asset SHA-256 is verified only by this repository's CI fixture run.",
            ],
          },
        },
        diagnostics: testResult.passed
          ? []
          : [
              {
                severity: "error",
                code: "test-vector-failed",
                path: "failures",
                message: `${testResult.failedVectors} of ${testResult.totalVectors} vectors failed.`,
              },
            ],
        context: operationContext,
        nextActions: testResult.passed
          ? []
          : [
              {
                tool: "logisim_truth_table",
                reason:
                  "Inspect bounded combinational output around the failed cases when the circuit is suitable.",
                arguments: {
                  path: loaded.file.ref,
                  circuit: selected.name,
                  expectedProjectDigest: loaded.file.digest,
                },
              },
            ],
      });
    } catch (error) {
      return errorResult(error, {
        context: operationContext,
        vectorConflict: {
          projectPath: path,
          vectorPath,
          ...(circuit === undefined ? {} : { circuit }),
        },
      });
    }
  },
);
envelopeTools.set("logisim_run_test_vector", {
  inputSchema: LogisimTestVectorInputSchema,
  outputSchema: LogisimTestVectorOutputSchema,
  registeredTool: logisimTestVectorTool,
  context: makeLogisimContext,
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
      throw new Error(
        "The tool returned structured content outside its output schema",
      );
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

export async function runServerDoctor(
  options: DoctorCommandOptions = { json: false, smoke: false },
) {
  return runDoctor(options, listRegisteredToolNames());
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
    runServerDoctor,
  );
  process.exitCode = exitCode;
}
