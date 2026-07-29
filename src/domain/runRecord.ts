import { z } from "zod";

import {
  CANONICAL_JSON_PROFILE,
  canonicalJson,
  compareCodeUnits,
  digestCanonicalJson,
} from "./canonical.js";
import type { Diagnostic } from "./experiment.js";
import {
  DuplicateJsonKeyError,
  parseJsonWithoutDuplicateKeys,
} from "./jsonNoDuplicates.js";
import { VerificationCoverageSchema } from "./verification.js";

export const RUN_RECORD_VERSION = "electronics.run-record/0.1" as const;
export const RUN_RECORD_RESOURCE_URI =
  "circuitarium://schemas/run-record/0.1" as const;
export const RUN_RECORD_AUTHENTICITY = "unsigned-unverified" as const;

export const MAX_RUN_RECORD_BYTES = 2 * 1024 * 1024;
export const MAX_RUN_RECORD_DEPTH = 32;
export const MAX_RUN_RECORD_PROPERTIES = 20_000;
export const MAX_RUN_RECORD_STRING_CHARACTERS = 4_096;
export const MAX_RUN_RECORD_STAGES = 24;
export const MAX_RUN_RECORD_TOOL_IDENTITIES = 64;
export const MAX_RUN_RECORD_ARTIFACTS = 128;
export const MAX_RUN_RECORD_ACTIVITIES = 128;
export const MAX_RUN_RECORD_CLAIMS = 64;
export const MAX_RUN_RECORD_EVIDENCE = 128;
export const MAX_RUN_RECORD_DIAGNOSTICS = 200;
export const MAX_RUN_RECORD_RISKS = 128;
export const MAX_RUN_RECORD_SIGNOFFS = 32;
export const MAX_RUN_RECORD_PROVENANCE = 128;
export const MAX_RUN_RECORD_EXTENSIONS = 32;
export const MAX_RUN_RECORD_EXTENSION_BYTES = 64 * 1024;
export const MAX_RUN_RECORD_LINEAGE_PARENTS = 32;
export const MAX_RUN_RECORD_INTENT_ITEMS = 128;

const MAX_IDENTIFIER_CHARACTERS = 128;
const MAX_SHORT_TEXT_CHARACTERS = 256;
const MAX_STATEMENT_CHARACTERS = 1_024;
const MAX_REFERENCE_CHARACTERS = 4_096;
const MAX_UNIT_CHARACTERS = 64;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_CHARACTERS)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u,
    "Use a stable identifier without spaces",
  );
const BoundedNameSchema = z.string().min(1).max(MAX_SHORT_TEXT_CHARACTERS);
const StatementSchema = z.string().min(1).max(MAX_STATEMENT_CHARACTERS);
const Sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

function isRealRfc3339Utc(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(
      value,
    );
  if (match === null) {
    return false;
  }
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, 1);
  instant.setUTCDate(day);
  instant.setUTCHours(hour, minute, second, 0);
  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day &&
    instant.getUTCHours() === hour &&
    instant.getUTCMinutes() === minute &&
    instant.getUTCSeconds() === second
  );
}

const Rfc3339UtcSchema = z
  .string()
  .max(64)
  .refine(isRealRfc3339Utc, {
    message: "Timestamp must name a real instant",
  });
const ExactDecimalSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?(?:0|[1-9]\d*))?$/u,
    "Use an exact decimal string",
  );

function compareExactDecimals(left: string, right: string): number {
  const parse = (
    value: string,
  ): { digits: string; magnitude: bigint; sign: -1 | 0 | 1 } => {
    const match =
      /^(-)?((?:0|[1-9]\d*))(?:\.(\d+))?(?:[eE]([+-]?(?:0|[1-9]\d*)))?$/u.exec(
        value,
      );
    if (match === null) {
      throw new TypeError("Exact decimal input was not schema-valid");
    }
    const fraction = match[3] ?? "";
    const digits = `${match[2] ?? ""}${fraction}`.replace(/^0+/u, "");
    if (digits.length === 0) {
      return { digits: "0", magnitude: 0n, sign: 0 };
    }
    const exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length);
    return {
      digits,
      magnitude: BigInt(digits.length) + exponent,
      sign: match[1] === "-" ? -1 : 1,
    };
  };
  const leftValue = parse(left);
  const rightValue = parse(right);
  if (leftValue.sign !== rightValue.sign) {
    return leftValue.sign < rightValue.sign ? -1 : 1;
  }
  if (leftValue.sign === 0) {
    return 0;
  }
  let absoluteComparison = 0;
  if (leftValue.magnitude !== rightValue.magnitude) {
    absoluteComparison =
      leftValue.magnitude < rightValue.magnitude ? -1 : 1;
  } else {
    const digitsLength = Math.max(
      leftValue.digits.length,
      rightValue.digits.length,
    );
    const normalizedLeft = leftValue.digits.padEnd(digitsLength, "0");
    const normalizedRight = rightValue.digits.padEnd(digitsLength, "0");
    absoluteComparison = compareCodeUnits(normalizedLeft, normalizedRight);
  }
  return leftValue.sign === -1 ? -absoluteComparison : absoluteComparison;
}

function isWorkspaceRelativePosixRef(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

const WorkspaceRefSchema = z
  .string()
  .min(1)
  .max(MAX_REFERENCE_CHARACTERS)
  .refine(isWorkspaceRelativePosixRef, {
    message:
      "Use a workspace-relative POSIX ref without empty, dot, or parent segments",
  });

const SafeUriSchema = z
  .string()
  .min(1)
  .max(MAX_REFERENCE_CHARACTERS)
  .refine((value) => {
    try {
      const uri = new URL(value);
      return (
        ["https:", "urn:"].includes(uri.protocol) &&
        uri.username.length === 0 &&
        uri.password.length === 0
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS or URN reference without embedded credentials");

const ArtifactReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workspace-relative"),
      value: WorkspaceRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("uri"),
      value: SafeUriSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("redacted"),
      reason: BoundedNameSchema,
    })
    .strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);

const ArtifactDigestSchema = z
  .object({
    value: Sha256DigestSchema,
    basis: z.enum(["raw-bytes", "canonical-json"]),
    verification: z.enum(["computed", "reported"]),
  })
  .strict();

export const RunRecordArtifactSchema = z
  .object({
    id: IdentifierSchema,
    state: z.enum(["planned", "materialized", "externally-reported"]),
    role: z.enum([
      "requirements",
      "interface-contract",
      "test-plan",
      "schematic",
      "logic-circuit",
      "source-code",
      "hdl",
      "firmware",
      "constraints",
      "test-vector",
      "waveform",
      "truth-table",
      "netlist",
      "spice-netlist",
      "library",
      "pdk",
      "standard-cell-library",
      "layout",
      "parasitics",
      "timing-report",
      "power-report",
      "drc-report",
      "lvs-report",
      "formal-report",
      "synthesis-report",
      "place-route-report",
      "gds",
      "oasis",
      "mask-data",
      "handoff-manifest",
      "measurement",
      "other",
    ]),
    label: BoundedNameSchema,
    format: BoundedNameSchema.optional(),
    mediaType: z.string().min(1).max(128).optional(),
    reference: ArtifactReferenceSchema,
    digest: ArtifactDigestSchema.optional(),
    byteLength: z.number().int().safe().nonnegative().optional(),
    producedByActivityId: IdentifierSchema.optional(),
    derivedFromArtifactIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
  })
  .strict();

const RequirementSchema = z
  .object({
    id: IdentifierSchema,
    category: z.enum([
      "functional",
      "interface",
      "timing",
      "power",
      "area",
      "thermal",
      "electrical",
      "physical",
      "process",
      "safety",
      "cost",
      "other",
    ]),
    priority: z.enum(["must", "should", "could"]),
    statement: StatementSchema,
    claimIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_CLAIMS)
      .default([]),
  })
  .strict();

const InterfaceContractSchema = z
  .object({
    id: IdentifierSchema,
    name: BoundedNameSchema,
    kind: z.enum([
      "signal",
      "bus",
      "clock",
      "reset",
      "power",
      "ground",
      "analog",
      "protocol",
      "physical",
      "software",
      "other",
    ]),
    direction: z.enum([
      "input",
      "output",
      "inout",
      "supply",
      "internal",
      "not-applicable",
    ]),
    widthBits: z.number().int().safe().min(1).max(1_048_576).optional(),
    clockDomain: BoundedNameSchema.optional(),
    voltageDomain: BoundedNameSchema.optional(),
    description: StatementSchema,
  })
  .strict();

const ConstraintSchema = z
  .object({
    id: IdentifierSchema,
    category: z.enum([
      "timing",
      "power",
      "area",
      "thermal",
      "voltage",
      "current",
      "frequency",
      "process",
      "cost",
      "safety",
      "other",
    ]),
    statement: StatementSchema,
    target: z
      .object({
        relation: z.enum(["exact", "minimum", "maximum", "range", "nominal"]),
        value: ExactDecimalSchema,
        upperValue: ExactDecimalSchema.optional(),
        unit: z.string().min(1).max(MAX_UNIT_CHARACTERS),
      })
      .strict()
      .optional(),
    claimIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_CLAIMS)
      .default([]),
  })
  .strict();

const IntentSchema = z
  .object({
    title: BoundedNameSchema,
    summary: StatementSchema,
    requirements: z
      .array(RequirementSchema)
      .max(MAX_RUN_RECORD_INTENT_ITEMS)
      .default([]),
    interfaces: z
      .array(InterfaceContractSchema)
      .max(MAX_RUN_RECORD_INTENT_ITEMS)
      .default([]),
    constraints: z
      .array(ConstraintSchema)
      .max(MAX_RUN_RECORD_INTENT_ITEMS)
      .default([]),
    assumptions: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            statement: StatementSchema,
            status: z.enum(["open", "accepted", "invalidated"]),
          })
          .strict(),
      )
      .max(MAX_RUN_RECORD_INTENT_ITEMS)
      .default([]),
  })
  .strict();

export const RunRecordStageKindSchema = z.enum([
  "intent-architecture",
  "circuit-construction",
  "behavioral-verification",
  "rtl-design",
  "formal-verification",
  "synthesis",
  "technology-mapping",
  "place-and-route",
  "parasitic-extraction",
  "timing-analysis",
  "power-analysis",
  "physical-layout",
  "drc",
  "lvs",
  "signoff",
  "fabrication-handoff",
  "external",
]);

export const RunRecordStageSchema = z
  .object({
    id: IdentifierSchema,
    sequence: z.number().int().safe().positive(),
    kind: RunRecordStageKindSchema,
    title: BoundedNameSchema,
    status: z.enum([
      "planned",
      "ready",
      "running",
      "completed",
      "blocked",
      "failed",
      "cancelled",
      "skipped",
      "reported-only",
    ]),
    dependsOnStageIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_STAGES)
      .default([]),
    requirementIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_INTENT_ITEMS)
      .default([]),
  })
  .strict();

const ToolIdentitySchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum([
      "mcp-server",
      "mcp-tool",
      "adapter",
      "simulator",
      "compiler",
      "formal-tool",
      "synthesis-tool",
      "place-route-tool",
      "extraction-tool",
      "timing-tool",
      "power-tool",
      "layout-tool",
      "drc-tool",
      "lvs-tool",
      "pdk",
      "external",
    ]),
    name: BoundedNameSchema,
    version: z.string().min(1).max(128).optional(),
    artifactDigest: Sha256DigestSchema.optional(),
    configurationDigest: Sha256DigestSchema.optional(),
    authenticity: z.enum([
      "local-computed-unsigned",
      "self-reported-unverified",
      "caller-reported-unverified",
      "external-unverified",
    ]),
  })
  .strict();

export const RunRecordActivitySchema = z
  .object({
    id: IdentifierSchema,
    sequence: z.number().int().safe().positive(),
    stageId: IdentifierSchema,
    kind: z.enum([
      "mcp-tool-call",
      "subprocess",
      "transformation",
      "simulation",
      "formal-check",
      "measurement",
      "review",
      "external-action",
    ]),
    operation: IdentifierSchema,
    executionStatus: z.enum([
      "not-attempted",
      "running",
      "completed",
      "failed",
      "blocked",
      "cancelled",
      "skipped",
      "reported-only",
    ]),
    outcome: z.enum([
      "not-applicable",
      "observed",
      "pass",
      "fail",
      "inconclusive",
    ]),
    observationBasis: z.enum([
      "none",
      "host-observed",
      "tool-reported",
      "caller-reported",
      "externally-reported",
    ]),
    toolIdentityId: IdentifierSchema.optional(),
    dependsOnActivityIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ACTIVITIES)
      .default([]),
    inputArtifactIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
    outputArtifactIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
    requestDigest: Sha256DigestSchema.optional(),
    resultDigest: Sha256DigestSchema.optional(),
    evidenceIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_EVIDENCE)
      .default([]),
    diagnosticIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_DIAGNOSTICS)
      .default([]),
  })
  .strict();

export const RunRecordEvidenceKindSchema = z.enum([
  "declaration",
  "expected-specification",
  "static-analysis",
  "static-netlist",
  "static-erc",
  "simulator-project-load",
  "simulation-trace",
  "spice-simulation",
  "truth-table",
  "test-vector",
  "formal-proof",
  "synthesis-report",
  "place-route-report",
  "extraction-report",
  "timing-report",
  "power-report",
  "drc-report",
  "lvs-report",
  "physical-measurement",
  "qualified-review",
  "fabrication-receipt",
  "external",
]);

export const RunRecordEvidenceSchema = z
  .object({
    id: IdentifierSchema,
    kind: RunRecordEvidenceKindSchema,
    source: z.string().min(1).max(MAX_SHORT_TEXT_CHARACTERS),
    outcome: z.enum(["observed", "pass", "fail", "inconclusive"]),
    authenticity: z.enum([
      "local-computed-unsigned",
      "tool-reported-unverified",
      "caller-reported-unverified",
      "external-unverified",
    ]),
    activityId: IdentifierSchema.optional(),
    artifactIds: z
      .array(IdentifierSchema)
      .min(1)
      .max(MAX_RUN_RECORD_ARTIFACTS),
    resultDigest: Sha256DigestSchema.optional(),
    coverage: VerificationCoverageSchema.optional(),
    summary: StatementSchema,
  })
  .strict();

export const RunRecordClaimSchema = z
  .object({
    id: IdentifierSchema,
    class: z.enum([
      "artifact-structure",
      "functional",
      "interface",
      "timing",
      "power",
      "area",
      "thermal",
      "electrical",
      "logical-equivalence",
      "drc",
      "lvs",
      "manufacturability",
      "physical-hardware",
      "safety",
      "other",
    ]),
    statement: StatementSchema,
    verdict: z.enum([
      "not-assessed",
      "pass",
      "fail",
      "inconclusive",
      "unsupported",
      "withdrawn",
    ]),
    basis: z.enum([
      "none",
      "declared",
      "reported-evidence",
      "validated-evidence",
      "independent-review",
    ]),
    stageIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_STAGES)
      .default([]),
    artifactIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
    evidenceIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_EVIDENCE)
      .default([]),
  })
  .strict();

const RunDiagnosticSchema = z
  .object({
    id: IdentifierSchema,
    severity: z.enum(["info", "warning", "error", "critical"]),
    code: z.string().min(1).max(128),
    message: StatementSchema,
    status: z.enum(["open", "resolved", "accepted"]),
    stageId: IdentifierSchema.optional(),
    activityId: IdentifierSchema.optional(),
    artifactIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
  })
  .strict();

const RiskSchema = z
  .object({
    id: IdentifierSchema,
    severity: z.enum(["low", "medium", "high", "critical"]),
    statement: StatementSchema,
    status: z.enum(["open", "mitigated", "accepted", "transferred"]),
    evidenceIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_EVIDENCE)
      .default([]),
  })
  .strict();

const SignoffSchema = z
  .object({
    id: IdentifierSchema,
    stageId: IdentifierSchema.optional(),
    status: z.enum([
      "not-requested",
      "pending",
      "accepted",
      "accepted-with-conditions",
      "rejected",
      "deferred",
    ]),
    authorityKind: z.enum(["external-human", "external-system"]),
    authenticity: z.literal("caller-reported-unverified"),
    claimIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_CLAIMS)
      .default([]),
    artifactIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
    evidenceIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_EVIDENCE)
      .default([]),
    acceptedRiskIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_RISKS)
      .default([]),
    conditions: z.array(StatementSchema).max(32).default([]),
    scopeStatement: StatementSchema,
  })
  .strict();

const ProvenanceSchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum([
      "generated",
      "derived",
      "imported",
      "measured",
      "reported",
      "reviewed",
    ]),
    subjectType: z.enum(["artifact", "activity", "evidence", "claim"]),
    subjectId: IdentifierSchema,
    sourceArtifactIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
    sourceRecordDigests: z
      .array(Sha256DigestSchema)
      .max(MAX_RUN_RECORD_LINEAGE_PARENTS)
      .default([]),
    authenticity: z.enum([
      "local-computed-unsigned",
      "caller-reported-unverified",
      "external-unverified",
    ]),
    statement: StatementSchema,
  })
  .strict();

const ExtensionAppliesToSchema = z
  .object({
    stageIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_STAGES)
      .default([]),
    activityIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ACTIVITIES)
      .default([]),
    artifactIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
    evidenceIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_EVIDENCE)
      .default([]),
    claimIds: z
      .array(IdentifierSchema)
      .max(MAX_RUN_RECORD_CLAIMS)
      .default([]),
  })
  .strict();

const ExtensionIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)+\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u,
    "Use a reverse-domain namespaced extension identifier",
  );

export const CRUMB_RUN_RECORD_EXTENSION_ID =
  "io.github.craftiee.circuitarium/crumb-unity/0.1" as const;
export const LOGISIM_RUN_RECORD_EXTENSION_ID =
  "io.github.craftiee.circuitarium/logisim-evolution/0.1" as const;

const RunRecordExtensionSchema = z
  .object({
    extensionId: ExtensionIdSchema,
    schemaVersion: z.string().min(1).max(128),
    schemaUri: SafeUriSchema.optional(),
    critical: z.boolean(),
    appliesTo: ExtensionAppliesToSchema,
    payload: z.json(),
    payloadDigest: Sha256DigestSchema.optional(),
  })
  .strict();

const DisclosureSchema = z
  .object({
    rawCommandsIncluded: z.literal(false),
    environmentValuesIncluded: z.literal(false),
    absolutePathsIncluded: z.literal(false),
    rawPayloadsIncluded: z.literal(false),
    userAuthoredTextMayContainSensitiveData: z.literal(true),
    notes: z.array(StatementSchema).max(32).default([]),
  })
  .strict();

const CompletenessSchema = z
  .object({
    status: z.enum(["complete", "partial"]),
    omittedSections: z
      .array(
        z.enum([
          "intent",
          "stages",
          "toolchain",
          "artifacts",
          "activities",
          "claims",
          "evidence",
          "diagnostics",
          "risks",
          "signoffs",
          "provenance",
          "extensions",
        ]),
      )
      .max(32)
      .default([]),
    reasons: z.array(StatementSchema).max(32).default([]),
  })
  .strict();

export const RunRecordContentSchema = z
  .object({
    intent: IntentSchema,
    stages: z.array(RunRecordStageSchema).max(MAX_RUN_RECORD_STAGES),
    toolchain: z
      .array(ToolIdentitySchema)
      .max(MAX_RUN_RECORD_TOOL_IDENTITIES)
      .default([]),
    artifacts: z
      .array(RunRecordArtifactSchema)
      .max(MAX_RUN_RECORD_ARTIFACTS)
      .default([]),
    activities: z
      .array(RunRecordActivitySchema)
      .max(MAX_RUN_RECORD_ACTIVITIES)
      .default([]),
    claims: z
      .array(RunRecordClaimSchema)
      .max(MAX_RUN_RECORD_CLAIMS)
      .default([]),
    evidence: z
      .array(RunRecordEvidenceSchema)
      .max(MAX_RUN_RECORD_EVIDENCE)
      .default([]),
    diagnostics: z
      .array(RunDiagnosticSchema)
      .max(MAX_RUN_RECORD_DIAGNOSTICS)
      .default([]),
    risks: z.array(RiskSchema).max(MAX_RUN_RECORD_RISKS).default([]),
    signoffs: z
      .array(SignoffSchema)
      .max(MAX_RUN_RECORD_SIGNOFFS)
      .default([]),
    provenance: z
      .array(ProvenanceSchema)
      .max(MAX_RUN_RECORD_PROVENANCE)
      .default([]),
    extensions: z
      .array(RunRecordExtensionSchema)
      .max(MAX_RUN_RECORD_EXTENSIONS)
      .default([]),
    disclosure: DisclosureSchema,
    completeness: CompletenessSchema,
  })
  .strict();

const RunMetadataSchema = z
  .object({
    executionId: IdentifierSchema.optional(),
    capturedAt: Rfc3339UtcSchema.optional(),
    serverInstanceId: IdentifierSchema.optional(),
    activityTiming: z
      .array(
        z
          .object({
            activityId: IdentifierSchema,
            startedAt: Rfc3339UtcSchema.optional(),
            finishedAt: Rfc3339UtcSchema.optional(),
            durationMilliseconds: z
              .number()
              .int()
              .safe()
              .nonnegative()
              .optional(),
          })
          .strict(),
      )
      .max(MAX_RUN_RECORD_ACTIVITIES)
      .default([]),
  })
  .strict();

const ParentRecordSchema = z
  .object({
    recordId: IdentifierSchema,
    recordDigest: Sha256DigestSchema,
    relation: z.enum([
      "continuation",
      "retry-of",
      "branch-of",
      "derived-from",
      "supersedes",
      "aggregates",
    ]),
  })
  .strict();

const LineageSchema = z
  .object({
    parents: z
      .array(ParentRecordSchema)
      .max(MAX_RUN_RECORD_LINEAGE_PARENTS)
      .default([]),
  })
  .strict();

const CollectionBoundsSchema = z
  .object({
    stages: z.number().int().safe().nonnegative(),
    toolchain: z.number().int().safe().nonnegative(),
    artifacts: z.number().int().safe().nonnegative(),
    activities: z.number().int().safe().nonnegative(),
    claims: z.number().int().safe().nonnegative(),
    evidence: z.number().int().safe().nonnegative(),
    diagnostics: z.number().int().safe().nonnegative(),
    risks: z.number().int().safe().nonnegative(),
    signoffs: z.number().int().safe().nonnegative(),
    provenance: z.number().int().safe().nonnegative(),
    extensions: z.number().int().safe().nonnegative(),
    truncated: z.literal(false),
  })
  .strict();

export const RunRecordSealSchema = z
  .object({
    canonicalization: z.literal(CANONICAL_JSON_PROFILE),
    evidenceDigest: Sha256DigestSchema,
    recordDigest: Sha256DigestSchema,
    authenticity: z.literal(RUN_RECORD_AUTHENTICITY),
    evidenceDigestScope: z.literal("content"),
    recordDigestScope: z.literal("record-excluding-seal"),
    collectionBounds: CollectionBoundsSchema,
  })
  .strict();

export const RunRecordSchema = z
  .object({
    schemaVersion: z.literal(RUN_RECORD_VERSION),
    recordId: IdentifierSchema,
    recordType: z.enum(["run", "aggregate"]),
    recordStatus: z.enum(["open", "closed", "superseded"]),
    metadata: RunMetadataSchema.default({ activityTiming: [] }),
    lineage: LineageSchema.default({ parents: [] }),
    content: RunRecordContentSchema,
    seal: RunRecordSealSchema.optional(),
  })
  .strict();

export const SealedRunRecordSchema = RunRecordSchema.extend({
  seal: RunRecordSealSchema,
});

export const RunRecordValidationInputSchema = z
  .object({
    record: z
      .json()
      .describe(
        "One already-parsed run-record JSON value. Use serializedRecord instead when validating an external JSON document so duplicate keys can be rejected.",
      )
      .optional(),
    serializedRecord: z
      .string()
      .min(1)
      .max(MAX_RUN_RECORD_BYTES)
      .describe(
        "One raw external JSON document. Preferred for file or cross-host handoff because duplicate and escaped-equivalent keys are rejected before parsing.",
      )
      .optional(),
    expectedRecordDigest: Sha256DigestSchema.describe(
      "Optional record digest obtained through a separately trusted channel; a digest carried only beside the record does not authenticate it.",
    ).optional(),
    expectedEvidenceDigest: Sha256DigestSchema.describe(
      "Optional evidence digest obtained through a separately trusted channel; a digest carried only beside the record does not authenticate it.",
    ).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.record === undefined) ===
      (input.serializedRecord === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["record"],
        message:
          "Provide exactly one of record or serializedRecord; use serializedRecord for duplicate-aware external JSON validation",
      });
    }
  });

export const RunRecordValidationDataSchema = z
  .object({
    valid: z.boolean(),
    schemaVersion: z.literal(RUN_RECORD_VERSION).optional(),
    recordDigest: Sha256DigestSchema.optional(),
    evidenceDigest: Sha256DigestSchema.optional(),
    authenticity: z.literal(RUN_RECORD_AUTHENTICITY).optional(),
    sealedRecord: SealedRunRecordSchema.optional(),
    counts: CollectionBoundsSchema.optional(),
  })
  .strict();

export type RunRecord = z.infer<typeof RunRecordSchema>;
export type SealedRunRecord = z.infer<typeof SealedRunRecordSchema>;
type RunRecordContent = z.infer<typeof RunRecordContentSchema>;
type RunRecordExtension = z.infer<typeof RunRecordExtensionSchema>;

const CrumbExtensionPayloadSchema = z
  .object({
    backendId: z.literal("crumb.file"),
    adapterVersion: z.string().min(1).max(128),
    compatibilityProfile: z.literal("crumb.unity/1.3.5"),
    projectArtifactId: IdentifierSchema,
    topologyMode: z.enum(["direct-only", "known-board-v1.3.5"]),
    applySwitchStates: z.boolean(),
  })
  .strict();

const LogisimExtensionPayloadSchema = z
  .object({
    backendId: z.literal("logisim.evolution"),
    adapterVersion: z.string().min(1).max(128),
    compatibilityProfile: z.literal("logisim-evolution/4.1.0"),
    projectArtifactId: IdentifierSchema,
    circuit: z.string().min(1).max(256),
    vectorArtifactId: IdentifierSchema.optional(),
    runtimeStatus: z.enum([
      "available",
      "unconfigured",
      "unavailable",
      "version-mismatch",
      "unknown",
    ]),
    runtimeVersion: z.string().min(1).max(128).optional(),
    runtimeAuthenticity: z
      .literal("self-reported-unverified")
      .optional(),
    runtimeSafety: z.enum(["safe", "blocked", "unknown"]),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      ["available", "version-mismatch"].includes(payload.runtimeStatus) &&
      (payload.runtimeVersion === undefined ||
        payload.runtimeAuthenticity === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtimeStatus"],
        message:
          "An available or version-mismatched runtime requires runtimeVersion and self-reported-unverified runtimeAuthenticity",
      });
    }
    if (
      payload.runtimeStatus === "available" &&
      payload.runtimeVersion !== "4.1.0"
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtimeVersion"],
        message:
          "runtimeStatus=available requires the pinned Logisim-evolution runtime version 4.1.0",
      });
    }
    if (
      payload.runtimeStatus === "version-mismatch" &&
      payload.runtimeVersion === "4.1.0"
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtimeVersion"],
        message:
          "runtimeStatus=version-mismatch requires a version other than the pinned 4.1.0 runtime",
      });
    }
    if (
      ["unconfigured", "unavailable", "unknown"].includes(
        payload.runtimeStatus,
      ) &&
      (payload.runtimeVersion !== undefined ||
        payload.runtimeAuthenticity !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtimeVersion"],
        message:
          "An unconfigured, unavailable, or unknown runtime cannot report an executed runtime identity",
      });
    }
  });

const KNOWN_EXTENSION_SCHEMAS = new Map<string, z.ZodType>([
  [CRUMB_RUN_RECORD_EXTENSION_ID, CrumbExtensionPayloadSchema],
  [LOGISIM_RUN_RECORD_EXTENSION_ID, LogisimExtensionPayloadSchema],
]);

const RESERVED_EXTENSION_KEYS = new Set([
  "claims",
  "verdict",
  "signoffs",
  "seal",
  "recordDigest",
  "evidenceDigest",
  "authenticity",
]);

function diagnostic(
  diagnostics: Diagnostic[],
  code: string,
  path: string,
  message: string,
  severity: Diagnostic["severity"] = "error",
): void {
  diagnostics.push({ severity, code, path, message });
}

function inspectJsonBounds(value: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number; path: string }> = [
    { value, depth: 0, path: "record" },
  ];
  let propertyCount = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      break;
    }
    if (current.depth > MAX_RUN_RECORD_DEPTH) {
      diagnostic(
        diagnostics,
        "record-depth",
        current.path,
        `Run records may be at most ${MAX_RUN_RECORD_DEPTH} levels deep.`,
      );
      break;
    }
    const item = current.value;
    if (typeof item === "string") {
      if (item.length > MAX_RUN_RECORD_STRING_CHARACTERS) {
        diagnostic(
          diagnostics,
          "record-string-bound",
          current.path,
          `Run-record strings may contain at most ${MAX_RUN_RECORD_STRING_CHARACTERS} UTF-16 code units.`,
        );
      }
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        diagnostic(
          diagnostics,
          "record-number",
          current.path,
          "Run records cannot contain NaN or infinity.",
        );
      } else if (Number.isInteger(item) && !Number.isSafeInteger(item)) {
        diagnostic(
          diagnostics,
          "record-unsafe-integer",
          current.path,
          "Integer values must be within the JavaScript safe-integer range.",
        );
      }
      continue;
    }
    if (item === null || typeof item === "boolean") {
      continue;
    }
    if (typeof item !== "object") {
      diagnostic(
        diagnostics,
        "record-json",
        current.path,
        "Run records accept JSON values only.",
      );
      continue;
    }
    if (seen.has(item)) {
      diagnostic(
        diagnostics,
        "record-cycle",
        current.path,
        "Run records cannot contain object cycles.",
      );
      continue;
    }
    seen.add(item);
    if (Array.isArray(item)) {
      propertyCount += item.length;
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: item[index],
          depth: current.depth + 1,
          path: `${current.path}.${index}`,
        });
      }
    } else {
      const entries = Object.entries(item as Record<string, unknown>);
      propertyCount += entries.length;
      for (const [key, child] of entries) {
        if (["__proto__", "prototype", "constructor"].includes(key)) {
          diagnostic(
            diagnostics,
            "record-property-name",
            current.path,
            `Property ${JSON.stringify(key)} is not allowed.`,
          );
        }
        stack.push({
          value: child,
          depth: current.depth + 1,
          path: `${current.path}.${key}`,
        });
      }
    }
    if (propertyCount > MAX_RUN_RECORD_PROPERTIES) {
      diagnostic(
        diagnostics,
        "record-property-bound",
        "record",
        `Run records may contain at most ${MAX_RUN_RECORD_PROPERTIES} aggregate array entries and object properties.`,
      );
      break;
    }
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      diagnostic(
        diagnostics,
        "record-json",
        "record",
        "Run records accept JSON objects only.",
      );
    } else if (Buffer.byteLength(serialized, "utf8") > MAX_RUN_RECORD_BYTES) {
      diagnostic(
        diagnostics,
        "record-byte-bound",
        "record",
        `Run records may contain at most ${MAX_RUN_RECORD_BYTES} encoded JSON bytes.`,
      );
    }
  } catch {
    diagnostic(
      diagnostics,
      "record-json",
      "record",
      "Run records must be serializable as bounded JSON.",
    );
  }
  return diagnostics;
}

function reportDuplicates(
  values: readonly string[],
  path: string,
  noun: string,
  diagnostics: Diagnostic[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      diagnostic(
        diagnostics,
        "duplicate-id",
        path,
        `Duplicate ${noun} identifier: ${value}`,
      );
    }
    seen.add(value);
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...values].sort(compareCodeUnits);
}

function sortById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
}

function normalizeContent(content: RunRecordContent): RunRecordContent {
  return {
    ...content,
    intent: {
      ...content.intent,
      requirements: sortById(content.intent.requirements).map((item) => ({
        ...item,
        claimIds: sortedUnique(item.claimIds),
      })),
      interfaces: sortById(content.intent.interfaces),
      constraints: sortById(content.intent.constraints).map((item) => ({
        ...item,
        claimIds: sortedUnique(item.claimIds),
      })),
      assumptions: sortById(content.intent.assumptions),
    },
    stages: content.stages.map((stage) => ({
      ...stage,
      dependsOnStageIds: sortedUnique(stage.dependsOnStageIds),
      requirementIds: sortedUnique(stage.requirementIds),
    })),
    toolchain: sortById(content.toolchain),
    artifacts: sortById(content.artifacts).map((artifact) => ({
      ...artifact,
      derivedFromArtifactIds: sortedUnique(artifact.derivedFromArtifactIds),
    })),
    activities: content.activities.map((activity) => ({
      ...activity,
      dependsOnActivityIds: sortedUnique(activity.dependsOnActivityIds),
      inputArtifactIds: sortedUnique(activity.inputArtifactIds),
      outputArtifactIds: sortedUnique(activity.outputArtifactIds),
      evidenceIds: sortedUnique(activity.evidenceIds),
      diagnosticIds: sortedUnique(activity.diagnosticIds),
    })),
    claims: sortById(content.claims).map((claim) => ({
      ...claim,
      stageIds: sortedUnique(claim.stageIds),
      artifactIds: sortedUnique(claim.artifactIds),
      evidenceIds: sortedUnique(claim.evidenceIds),
    })),
    evidence: sortById(content.evidence).map((evidence) => ({
      ...evidence,
      artifactIds: sortedUnique(evidence.artifactIds),
    })),
    diagnostics: sortById(content.diagnostics).map((item) => ({
      ...item,
      artifactIds: sortedUnique(item.artifactIds),
    })),
    risks: sortById(content.risks).map((risk) => ({
      ...risk,
      evidenceIds: sortedUnique(risk.evidenceIds),
    })),
    signoffs: sortById(content.signoffs).map((signoff) => ({
      ...signoff,
      claimIds: sortedUnique(signoff.claimIds),
      artifactIds: sortedUnique(signoff.artifactIds),
      evidenceIds: sortedUnique(signoff.evidenceIds),
      acceptedRiskIds: sortedUnique(signoff.acceptedRiskIds),
    })),
    provenance: sortById(content.provenance).map((item) => ({
      ...item,
      sourceArtifactIds: sortedUnique(item.sourceArtifactIds),
      sourceRecordDigests: sortedUnique(item.sourceRecordDigests),
    })),
    extensions: [...content.extensions]
      .map((extension) => ({
        ...extension,
        appliesTo: {
          stageIds: sortedUnique(extension.appliesTo.stageIds),
          activityIds: sortedUnique(extension.appliesTo.activityIds),
          artifactIds: sortedUnique(extension.appliesTo.artifactIds),
          evidenceIds: sortedUnique(extension.appliesTo.evidenceIds),
          claimIds: sortedUnique(extension.appliesTo.claimIds),
        },
        payloadDigest: digestCanonicalJson(extension.payload),
      }))
      .sort((left, right) =>
        compareCodeUnits(left.extensionId, right.extensionId),
      ),
    disclosure: {
      ...content.disclosure,
      notes: [...content.disclosure.notes].sort(compareCodeUnits),
    },
    completeness: {
      ...content.completeness,
      omittedSections: [...content.completeness.omittedSections].sort(
        compareCodeUnits,
      ),
      reasons: [...content.completeness.reasons].sort(compareCodeUnits),
    },
  };
}

function collectionBounds(content: RunRecordContent) {
  return {
    stages: content.stages.length,
    toolchain: content.toolchain.length,
    artifacts: content.artifacts.length,
    activities: content.activities.length,
    claims: content.claims.length,
    evidence: content.evidence.length,
    diagnostics: content.diagnostics.length,
    risks: content.risks.length,
    signoffs: content.signoffs.length,
    provenance: content.provenance.length,
    extensions: content.extensions.length,
    truncated: false as const,
  };
}

function checkReferences(
  values: readonly string[],
  known: ReadonlySet<string>,
  path: string,
  noun: string,
  diagnostics: Diagnostic[],
): void {
  reportDuplicates(values, path, `${noun} reference`, diagnostics);
  for (const value of values) {
    if (!known.has(value)) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        path,
        `Unknown ${noun} identifier: ${value}`,
      );
    }
  }
}

function artifactDependencyMap(
  artifacts: RunRecord["content"]["artifacts"],
  activities: RunRecord["content"]["activities"],
  provenance: RunRecord["content"]["provenance"],
): Map<string, string[]> {
  return new Map(
    artifacts.map((artifact) => {
      const producer = activities.find(
        (activity) => activity.id === artifact.producedByActivityId,
      );
      return [
        artifact.id,
        [
          ...artifact.derivedFromArtifactIds,
          ...(producer?.inputArtifactIds ?? []),
          ...provenance.flatMap((item) =>
            item.subjectType === "artifact" &&
            item.subjectId === artifact.id
              ? item.sourceArtifactIds
              : [],
          ),
        ],
      ];
    }),
  );
}

function checkArtifactCycles(
  artifacts: RunRecord["content"]["artifacts"],
  activities: RunRecord["content"]["activities"],
  provenance: RunRecord["content"]["provenance"],
  diagnostics: Diagnostic[],
): void {
  const dependencies = artifactDependencyMap(
    artifacts,
    activities,
    provenance,
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (artifactId: string): void => {
    if (visited.has(artifactId)) {
      return;
    }
    if (visiting.has(artifactId)) {
      diagnostic(
        diagnostics,
        "artifact-cycle",
        "content.artifacts",
        `Artifact lineage contains a cycle through ${artifactId}.`,
      );
      return;
    }
    visiting.add(artifactId);
    for (const dependency of dependencies.get(artifactId) ?? []) {
      visit(dependency);
    }
    visiting.delete(artifactId);
    visited.add(artifactId);
  };
  for (const artifact of artifacts) {
    visit(artifact.id);
  }
}

function artifactDerivesFromAny(
  artifactId: string,
  targetArtifactIds: ReadonlySet<string>,
  artifacts: RunRecord["content"]["artifacts"],
  activities: RunRecord["content"]["activities"],
  provenance: RunRecord["content"]["provenance"],
): boolean {
  const targetDigestIdentities = new Set(
    artifacts.flatMap((artifact) =>
      targetArtifactIds.has(artifact.id) && artifact.digest !== undefined
        ? [artifact.digest.value]
        : [],
    ),
  );
  const hasTargetIdentity = (candidateId: string): boolean => {
    if (targetArtifactIds.has(candidateId)) {
      return true;
    }
    const candidate = artifacts.find(
      (artifact) => artifact.id === candidateId,
    );
    return (
      candidate?.digest !== undefined &&
      targetDigestIdentities.has(candidate.digest.value)
    );
  };
  if (hasTargetIdentity(artifactId)) {
    return true;
  }
  const dependencies = artifactDependencyMap(
    artifacts,
    activities,
    provenance,
  );
  const visited = new Set<string>();
  const pending = [...(dependencies.get(artifactId) ?? [])];
  while (pending.length > 0) {
    const dependencyId = pending.pop();
    if (dependencyId === undefined || visited.has(dependencyId)) {
      continue;
    }
    if (hasTargetIdentity(dependencyId)) {
      return true;
    }
    visited.add(dependencyId);
    pending.push(...(dependencies.get(dependencyId) ?? []));
  }
  return false;
}

const IMPLEMENTATION_ARTIFACT_ROLES = new Set<
  RunRecord["content"]["artifacts"][number]["role"]
>([
  "schematic",
  "logic-circuit",
  "source-code",
  "hdl",
  "firmware",
  "netlist",
  "spice-netlist",
  "layout",
  "parasitics",
  "gds",
  "oasis",
  "mask-data",
]);

const SUBJECT_ARTIFACT_ROLES = new Set<
  RunRecord["content"]["artifacts"][number]["role"]
>([
  ...IMPLEMENTATION_ARTIFACT_ROLES,
  "library",
  "pdk",
  "standard-cell-library",
]);

const CLAIM_SUPPORT: Record<
  RunRecord["content"]["claims"][number]["class"],
  ReadonlySet<RunRecord["content"]["evidence"][number]["kind"]>
> = {
  "artifact-structure": new Set([
    "static-analysis",
    "static-netlist",
    "simulator-project-load",
    "qualified-review",
  ]),
  functional: new Set([
    "simulation-trace",
    "spice-simulation",
    "truth-table",
    "test-vector",
    "formal-proof",
    "physical-measurement",
    "qualified-review",
  ]),
  interface: new Set([
    "static-analysis",
    "simulation-trace",
    "test-vector",
    "formal-proof",
    "physical-measurement",
    "qualified-review",
  ]),
  timing: new Set([
    "simulation-trace",
    "spice-simulation",
    "timing-report",
    "physical-measurement",
    "qualified-review",
  ]),
  power: new Set([
    "spice-simulation",
    "power-report",
    "physical-measurement",
    "qualified-review",
  ]),
  area: new Set([
    "synthesis-report",
    "place-route-report",
    "qualified-review",
  ]),
  thermal: new Set([
    "power-report",
    "physical-measurement",
    "qualified-review",
  ]),
  electrical: new Set([
    "static-erc",
    "spice-simulation",
    "physical-measurement",
    "qualified-review",
  ]),
  "logical-equivalence": new Set([
    "test-vector",
    "formal-proof",
    "lvs-report",
    "qualified-review",
  ]),
  drc: new Set(["drc-report", "qualified-review"]),
  lvs: new Set(["lvs-report", "qualified-review"]),
  manufacturability: new Set([
    "drc-report",
    "lvs-report",
    "qualified-review",
    "fabrication-receipt",
  ]),
  "physical-hardware": new Set([
    "physical-measurement",
    "qualified-review",
    "fabrication-receipt",
  ]),
  safety: new Set(["physical-measurement", "qualified-review"]),
  other: new Set([
    "static-analysis",
    "static-netlist",
    "static-erc",
    "simulator-project-load",
    "simulation-trace",
    "spice-simulation",
    "truth-table",
    "test-vector",
    "formal-proof",
    "synthesis-report",
    "place-route-report",
    "extraction-report",
    "timing-report",
    "power-report",
    "drc-report",
    "lvs-report",
    "physical-measurement",
    "qualified-review",
    "fabrication-receipt",
    "external",
  ]),
};

type ActivityKind = RunRecord["content"]["activities"][number]["kind"];
type EvidenceKind = RunRecord["content"]["evidence"][number]["kind"];

const EVIDENCE_ACTIVITY_KINDS: Record<
  EvidenceKind,
  ReadonlySet<ActivityKind>
> = {
  declaration: new Set([
    "mcp-tool-call",
    "transformation",
    "review",
    "external-action",
  ]),
  "expected-specification": new Set([
    "transformation",
    "review",
    "external-action",
  ]),
  "static-analysis": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "static-netlist": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "static-erc": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "simulator-project-load": new Set([
    "mcp-tool-call",
    "subprocess",
    "simulation",
  ]),
  "simulation-trace": new Set(["simulation"]),
  "spice-simulation": new Set(["simulation"]),
  "truth-table": new Set(["simulation"]),
  "test-vector": new Set(["simulation"]),
  "formal-proof": new Set(["formal-check"]),
  "synthesis-report": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "place-route-report": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "extraction-report": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "timing-report": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "power-report": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "drc-report": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "lvs-report": new Set([
    "mcp-tool-call",
    "subprocess",
    "transformation",
  ]),
  "physical-measurement": new Set(["measurement", "external-action"]),
  "qualified-review": new Set(["review", "external-action"]),
  "fabrication-receipt": new Set(["external-action"]),
  external: new Set(["external-action"]),
};

const KNOWN_OPERATION_EVIDENCE_KINDS = new Map<
  string,
  ReadonlySet<EvidenceKind>
>([
  ["electronics_capabilities", new Set()],
  ["electronics_validate_experiment", new Set(["declaration"])],
  ["electronics_plan_verification", new Set(["declaration"])],
  ["electronics_validate_run_record", new Set()],
  ["crumb_component_catalog", new Set(["declaration"])],
  ["crumb_analyze_design", new Set(["static-analysis"])],
  ["crumb_compare_designs", new Set(["static-analysis"])],
  ["crumb_inspect_design", new Set(["static-analysis"])],
  ["crumb_validate_design", new Set(["static-analysis"])],
  ["crumb_generate_fixture", new Set(["declaration"])],
  ["crumb_list_projects", new Set()],
  ["crumb_get_component", new Set(["static-analysis"])],
  ["crumb_bom", new Set(["static-analysis"])],
  ["crumb_ic_reference", new Set(["declaration"])],
  ["crumb_export_netlist", new Set(["static-netlist"])],
  ["crumb_trace_net", new Set(["static-netlist"])],
  ["crumb_check_design", new Set(["static-erc"])],
  ["logisim_list_projects", new Set()],
  ["logisim_analyze_design", new Set(["static-analysis"])],
  ["logisim_export_netlist", new Set(["static-netlist"])],
  ["logisim_component_stats", new Set(["simulator-project-load"])],
  ["logisim_truth_table", new Set(["truth-table"])],
  ["logisim_run_test_vector", new Set(["test-vector"])],
]);

const CRUMB_PROJECT_OPERATIONS = new Set([
  "crumb_analyze_design",
  "crumb_inspect_design",
  "crumb_validate_design",
  "crumb_get_component",
  "crumb_bom",
  "crumb_export_netlist",
  "crumb_trace_net",
  "crumb_check_design",
]);

const LOGISIM_PROJECT_OPERATIONS = new Set([
  "logisim_analyze_design",
  "logisim_export_netlist",
  "logisim_component_stats",
  "logisim_truth_table",
  "logisim_run_test_vector",
]);

function validateExtensions(
  extensions: readonly RunRecordExtension[],
  content: RunRecordContent,
  diagnostics: Diagnostic[],
): void {
  const artifactIds = new Set(content.artifacts.map((item) => item.id));
  for (const [index, extension] of extensions.entries()) {
    const path = `content.extensions.${index}`;
    const payloadBytes = Buffer.byteLength(
      JSON.stringify(extension.payload),
      "utf8",
    );
    if (payloadBytes > MAX_RUN_RECORD_EXTENSION_BYTES) {
      diagnostic(
        diagnostics,
        "extension-byte-bound",
        `${path}.payload`,
        `One extension payload may contain at most ${MAX_RUN_RECORD_EXTENSION_BYTES} encoded JSON bytes.`,
      );
    }
    if (
      extension.payload !== null &&
      !Array.isArray(extension.payload) &&
      typeof extension.payload === "object"
    ) {
      for (const key of Object.keys(extension.payload)) {
        if (RESERVED_EXTENSION_KEYS.has(key)) {
          diagnostic(
            diagnostics,
            "extension-core-shadow",
            `${path}.payload.${key}`,
            "Extensions cannot shadow or override core run-record semantics.",
          );
        }
      }
    }
    const expectedPayloadDigest = digestCanonicalJson(extension.payload);
    if (
      extension.payloadDigest !== undefined &&
      extension.payloadDigest !== expectedPayloadDigest
    ) {
      diagnostic(
        diagnostics,
        "extension-digest-conflict",
        `${path}.payloadDigest`,
        "The reported extension payload digest does not match its canonical payload.",
      );
    }
    const knownSchema = KNOWN_EXTENSION_SCHEMAS.get(extension.extensionId);
    if (knownSchema === undefined) {
      diagnostic(
        diagnostics,
        extension.critical
          ? "unknown-critical-extension"
          : "unknown-extension-preserved",
        `${path}.extensionId`,
        extension.critical
          ? "This critical extension is unknown, so the record cannot be validated safely."
          : "This noncritical extension is preserved but its payload is not interpreted.",
        extension.critical ? "error" : "info",
      );
      continue;
    }
    if (extension.schemaVersion !== "0.1") {
      diagnostic(
        diagnostics,
        "extension-version",
        `${path}.schemaVersion`,
        "Known Circuitarium run-record extensions require schemaVersion=0.1.",
      );
    }
    const payload = knownSchema.safeParse(extension.payload);
    if (!payload.success) {
      for (const issue of payload.error.issues) {
        diagnostic(
          diagnostics,
          "extension-schema",
          `${path}.payload.${issue.path.map(String).join(".")}`,
          issue.message,
        );
      }
      continue;
    }
    const knownPayload = payload.data as {
      projectArtifactId: string;
      vectorArtifactId?: string;
      runtimeStatus?: string;
      runtimeVersion?: string;
      runtimeAuthenticity?: string;
      runtimeSafety?: string;
    };
    const projectArtifactId = knownPayload.projectArtifactId;
    const projectArtifact = content.artifacts.find(
      (item) => item.id === projectArtifactId,
    );
    if (!artifactIds.has(projectArtifactId)) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.payload.projectArtifactId`,
        `Unknown artifact identifier: ${projectArtifactId}`,
      );
    }
    if (
      projectArtifact !== undefined &&
      (projectArtifact.state !== "materialized" ||
        projectArtifact.digest === undefined)
    ) {
      diagnostic(
        diagnostics,
        "extension-project-identity",
        `${path}.payload.projectArtifactId`,
        "A known adapter extension requires a materialized, digest-bound project artifact.",
      );
    }
    if (
      projectArtifact !== undefined &&
      extension.extensionId === LOGISIM_RUN_RECORD_EXTENSION_ID &&
      projectArtifact.role !== "logic-circuit"
    ) {
      diagnostic(
        diagnostics,
        "extension-project-role",
        `${path}.payload.projectArtifactId`,
        "A Logisim project artifact requires role=logic-circuit.",
      );
    }
    if (
      projectArtifact !== undefined &&
      extension.extensionId === CRUMB_RUN_RECORD_EXTENSION_ID &&
      !["schematic", "logic-circuit"].includes(projectArtifact.role)
    ) {
      diagnostic(
        diagnostics,
        "extension-project-role",
        `${path}.payload.projectArtifactId`,
        "A CRUMB project artifact requires role=schematic or logic-circuit.",
      );
    }
    if (!extension.appliesTo.artifactIds.includes(projectArtifactId)) {
      diagnostic(
        diagnostics,
        "extension-artifact-locus",
        `${path}.appliesTo.artifactIds`,
        "A known adapter extension must include its projectArtifactId in appliesTo.artifactIds.",
      );
    }
    for (const activityId of extension.appliesTo.activityIds) {
      const activity = content.activities.find(
        (item) => item.id === activityId,
      );
      if (
        activity !== undefined &&
        !activity.inputArtifactIds.includes(projectArtifactId)
      ) {
        diagnostic(
          diagnostics,
          "extension-activity-locus",
          `${path}.appliesTo.activityIds`,
          `Applied activity ${activityId} must consume project artifact ${projectArtifactId}.`,
        );
      }
    }
    for (const evidenceId of extension.appliesTo.evidenceIds) {
      const evidence = content.evidence.find(
        (item) => item.id === evidenceId,
      );
      if (
        evidence !== undefined &&
        !evidence.artifactIds.includes(projectArtifactId)
      ) {
        diagnostic(
          diagnostics,
          "extension-evidence-locus",
          `${path}.appliesTo.evidenceIds`,
          `Applied evidence ${evidenceId} must bind project artifact ${projectArtifactId}.`,
        );
      }
    }
    for (const claimId of extension.appliesTo.claimIds) {
      const claim = content.claims.find((item) => item.id === claimId);
      if (
        claim !== undefined &&
        (!claim.artifactIds.includes(projectArtifactId) ||
          claim.evidenceIds.some((evidenceId) => {
            const evidence = content.evidence.find(
              (item) => item.id === evidenceId,
            );
            return (
              evidence !== undefined &&
              !["declaration", "expected-specification"].includes(
                evidence.kind,
              ) &&
              !evidence.artifactIds.includes(projectArtifactId)
            );
          }))
      ) {
        diagnostic(
          diagnostics,
          "extension-claim-locus",
          `${path}.appliesTo.claimIds`,
          `Applied claim ${claimId} and each of its evidence items must bind project artifact ${projectArtifactId}.`,
        );
      }
    }
    if (
      extension.extensionId === LOGISIM_RUN_RECORD_EXTENSION_ID &&
      knownPayload.vectorArtifactId === undefined &&
      (extension.appliesTo.activityIds.some((activityId) => {
        const activity = content.activities.find(
          (item) => item.id === activityId,
        );
        return activity?.operation === "logisim_run_test_vector";
      }) ||
        extension.appliesTo.evidenceIds.some((evidenceId) => {
          const evidence = content.evidence.find(
            (item) => item.id === evidenceId,
          );
          return evidence?.kind === "test-vector";
        }))
    ) {
      diagnostic(
        diagnostics,
        "extension-vector-required",
        `${path}.payload.vectorArtifactId`,
        "A Logisim test-vector activity or evidence item requires one exact vectorArtifactId.",
      );
    }
    if (
      extension.extensionId === LOGISIM_RUN_RECORD_EXTENSION_ID &&
      knownPayload.vectorArtifactId !== undefined &&
      !artifactIds.has(knownPayload.vectorArtifactId)
    ) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.payload.vectorArtifactId`,
        `Unknown artifact identifier: ${knownPayload.vectorArtifactId}`,
      );
    }
    if (
      extension.extensionId === LOGISIM_RUN_RECORD_EXTENSION_ID &&
      knownPayload.vectorArtifactId !== undefined &&
      !extension.appliesTo.artifactIds.includes(
        knownPayload.vectorArtifactId,
      )
    ) {
      diagnostic(
        diagnostics,
        "extension-artifact-locus",
        `${path}.appliesTo.artifactIds`,
        "A Logisim extension must include its vectorArtifactId in appliesTo.artifactIds.",
      );
    }
    if (
      extension.extensionId === LOGISIM_RUN_RECORD_EXTENSION_ID &&
      knownPayload.vectorArtifactId !== undefined
    ) {
      const vectorArtifact = content.artifacts.find(
        (item) => item.id === knownPayload.vectorArtifactId,
      );
      if (
        vectorArtifact !== undefined &&
        (vectorArtifact.role !== "test-vector" ||
          vectorArtifact.state !== "materialized" ||
          vectorArtifact.digest === undefined)
      ) {
        diagnostic(
          diagnostics,
          "extension-vector-identity",
          `${path}.payload.vectorArtifactId`,
          "A Logisim vectorArtifactId requires a materialized, digest-bound test-vector artifact.",
        );
      }
      for (const evidenceId of extension.appliesTo.evidenceIds) {
        const evidence = content.evidence.find(
          (item) => item.id === evidenceId,
        );
        if (
          evidence?.kind === "test-vector" &&
          !evidence.artifactIds.includes(knownPayload.vectorArtifactId)
        ) {
          diagnostic(
            diagnostics,
            "extension-vector-locus",
            `${path}.appliesTo.evidenceIds`,
            `Test-vector evidence ${evidenceId} must bind vector artifact ${knownPayload.vectorArtifactId}.`,
          );
        }
      }
      for (const activityId of extension.appliesTo.activityIds) {
        const activity = content.activities.find(
          (item) => item.id === activityId,
        );
        if (
          activity?.operation === "logisim_run_test_vector" &&
          !activity.inputArtifactIds.includes(knownPayload.vectorArtifactId)
        ) {
          diagnostic(
            diagnostics,
            "extension-vector-locus",
            `${path}.appliesTo.activityIds`,
            `Test-vector activity ${activityId} must consume vector artifact ${knownPayload.vectorArtifactId}.`,
          );
        }
      }
    }
    if (extension.extensionId === LOGISIM_RUN_RECORD_EXTENSION_ID) {
      const runtimeEvidenceKinds = new Set<EvidenceKind>([
        "simulator-project-load",
        "simulation-trace",
        "truth-table",
        "test-vector",
      ]);
      const boundRuntimeEvidence = content.evidence.filter(
        (item) =>
          runtimeEvidenceKinds.has(item.kind) &&
          item.artifactIds.includes(projectArtifactId),
      );
      for (const evidence of boundRuntimeEvidence) {
        if (!extension.appliesTo.evidenceIds.includes(evidence.id)) {
          diagnostic(
            diagnostics,
            "extension-evidence-locus",
            `${path}.appliesTo.evidenceIds`,
            `Runtime evidence ${evidence.id} for this project must be included in the Logisim extension locus.`,
          );
        }
        if (
          evidence.activityId !== undefined &&
          !extension.appliesTo.activityIds.includes(evidence.activityId)
        ) {
          diagnostic(
            diagnostics,
            "extension-activity-locus",
            `${path}.appliesTo.activityIds`,
            `Runtime evidence activity ${evidence.activityId} must be included in the Logisim extension locus.`,
          );
        }
      }
      if (
        boundRuntimeEvidence.length > 0 &&
        (knownPayload.runtimeStatus !== "available" ||
          knownPayload.runtimeVersion !== "4.1.0" ||
          knownPayload.runtimeSafety !== "safe")
      ) {
        diagnostic(
          diagnostics,
          "extension-runtime-authority",
          `${path}.payload.runtimeStatus`,
          "Logisim runtime evidence requires status=available, version=4.1.0, and runtimeSafety=safe.",
        );
      }
      const boundRuntimeActivityIds = new Set(
        boundRuntimeEvidence.flatMap((evidence) =>
          evidence.activityId === undefined ? [] : [evidence.activityId],
        ),
      );
      for (const activityId of boundRuntimeActivityIds) {
        const activity = content.activities.find(
          (item) => item.id === activityId,
        );
        if (activity === undefined) {
          continue;
        }
        const toolIdentity = content.toolchain.find(
          (item) => item.id === activity.toolIdentityId,
        );
        if (
          toolIdentity !== undefined &&
          (toolIdentity.kind !== "simulator" ||
            toolIdentity.version !== knownPayload.runtimeVersion ||
            toolIdentity.authenticity !==
              knownPayload.runtimeAuthenticity)
        ) {
          diagnostic(
            diagnostics,
            "extension-runtime-tool-identity",
            `${path}.appliesTo.activityIds`,
            `Runtime activity ${activityId} must use a simulator identity whose version and authenticity exactly match the Logisim extension runtime identity.`,
          );
        }
      }
    }
  }
}

function validateKnownAdapterCoverage(
  content: RunRecordContent,
  diagnostics: Diagnostic[],
): void {
  for (const activity of content.activities) {
    if (activity.evidenceIds.length === 0) {
      continue;
    }
    const extensionId = CRUMB_PROJECT_OPERATIONS.has(activity.operation)
      ? CRUMB_RUN_RECORD_EXTENSION_ID
      : LOGISIM_PROJECT_OPERATIONS.has(activity.operation)
        ? LOGISIM_RUN_RECORD_EXTENSION_ID
        : undefined;
    if (extensionId === undefined) {
      continue;
    }
    const extension = content.extensions.find(
      (item) => item.extensionId === extensionId,
    );
    if (extension === undefined) {
      diagnostic(
        diagnostics,
        "adapter-extension-required",
        "content.extensions",
        `Evidence from ${activity.operation} requires the corresponding critical adapter extension and exact project locus.`,
      );
      continue;
    }
    if (!extension.critical) {
      diagnostic(
        diagnostics,
        "adapter-extension-critical",
        "content.extensions",
        `Evidence from ${activity.operation} requires critical=true on its adapter extension.`,
      );
    }
    if (!extension.appliesTo.activityIds.includes(activity.id)) {
      diagnostic(
        diagnostics,
        "adapter-extension-coverage",
        "content.extensions",
        `The adapter extension must include evidence-producing activity ${activity.id}.`,
      );
    }
    for (const evidenceId of activity.evidenceIds) {
      if (!extension.appliesTo.evidenceIds.includes(evidenceId)) {
        diagnostic(
          diagnostics,
          "adapter-extension-coverage",
          "content.extensions",
          `The adapter extension must include evidence ${evidenceId} from ${activity.operation}.`,
        );
      }
      for (const claim of content.claims.filter((item) =>
        item.evidenceIds.includes(evidenceId),
      )) {
        if (!extension.appliesTo.claimIds.includes(claim.id)) {
          diagnostic(
            diagnostics,
            "adapter-extension-coverage",
            "content.extensions",
            `The adapter extension must include claim ${claim.id}, which consumes evidence from ${activity.operation}.`,
          );
        }
      }
    }
  }
}

function semanticDiagnostics(record: RunRecord): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const content = record.content;
  const ids = {
    stages: new Set(content.stages.map((item) => item.id)),
    requirements: new Set(
      content.intent.requirements.map((item) => item.id),
    ),
    tools: new Set(content.toolchain.map((item) => item.id)),
    artifacts: new Set(content.artifacts.map((item) => item.id)),
    activities: new Set(content.activities.map((item) => item.id)),
    claims: new Set(content.claims.map((item) => item.id)),
    evidence: new Set(content.evidence.map((item) => item.id)),
    diagnostics: new Set(content.diagnostics.map((item) => item.id)),
    risks: new Set(content.risks.map((item) => item.id)),
  };

  const identifiedCollections: Array<
    [readonly { id: string }[], string, string]
  > = [
    [content.intent.requirements, "content.intent.requirements", "requirement"],
    [content.intent.interfaces, "content.intent.interfaces", "interface"],
    [content.intent.constraints, "content.intent.constraints", "constraint"],
    [content.intent.assumptions, "content.intent.assumptions", "assumption"],
    [content.stages, "content.stages", "stage"],
    [content.toolchain, "content.toolchain", "tool identity"],
    [content.artifacts, "content.artifacts", "artifact"],
    [content.activities, "content.activities", "activity"],
    [content.claims, "content.claims", "claim"],
    [content.evidence, "content.evidence", "evidence"],
    [content.diagnostics, "content.diagnostics", "diagnostic"],
    [content.risks, "content.risks", "risk"],
    [content.signoffs, "content.signoffs", "signoff"],
    [content.provenance, "content.provenance", "provenance"],
  ];
  for (const [items, path, noun] of identifiedCollections) {
    reportDuplicates(
      items.map((item) => item.id),
      path,
      noun,
      diagnostics,
    );
  }
  reportDuplicates(
    content.extensions.map((item) => item.extensionId),
    "content.extensions",
    "extension",
    diagnostics,
  );

  for (const [index, requirement] of content.intent.requirements.entries()) {
    checkReferences(
      requirement.claimIds,
      ids.claims,
      `content.intent.requirements.${index}.claimIds`,
      "claim",
      diagnostics,
    );
  }
  for (const [index, constraint] of content.intent.constraints.entries()) {
    checkReferences(
      constraint.claimIds,
      ids.claims,
      `content.intent.constraints.${index}.claimIds`,
      "claim",
      diagnostics,
    );
    if (
      constraint.target?.relation === "range" &&
      constraint.target.upperValue === undefined
    ) {
      diagnostic(
        diagnostics,
        "constraint-range",
        `content.intent.constraints.${index}.target.upperValue`,
        "A range constraint requires upperValue.",
      );
    }
    if (
      constraint.target?.relation !== "range" &&
      constraint.target?.upperValue !== undefined
    ) {
      diagnostic(
        diagnostics,
        "constraint-range",
        `content.intent.constraints.${index}.target.upperValue`,
        "upperValue is only meaningful for a range constraint.",
      );
    }
    if (
      constraint.target?.relation === "range" &&
      constraint.target.upperValue !== undefined &&
      compareExactDecimals(
        constraint.target.value,
        constraint.target.upperValue,
      ) > 0
    ) {
      diagnostic(
        diagnostics,
        "constraint-range-order",
        `content.intent.constraints.${index}.target`,
        "A range constraint's lower value cannot exceed its upperValue.",
      );
    }
  }

  const stageSequenceById = new Map<string, number>();
  for (const [index, stage] of content.stages.entries()) {
    if (stage.sequence !== index + 1) {
      diagnostic(
        diagnostics,
        "stage-sequence",
        `content.stages.${index}.sequence`,
        "Stage sequence values must be contiguous, one-based, and agree with array order.",
      );
    }
    stageSequenceById.set(stage.id, stage.sequence);
  }
  for (const [index, stage] of content.stages.entries()) {
    checkReferences(
      stage.dependsOnStageIds,
      ids.stages,
      `content.stages.${index}.dependsOnStageIds`,
      "stage",
      diagnostics,
    );
    checkReferences(
      stage.requirementIds,
      ids.requirements,
      `content.stages.${index}.requirementIds`,
      "requirement",
      diagnostics,
    );
    for (const dependency of stage.dependsOnStageIds) {
      const dependencyStage = content.stages.find(
        (candidate) => candidate.id === dependency,
      );
      if (
        dependency === stage.id ||
        (stageSequenceById.get(dependency) ?? Number.POSITIVE_INFINITY) >=
          stage.sequence
      ) {
        diagnostic(
          diagnostics,
          "stage-dependency-order",
          `content.stages.${index}.dependsOnStageIds`,
          "A stage may depend only on an earlier stage.",
        );
      }
      if (
        ["ready", "running", "completed"].includes(stage.status) &&
        dependencyStage !== undefined &&
        !["completed", "reported-only"].includes(dependencyStage.status)
      ) {
        diagnostic(
          diagnostics,
          "stage-dependency-status",
          `content.stages.${index}.dependsOnStageIds`,
          `Stage ${stage.id} cannot be ${stage.status} while dependency ${dependency} is ${dependencyStage.status}.`,
        );
      }
    }
  }

  const activitySequenceById = new Map<string, number>();
  for (const [index, activity] of content.activities.entries()) {
    if (activity.sequence !== index + 1) {
      diagnostic(
        diagnostics,
        "activity-sequence",
        `content.activities.${index}.sequence`,
        "Activity sequence values must be contiguous, one-based, and agree with array order.",
      );
    }
    activitySequenceById.set(activity.id, activity.sequence);
  }
  const activityDependsOn = (
    activity: RunRecord["content"]["activities"][number],
    targetActivityId: string,
  ): boolean => {
    const pending = [...activity.dependsOnActivityIds];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const dependencyId = pending.pop();
      if (dependencyId === undefined || visited.has(dependencyId)) {
        continue;
      }
      if (dependencyId === targetActivityId) {
        return true;
      }
      visited.add(dependencyId);
      const dependency = content.activities.find(
        (candidate) => candidate.id === dependencyId,
      );
      pending.push(...(dependency?.dependsOnActivityIds ?? []));
    }
    return false;
  };

  for (const [index, artifact] of content.artifacts.entries()) {
    const path = `content.artifacts.${index}`;
    if (artifact.state !== "planned" && artifact.digest === undefined) {
      diagnostic(
        diagnostics,
        "artifact-digest-required",
        `${path}.digest`,
        "Materialized and externally reported artifacts require an exact digest.",
      );
    }
    if (
      artifact.reference.kind === "none" &&
      artifact.state !== "planned" &&
      artifact.digest === undefined
    ) {
      diagnostic(
        diagnostics,
        "artifact-identity",
        path,
        "A non-planned artifact needs a reference or digest.",
      );
    }
    checkReferences(
      artifact.derivedFromArtifactIds,
      ids.artifacts,
      `${path}.derivedFromArtifactIds`,
      "artifact",
      diagnostics,
    );
    if (artifact.derivedFromArtifactIds.includes(artifact.id)) {
      diagnostic(
        diagnostics,
        "artifact-self-reference",
        `${path}.derivedFromArtifactIds`,
        "An artifact cannot derive from itself.",
      );
    }
    if (
      artifact.producedByActivityId !== undefined &&
      !ids.activities.has(artifact.producedByActivityId)
    ) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.producedByActivityId`,
        `Unknown activity identifier: ${artifact.producedByActivityId}`,
      );
    }
  }
  checkArtifactCycles(
    content.artifacts,
    content.activities,
    content.provenance,
    diagnostics,
  );

  for (const [index, activity] of content.activities.entries()) {
    const path = `content.activities.${index}`;
    const normalizedOperation = activity.operation.toLowerCase();
    if (
      /^(?:electronics|crumb|logisim)_/u.test(normalizedOperation) &&
      (activity.operation !== normalizedOperation ||
        !KNOWN_OPERATION_EVIDENCE_KINDS.has(normalizedOperation))
    ) {
      diagnostic(
        diagnostics,
        "activity-operation-namespace",
        `${path}.operation`,
        "Circuitarium operation names use exact lowercase registered identifiers; unknown or noncanonical names in a reserved namespace fail closed.",
      );
    }
    const activityStage = content.stages.find(
      (candidate) => candidate.id === activity.stageId,
    );
    if (activityStage === undefined) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.stageId`,
        `Unknown stage identifier: ${activity.stageId}`,
      );
    }
    if (
      activityStage !== undefined &&
      ["planned", "ready"].includes(activityStage.status) &&
      activity.executionStatus !== "not-attempted"
    ) {
      diagnostic(
        diagnostics,
        "activity-stage-status",
        `${path}.executionStatus`,
        `An activity in a ${activityStage.status} stage must remain not-attempted.`,
      );
    }
    if (
      activityStage !== undefined &&
      activity.executionStatus === "running" &&
      activityStage.status !== "running"
    ) {
      diagnostic(
        diagnostics,
        "activity-stage-status",
        `${path}.executionStatus`,
        "A running activity requires its stage to have status=running.",
      );
    }
    if (
      activity.toolIdentityId !== undefined &&
      !ids.tools.has(activity.toolIdentityId)
    ) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.toolIdentityId`,
        `Unknown tool identity: ${activity.toolIdentityId}`,
      );
    }
    if (
      ["completed", "reported-only"].includes(activity.executionStatus) &&
      activity.evidenceIds.length > 0 &&
      activity.toolIdentityId === undefined
    ) {
      diagnostic(
        diagnostics,
        "activity-tool-identity-required",
        `${path}.toolIdentityId`,
        "An evidence-producing completed or reported-only activity requires an applicable tool/external identity.",
      );
    }
    if (
      ["completed", "reported-only"].includes(activity.executionStatus) &&
      activity.evidenceIds.length > 0 &&
      activity.toolIdentityId !== undefined
    ) {
      const toolIdentity = content.toolchain.find(
        (candidate) => candidate.id === activity.toolIdentityId,
      );
      if (
        toolIdentity !== undefined &&
        toolIdentity.kind !== "external" &&
        toolIdentity.version === undefined &&
        toolIdentity.artifactDigest === undefined
      ) {
        diagnostic(
          diagnostics,
          "activity-tool-identity-reproducibility",
          `${path}.toolIdentityId`,
          "A non-external evidence-producing tool identity requires an exact version or artifact digest.",
        );
      }
    }
    checkReferences(
      activity.dependsOnActivityIds,
      ids.activities,
      `${path}.dependsOnActivityIds`,
      "activity",
      diagnostics,
    );
    for (const dependency of activity.dependsOnActivityIds) {
      const dependencyActivity = content.activities.find(
        (candidate) => candidate.id === dependency,
      );
      const dependencyStage = content.stages.find(
        (candidate) => candidate.id === dependencyActivity?.stageId,
      );
      if (
        dependency === activity.id ||
        (activitySequenceById.get(dependency) ?? Number.POSITIVE_INFINITY) >=
          activity.sequence
      ) {
        diagnostic(
          diagnostics,
          "activity-dependency-order",
          `${path}.dependsOnActivityIds`,
          "An activity may depend only on an earlier activity.",
        );
      }
      if (
        activityStage !== undefined &&
        dependencyStage !== undefined &&
        dependencyStage.sequence > activityStage.sequence
      ) {
        diagnostic(
          diagnostics,
          "activity-dependency-stage-order",
          `${path}.dependsOnActivityIds`,
          `Activity ${activity.id} cannot depend on activity ${dependency} from a later stage.`,
        );
      }
      if (
        ["completed", "reported-only"].includes(activity.executionStatus) &&
        dependencyActivity !== undefined &&
        !["completed", "reported-only"].includes(
          dependencyActivity.executionStatus,
        )
      ) {
        diagnostic(
          diagnostics,
          "activity-dependency-status",
          `${path}.dependsOnActivityIds`,
          `A completed or reported-only activity cannot depend on nonterminal activity ${dependency}.`,
        );
      }
    }
    checkReferences(
      activity.inputArtifactIds,
      ids.artifacts,
      `${path}.inputArtifactIds`,
      "artifact",
      diagnostics,
    );
    for (const inputArtifactId of activity.inputArtifactIds) {
      const inputArtifact = content.artifacts.find(
        (artifact) => artifact.id === inputArtifactId,
      );
      if (
        inputArtifact !== undefined &&
        ["completed", "reported-only"].includes(
          activity.executionStatus,
        ) &&
        activity.evidenceIds.length > 0 &&
        (inputArtifact.state === "planned" ||
          inputArtifact.digest === undefined)
      ) {
        diagnostic(
          diagnostics,
          "activity-input-identity",
          `${path}.inputArtifactIds`,
          `Evidence-producing activity input ${inputArtifactId} must be non-planned and digest-bound.`,
        );
      }
      if (inputArtifact?.producedByActivityId === undefined) {
        continue;
      }
      const producer = content.activities.find(
        (candidate) =>
          candidate.id === inputArtifact.producedByActivityId,
      );
      const producerStage = content.stages.find(
        (candidate) => candidate.id === producer?.stageId,
      );
      if (
        producer !== undefined &&
        (producer.sequence >= activity.sequence ||
          !activityDependsOn(activity, producer.id))
      ) {
        diagnostic(
          diagnostics,
          "activity-input-causality",
          `${path}.inputArtifactIds`,
          `Input artifact ${inputArtifactId} must be produced by an earlier transitive activity dependency.`,
        );
      }
      if (
        activityStage !== undefined &&
        producerStage !== undefined &&
        producerStage.sequence > activityStage.sequence
      ) {
        diagnostic(
          diagnostics,
          "activity-input-stage-order",
          `${path}.inputArtifactIds`,
          `Input artifact ${inputArtifactId} cannot come from producer ${producer?.id ?? "unknown"} in a later stage.`,
        );
      }
    }
    checkReferences(
      activity.outputArtifactIds,
      ids.artifacts,
      `${path}.outputArtifactIds`,
      "artifact",
      diagnostics,
    );
    if (
      activity.outputArtifactIds.some((artifactId) =>
        activity.inputArtifactIds.includes(artifactId),
      )
    ) {
      diagnostic(
        diagnostics,
        "activity-input-output-overlap",
        `${path}.outputArtifactIds`,
        "An activity cannot treat the same artifact identity as both input and output.",
      );
    }
    for (const outputArtifactId of activity.outputArtifactIds) {
      const outputArtifact = content.artifacts.find(
        (artifact) => artifact.id === outputArtifactId,
      );
      if (
        outputArtifact !== undefined &&
        outputArtifact.producedByActivityId !== activity.id
      ) {
        diagnostic(
          diagnostics,
          "activity-output-producer-mismatch",
          `${path}.outputArtifactIds`,
          `Output artifact ${outputArtifactId} must identify ${activity.id} as its producer.`,
        );
      }
      if (
        outputArtifact !== undefined &&
        ["completed", "reported-only"].includes(activity.executionStatus) &&
        outputArtifact.state === "planned"
      ) {
        diagnostic(
          diagnostics,
          "activity-output-state",
          `${path}.outputArtifactIds`,
          `Output artifact ${outputArtifactId} cannot remain planned after the activity completes or is reported.`,
        );
      }
      if (
        outputArtifact !== undefined &&
        outputArtifact.derivedFromArtifactIds.some(
          (artifactId) => !activity.inputArtifactIds.includes(artifactId),
        )
      ) {
        diagnostic(
          diagnostics,
          "activity-output-derivation",
          `${path}.outputArtifactIds`,
          `Every derivation source for output artifact ${outputArtifactId} must be an input to the producing activity.`,
        );
      }
    }
    checkReferences(
      activity.evidenceIds,
      ids.evidence,
      `${path}.evidenceIds`,
      "evidence",
      diagnostics,
    );
    for (const evidenceId of activity.evidenceIds) {
      const evidence = content.evidence.find(
        (candidate) => candidate.id === evidenceId,
      );
      if (evidence !== undefined && evidence.activityId !== activity.id) {
        diagnostic(
          diagnostics,
          "activity-evidence-mismatch",
          `${path}.evidenceIds`,
          `Evidence ${evidenceId} must identify ${activity.id} as its producing activity.`,
        );
      }
    }
    const verdictEvidence = activity.evidenceIds
      .map((evidenceId) =>
        content.evidence.find((candidate) => candidate.id === evidenceId),
      )
      .filter(
        (
          evidence,
        ): evidence is RunRecord["content"]["evidence"][number] =>
          evidence !== undefined &&
          ["pass", "fail"].includes(evidence.outcome),
      );
    if (verdictEvidence.length > 0) {
      const expectedOutcome = verdictEvidence.some(
        (evidence) => evidence.outcome === "fail",
      )
        ? "fail"
        : "pass";
      if (activity.outcome !== expectedOutcome) {
        diagnostic(
          diagnostics,
          "activity-evidence-outcome",
          `${path}.outcome`,
          `Activity outcome must be ${expectedOutcome} because its verdict-bearing evidence ${expectedOutcome === "fail" ? "contains a failure" : "all passes"}.`,
        );
      }
    }
    checkReferences(
      activity.diagnosticIds,
      ids.diagnostics,
      `${path}.diagnosticIds`,
      "diagnostic",
      diagnostics,
    );
    for (const diagnosticId of activity.diagnosticIds) {
      const item = content.diagnostics.find(
        (candidate) => candidate.id === diagnosticId,
      );
      if (item !== undefined && item.activityId !== activity.id) {
        diagnostic(
          diagnostics,
          "activity-diagnostic-mismatch",
          `${path}.diagnosticIds`,
          `Diagnostic ${diagnosticId} must identify ${activity.id} as its activity.`,
        );
      }
    }
    const hasReceipt =
      activity.resultDigest !== undefined ||
      activity.evidenceIds.length > 0 ||
      activity.diagnosticIds.length > 0 ||
      activity.outputArtifactIds.length > 0;
    if (
      ["completed", "reported-only"].includes(activity.executionStatus) &&
      (activity.observationBasis === "none" || !hasReceipt)
    ) {
      diagnostic(
        diagnostics,
        "completed-without-receipt",
        path,
        "A completed or reported-only activity requires an observation basis and a digest, evidence, diagnostic, or output-artifact receipt.",
      );
    }
    if (
      activity.executionStatus === "completed" &&
      !["host-observed", "tool-reported"].includes(
        activity.observationBasis,
      )
    ) {
      diagnostic(
        diagnostics,
        "completed-observation-basis",
        `${path}.observationBasis`,
        "A completed local activity requires host-observed or tool-reported observation; use reported-only for caller or external reports.",
      );
    }
    if (
      ["not-attempted", "running", "blocked", "cancelled", "skipped"].includes(
        activity.executionStatus,
      ) &&
      !["not-applicable", "inconclusive"].includes(activity.outcome)
    ) {
      diagnostic(
        diagnostics,
        "activity-outcome",
        `${path}.outcome`,
        "An activity that did not complete cannot report an observed, passing, or failing engineering outcome.",
      );
    }
    if (
      activity.executionStatus === "reported-only" &&
      activity.observationBasis === "host-observed"
    ) {
      diagnostic(
        diagnostics,
        "reported-only-observation",
        `${path}.observationBasis`,
        "A reported-only activity cannot claim direct host observation.",
      );
    }
    if (
      activity.executionStatus === "failed" &&
      activity.outcome === "pass"
    ) {
      diagnostic(
        diagnostics,
        "activity-outcome",
        `${path}.outcome`,
        "A failed process cannot report a passing engineering outcome.",
      );
    }
  }

  for (const [index, stage] of content.stages.entries()) {
    if (
      stage.status !== "completed" ||
      stage.kind === "intent-architecture"
    ) {
      continue;
    }
    const stageActivities = content.activities.filter(
      (activity) => activity.stageId === stage.id,
    );
    if (
      stage.kind === "signoff" &&
      content.signoffs.some((signoff) =>
        signoff.stageId === stage.id &&
        ["accepted", "accepted-with-conditions", "rejected"].includes(
          signoff.status,
        ),
      )
    ) {
      continue;
    }
    if (
      !stageActivities.some((activity) =>
        ["completed", "reported-only"].includes(activity.executionStatus),
      ) ||
      stageActivities.some((activity) =>
        ["not-attempted", "running", "blocked"].includes(
          activity.executionStatus,
        ),
      )
    ) {
      diagnostic(
        diagnostics,
        "completed-stage-without-terminal-activity",
        `content.stages.${index}.status`,
        "A completed non-intent stage requires at least one activity and no unattempted, running, or blocked activity in that stage.",
      );
    }
  }

  for (const [index, artifact] of content.artifacts.entries()) {
    if (artifact.producedByActivityId === undefined) {
      continue;
    }
    const activity = content.activities.find(
      (candidate) => candidate.id === artifact.producedByActivityId,
    );
    if (
      activity !== undefined &&
      artifact.state !== "planned" &&
      !["completed", "reported-only"].includes(activity.executionStatus)
    ) {
      diagnostic(
        diagnostics,
        "artifact-producer-status",
        `content.artifacts.${index}.producedByActivityId`,
        "A non-planned artifact may be produced only by a completed or explicitly reported-only activity.",
      );
    }
    if (activity !== undefined && !activity.outputArtifactIds.includes(artifact.id)) {
      diagnostic(
        diagnostics,
        "artifact-producer-mismatch",
        `content.artifacts.${index}.producedByActivityId`,
        "The producing activity must list this artifact as an output.",
      );
    }
  }

  const verdictCapableEvidence = new Set<
    RunRecord["content"]["evidence"][number]["kind"]
  >([
    "static-erc",
    "test-vector",
    "formal-proof",
    "timing-report",
    "power-report",
    "drc-report",
    "lvs-report",
    "qualified-review",
    "fabrication-receipt",
    "external",
  ]);
  for (const [index, evidence] of content.evidence.entries()) {
    const path = `content.evidence.${index}`;
    checkReferences(
      evidence.artifactIds,
      ids.artifacts,
      `${path}.artifactIds`,
      "artifact",
      diagnostics,
    );
    if (evidence.kind !== "declaration") {
      for (const artifactId of evidence.artifactIds) {
        const artifact = content.artifacts.find(
          (candidate) => candidate.id === artifactId,
        );
        if (
          artifact !== undefined &&
          (artifact.state === "planned" || artifact.digest === undefined)
        ) {
          diagnostic(
            diagnostics,
            "evidence-artifact-identity",
            `${path}.artifactIds`,
            `Evidence artifact ${artifactId} must be non-planned and digest-bound.`,
          );
        }
      }
    }
    if (
      evidence.activityId !== undefined &&
      !ids.activities.has(evidence.activityId)
    ) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.activityId`,
        `Unknown activity identifier: ${evidence.activityId}`,
      );
    }
    if (evidence.activityId !== undefined) {
      const activity = content.activities.find(
        (candidate) => candidate.id === evidence.activityId,
      );
      if (activity !== undefined && !activity.evidenceIds.includes(evidence.id)) {
        diagnostic(
          diagnostics,
          "evidence-activity-mismatch",
          `${path}.activityId`,
          "The producing activity must list this evidence identifier.",
        );
      }
      if (
        activity !== undefined &&
        evidence.artifactIds.some(
          (artifactId) =>
            !activity.inputArtifactIds.includes(artifactId) &&
            !activity.outputArtifactIds.includes(artifactId),
        )
      ) {
        diagnostic(
          diagnostics,
          "evidence-activity-artifact-mismatch",
          `${path}.artifactIds`,
          "Activity-produced evidence may reference only that activity's input or output artifacts.",
        );
      }
      if (
        activity !== undefined &&
        !["completed", "reported-only"].includes(activity.executionStatus)
      ) {
        diagnostic(
          diagnostics,
          "evidence-activity-status",
          `${path}.activityId`,
          "Engineering evidence may be produced only by a completed or explicitly reported-only activity.",
        );
      }
      if (
        activity !== undefined &&
        (activity.resultDigest !== undefined ||
          evidence.resultDigest !== undefined) &&
        activity.resultDigest !== evidence.resultDigest
      ) {
        diagnostic(
          diagnostics,
          "evidence-result-linkage",
          `${path}.resultDigest`,
          "Activity-produced evidence and its producing activity must identify the same exact result digest when either declares one.",
        );
      }
      if (
        activity !== undefined &&
        !EVIDENCE_ACTIVITY_KINDS[evidence.kind].has(activity.kind)
      ) {
        diagnostic(
          diagnostics,
          "evidence-activity-kind",
          `${path}.kind`,
          `${evidence.kind} evidence cannot be produced by activity kind ${activity.kind}.`,
        );
      }
      if (activity !== undefined) {
        const allowedForKnownOperation =
          KNOWN_OPERATION_EVIDENCE_KINDS.get(activity.operation);
        if (
          allowedForKnownOperation !== undefined &&
          !allowedForKnownOperation.has(evidence.kind)
        ) {
          diagnostic(
            diagnostics,
            "evidence-operation-authority",
            `${path}.kind`,
            `Known operation ${activity.operation} cannot produce ${evidence.kind} evidence.`,
          );
        }
        if (
          allowedForKnownOperation === undefined &&
          /^(?:electronics|crumb|logisim)_/iu.test(activity.operation)
        ) {
          diagnostic(
            diagnostics,
            "evidence-operation-unknown",
            `${path}.source`,
            `Unrecognized Circuitarium operation ${activity.operation} cannot originate engineering evidence under this schema version.`,
          );
        }
        const expectedAuthenticity = {
          "host-observed": "local-computed-unsigned",
          "tool-reported": "tool-reported-unverified",
          "caller-reported": "caller-reported-unverified",
          "externally-reported": "external-unverified",
          none: undefined,
        } as const;
        const requiredAuthenticity =
          expectedAuthenticity[activity.observationBasis];
        if (
          requiredAuthenticity !== undefined &&
          evidence.authenticity !== requiredAuthenticity
        ) {
          diagnostic(
            diagnostics,
            "evidence-observation-authenticity",
            `${path}.authenticity`,
            `Evidence from observationBasis=${activity.observationBasis} requires authenticity=${requiredAuthenticity}.`,
          );
        }
      }
    } else if (
      !["declaration", "expected-specification", "external"].includes(
        evidence.kind,
      )
    ) {
      diagnostic(
        diagnostics,
        "evidence-activity-required",
        `${path}.activityId`,
        `${evidence.kind} evidence requires a producing activity.`,
      );
    }
    if (
      ["pass", "fail"].includes(evidence.outcome) &&
      !verdictCapableEvidence.has(evidence.kind)
    ) {
      diagnostic(
        diagnostics,
        "evidence-authority",
        `${path}.outcome`,
        `${evidence.kind} evidence may be observed or inconclusive, but cannot assign its own pass/fail verdict.`,
      );
    }
    if (
      ["pass", "fail"].includes(evidence.outcome) &&
      evidence.resultDigest === undefined
    ) {
      diagnostic(
        diagnostics,
        "evidence-result-digest",
        `${path}.resultDigest`,
        "Passing and failing evidence requires an exact result digest.",
      );
    }
    if (
      ["truth-table", "test-vector"].includes(evidence.kind) &&
      evidence.coverage === undefined
    ) {
      diagnostic(
        diagnostics,
        "evidence-coverage-required",
        `${path}.coverage`,
        `${evidence.kind} evidence requires explicit bounded coverage.`,
      );
    }
    if (
      evidence.kind === "truth-table" &&
      evidence.coverage !== undefined &&
      (evidence.coverage.mode === "not-applicable" ||
        (evidence.coverage.casesExecuted ?? 0) < 1)
    ) {
      diagnostic(
        diagnostics,
        "evidence-coverage",
        `${path}.coverage`,
        "Truth-table evidence requires at least one executed case and an applicable coverage mode.",
      );
    }
    if (
      evidence.kind === "test-vector" &&
      ["pass", "fail"].includes(evidence.outcome) &&
      evidence.coverage !== undefined &&
      ((evidence.coverage.casesExecuted ?? 0) < 1 ||
        (evidence.outcome === "pass" &&
          (evidence.coverage.truncated ||
            !["exhaustive", "listed-sequences"].includes(
              evidence.coverage.mode,
            ) ||
            evidence.coverage.casesPlanned === undefined ||
            evidence.coverage.casesPlanned !==
              evidence.coverage.casesExecuted)))
    ) {
      diagnostic(
        diagnostics,
        "evidence-coverage",
        `${path}.coverage`,
        "Passing test-vector evidence requires nonempty, untruncated exhaustive or listed-sequence coverage with equal planned/executed counts; failing evidence requires at least one executed case.",
      );
    }
    if (
      evidence.kind === "physical-measurement" &&
      evidence.authenticity === "local-computed-unsigned"
    ) {
      diagnostic(
        diagnostics,
        "evidence-authenticity",
        `${path}.authenticity`,
        "Circuitarium cannot originate physical-measurement evidence.",
      );
    }
    if (
      ["qualified-review", "fabrication-receipt", "external"].includes(
        evidence.kind,
      ) &&
      ![
        "caller-reported-unverified",
        "external-unverified",
      ].includes(evidence.authenticity)
    ) {
      diagnostic(
        diagnostics,
        "evidence-authenticity",
        `${path}.authenticity`,
        `${evidence.kind} evidence must remain caller-reported or external-unverified.`,
      );
    }
  }

  for (const [index, claim] of content.claims.entries()) {
    const path = `content.claims.${index}`;
    checkReferences(
      claim.stageIds,
      ids.stages,
      `${path}.stageIds`,
      "stage",
      diagnostics,
    );
    if (["pass", "fail"].includes(claim.verdict)) {
      for (const artifactId of claim.artifactIds) {
        const artifact = content.artifacts.find(
          (candidate) => candidate.id === artifactId,
        );
        if (
          artifact !== undefined &&
          (artifact.state === "planned" || artifact.digest === undefined)
        ) {
          diagnostic(
            diagnostics,
            "claim-artifact-identity",
            `${path}.artifactIds`,
            `Verdict-bearing claim artifact ${artifactId} must be non-planned and digest-bound.`,
          );
        }
      }
    }
    checkReferences(
      claim.artifactIds,
      ids.artifacts,
      `${path}.artifactIds`,
      "artifact",
      diagnostics,
    );
    checkReferences(
      claim.evidenceIds,
      ids.evidence,
      `${path}.evidenceIds`,
      "evidence",
      diagnostics,
    );
    const claimEvidence = claim.evidenceIds
      .map((id) => content.evidence.find((item) => item.id === id))
      .filter(
        (
          item,
        ): item is RunRecord["content"]["evidence"][number] =>
          item !== undefined,
      );
    const implementationArtifactIds = new Set(
      claim.artifactIds.filter((artifactId) => {
        const artifact = content.artifacts.find(
          (candidate) => candidate.id === artifactId,
        );
        return (
          artifact !== undefined &&
          IMPLEMENTATION_ARTIFACT_ROLES.has(artifact.role)
        );
      }),
    );
    const subjectArtifactIds = new Set(
      claim.artifactIds.filter((artifactId) => {
        const artifact = content.artifacts.find(
          (candidate) => candidate.id === artifactId,
        );
        return (
          artifact !== undefined &&
          SUBJECT_ARTIFACT_ROLES.has(artifact.role)
        );
      }),
    );
    if (["pass", "fail"].includes(claim.verdict)) {
      if (subjectArtifactIds.size === 0) {
        diagnostic(
          diagnostics,
          "claim-subject-required",
          `${path}.artifactIds`,
          "A passing or failing engineering claim requires an exact implementation or subject artifact, not only a report or receipt.",
        );
      }
      for (const subjectArtifactId of subjectArtifactIds) {
        const hasVerdictEvidenceForSubject = claimEvidence.some(
          (evidence) => {
            if (
              evidence.outcome !== claim.verdict ||
              !evidence.artifactIds.includes(subjectArtifactId)
            ) {
              return false;
            }
            if (evidence.activityId === undefined) {
              return true;
            }
            const activity = content.activities.find(
              (candidate) => candidate.id === evidence.activityId,
            );
            return activity?.inputArtifactIds.includes(subjectArtifactId) ??
              false;
          },
        );
        if (!hasVerdictEvidenceForSubject) {
          diagnostic(
            diagnostics,
            "claim-subject-evidence-locus",
            `${path}.artifactIds`,
            `Claim-scoped subject ${subjectArtifactId} requires outcome-matching evidence explicitly bound to that subject and, when activity-produced, consumed by the activity.`,
          );
        }
      }
      for (const verdictEvidence of claimEvidence.filter(
        (item) => item.outcome === claim.verdict,
      )) {
        if (verdictEvidence.activityId === undefined) {
          continue;
        }
        const activity = content.activities.find(
          (candidate) => candidate.id === verdictEvidence.activityId,
        );
        if (
          activity !== undefined &&
          !activity.inputArtifactIds.some((artifactId) =>
            subjectArtifactIds.has(artifactId),
          )
        ) {
          diagnostic(
            diagnostics,
            "claim-evidence-subject",
            `${path}.evidenceIds`,
            `Verdict evidence ${verdictEvidence.id} must come from an activity that consumes a claim-scoped subject artifact.`,
          );
        }
      }
      for (const expectedEvidence of claimEvidence.filter(
        (item) => item.kind === "expected-specification",
      )) {
        if (
          expectedEvidence.artifactIds.some((artifactId) =>
            artifactDerivesFromAny(
              artifactId,
              implementationArtifactIds,
              content.artifacts,
              content.activities,
              content.provenance,
            ),
          )
        ) {
          diagnostic(
            diagnostics,
            "claim-oracle-independence",
            `${path}.evidenceIds`,
            "Expected-specification evidence cannot derive directly or transitively from an implementation artifact under test.",
          );
        }
        const hasComparisonLocus = claimEvidence.some((item) => {
          if (
            item.outcome !== claim.verdict ||
            item.activityId === undefined
          ) {
            return false;
          }
          const activity = content.activities.find(
            (candidate) => candidate.id === item.activityId,
          );
          return (
            activity !== undefined &&
            expectedEvidence.artifactIds.some((artifactId) =>
              activity.inputArtifactIds.includes(artifactId),
            ) &&
            activity.inputArtifactIds.some((artifactId) =>
              implementationArtifactIds.has(artifactId),
            )
          );
        });
        if (!hasComparisonLocus) {
          diagnostic(
            diagnostics,
            "claim-oracle-comparison",
            `${path}.evidenceIds`,
            "A pass/fail claim using an expected specification requires a supporting comparison activity that consumes both that oracle and an implementation artifact under test.",
          );
        }
      }
      for (const vectorEvidence of claimEvidence.filter(
        (item) =>
          item.kind === "test-vector" &&
          ["pass", "fail"].includes(item.outcome),
      )) {
        const vectorArtifactIds = vectorEvidence.artifactIds.filter(
          (artifactId) =>
            content.artifacts.find(
              (candidate) => candidate.id === artifactId,
            )?.role === "test-vector",
        );
        if (vectorArtifactIds.length === 0) {
          diagnostic(
            diagnostics,
            "claim-vector-oracle-required",
            `${path}.evidenceIds`,
            "Verdict-bearing test-vector evidence requires an exact test-vector artifact.",
          );
          continue;
        }
        if (
          vectorArtifactIds.some((artifactId) =>
            artifactDerivesFromAny(
              artifactId,
              implementationArtifactIds,
              content.artifacts,
              content.activities,
              content.provenance,
            ),
          )
        ) {
          diagnostic(
            diagnostics,
            "claim-oracle-independence",
            `${path}.evidenceIds`,
            "A verdict-bearing test vector cannot derive directly, transitively, or through its producing activity from an implementation artifact under test.",
          );
        }
        const comparisonActivity = content.activities.find(
          (candidate) => candidate.id === vectorEvidence.activityId,
        );
        if (
          comparisonActivity === undefined ||
          !vectorArtifactIds.some((artifactId) =>
            comparisonActivity.inputArtifactIds.includes(artifactId),
          ) ||
          !comparisonActivity.inputArtifactIds.some((artifactId) =>
            implementationArtifactIds.has(artifactId),
          )
        ) {
          diagnostic(
            diagnostics,
            "claim-vector-comparison",
            `${path}.evidenceIds`,
            "Verdict-bearing test-vector evidence requires a comparison activity that consumes both the exact vector and an implementation artifact under test.",
          );
        }
      }
    }
    if (
      claim.verdict === "not-assessed" &&
      (claim.basis !== "none" || claim.evidenceIds.length > 0)
    ) {
      diagnostic(
        diagnostics,
        "claim-not-assessed",
        path,
        "A not-assessed claim must use basis=none and reference no evidence.",
      );
    }
    if (
      ["pass", "fail"].includes(claim.verdict) &&
      (claim.evidenceIds.length === 0 ||
        !["reported-evidence", "validated-evidence", "independent-review"].includes(
          claim.basis,
        ))
    ) {
      diagnostic(
        diagnostics,
        "claim-evidence-required",
        path,
        "Passing and failing claims require referenced evidence and an evidence-based basis.",
      );
    }
    if (
      ["pass", "fail"].includes(claim.verdict) &&
      (claim.artifactIds.length === 0 ||
        claimEvidence.some(
          (item) =>
            !item.artifactIds.some((artifactId) =>
              claim.artifactIds.includes(artifactId),
            ),
        ))
    ) {
      diagnostic(
        diagnostics,
        "claim-evidence-locus",
        `${path}.artifactIds`,
        "Each verdict-bearing evidence item must share at least one exact artifact with the claim scope.",
      );
    }
    if (
      ["pass", "fail"].includes(claim.verdict) &&
      (claim.stageIds.length === 0 ||
        claimEvidence.some((item) => {
          if (item.activityId === undefined) {
            return false;
          }
          const activity = content.activities.find(
            (candidate) => candidate.id === item.activityId,
          );
          return (
            activity !== undefined &&
            !claim.stageIds.includes(activity.stageId)
          );
        }))
    ) {
      diagnostic(
        diagnostics,
        "claim-evidence-stage-locus",
        `${path}.stageIds`,
        "Every activity-backed verdict item must belong to a stage in the claim scope.",
      );
    }
    const unsupportedKinds = claimEvidence.filter(
      (item) =>
        item.kind !== "expected-specification" &&
        item.kind !== "declaration" &&
        !CLAIM_SUPPORT[claim.class].has(item.kind),
    );
    if (
      ["pass", "fail"].includes(claim.verdict) &&
      unsupportedKinds.length > 0
    ) {
      diagnostic(
        diagnostics,
        "claim-evidence-class",
        `${path}.evidenceIds`,
        `Evidence kind ${unsupportedKinds[0]?.kind ?? "unknown"} does not support a ${claim.class} verdict.`,
      );
    }
    if (
      claim.verdict === "pass" &&
      claimEvidence.some((item) => item.outcome === "fail")
    ) {
      diagnostic(
        diagnostics,
        "claim-conflicting-evidence",
        `${path}.evidenceIds`,
        "A passing claim cannot cite failing evidence.",
      );
    }
    if (
      claim.verdict === "fail" &&
      !claimEvidence.some((item) => item.outcome === "fail")
    ) {
      diagnostic(
        diagnostics,
        "claim-failure-evidence",
        `${path}.evidenceIds`,
        "A failing claim requires at least one failing evidence item.",
      );
    }
    if (claim.verdict === "pass") {
      const hasPassingEvidence = claimEvidence.some(
        (item) => item.outcome === "pass",
      );
      if (!hasPassingEvidence) {
        diagnostic(
          diagnostics,
          "claim-pass-evidence",
          `${path}.evidenceIds`,
          "A passing claim needs an explicit passing comparison, check, proof, report, or review receipt. A truth table plus an expected specification remains observational until a comparison activity produces passing evidence.",
        );
      }
    }
    if (
      claim.basis === "validated-evidence" &&
      !claimEvidence.some(
        (item) =>
          [
            "local-computed-unsigned",
            "tool-reported-unverified",
          ].includes(item.authenticity) &&
          (!["pass", "fail"].includes(claim.verdict) ||
            item.outcome === claim.verdict),
      )
    ) {
      diagnostic(
        diagnostics,
        "claim-validated-evidence",
        `${path}.basis`,
        "validated-evidence requires at least one host-computed or tool-reported item whose outcome supports the claim verdict; use reported-evidence when the verdict comes only from caller or external reports.",
      );
    }
    if (
      claim.basis === "independent-review" &&
      !claimEvidence.some(
        (item) =>
          item.kind === "qualified-review" &&
          (!["pass", "fail"].includes(claim.verdict) ||
            item.outcome === claim.verdict),
      )
    ) {
      diagnostic(
        diagnostics,
        "claim-review-evidence",
        `${path}.evidenceIds`,
        "An independent-review basis requires qualified-review evidence whose outcome supports the claim verdict.",
      );
    }
  }

  for (const [index, item] of content.diagnostics.entries()) {
    const path = `content.diagnostics.${index}`;
    if (item.stageId !== undefined && !ids.stages.has(item.stageId)) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.stageId`,
        `Unknown stage identifier: ${item.stageId}`,
      );
    }
    if (item.activityId !== undefined && !ids.activities.has(item.activityId)) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.activityId`,
        `Unknown activity identifier: ${item.activityId}`,
      );
    }
    if (item.activityId !== undefined) {
      const activity = content.activities.find(
        (candidate) => candidate.id === item.activityId,
      );
      if (
        activity !== undefined &&
        !activity.diagnosticIds.includes(item.id)
      ) {
        diagnostic(
          diagnostics,
          "diagnostic-activity-mismatch",
          `${path}.activityId`,
          "The related activity must list this diagnostic identifier.",
        );
      }
    }
    checkReferences(
      item.artifactIds,
      ids.artifacts,
      `${path}.artifactIds`,
      "artifact",
      diagnostics,
    );
  }
  for (const [index, risk] of content.risks.entries()) {
    checkReferences(
      risk.evidenceIds,
      ids.evidence,
      `content.risks.${index}.evidenceIds`,
      "evidence",
      diagnostics,
    );
  }

  for (const [index, signoff] of content.signoffs.entries()) {
    const path = `content.signoffs.${index}`;
    if (signoff.stageId !== undefined) {
      const stage = content.stages.find(
        (candidate) => candidate.id === signoff.stageId,
      );
      if (stage === undefined) {
        diagnostic(
          diagnostics,
          "dangling-reference",
          `${path}.stageId`,
          `Unknown stage identifier: ${signoff.stageId}`,
        );
      } else if (stage.kind !== "signoff") {
        diagnostic(
          diagnostics,
          "signoff-stage-kind",
          `${path}.stageId`,
          "A signoff may attach only to a stage with kind=signoff.",
        );
      }
    }
    if (
      ["accepted", "accepted-with-conditions", "rejected"].includes(
        signoff.status,
      ) &&
      signoff.stageId === undefined
    ) {
      diagnostic(
        diagnostics,
        "signoff-stage-required",
        `${path}.stageId`,
        "A terminal signoff requires an exact signoff-stage locus.",
      );
    }
    checkReferences(
      signoff.claimIds,
      ids.claims,
      `${path}.claimIds`,
      "claim",
      diagnostics,
    );
    checkReferences(
      signoff.artifactIds,
      ids.artifacts,
      `${path}.artifactIds`,
      "artifact",
      diagnostics,
    );
    checkReferences(
      signoff.evidenceIds,
      ids.evidence,
      `${path}.evidenceIds`,
      "evidence",
      diagnostics,
    );
    checkReferences(
      signoff.acceptedRiskIds,
      ids.risks,
      `${path}.acceptedRiskIds`,
      "risk",
      diagnostics,
    );
    if (
      signoff.status === "accepted-with-conditions" &&
      signoff.conditions.length === 0
    ) {
      diagnostic(
        diagnostics,
        "signoff-conditions",
        `${path}.conditions`,
        "Accepted-with-conditions signoff requires explicit conditions.",
      );
    }
    if (
      ["accepted", "accepted-with-conditions"].includes(signoff.status) &&
      (signoff.evidenceIds.length === 0 ||
        signoff.claimIds.length + signoff.artifactIds.length === 0)
    ) {
      diagnostic(
        diagnostics,
        "signoff-scope",
        path,
        "An accepted signoff requires evidence and an explicit claim or artifact scope.",
      );
    }
    if (["accepted", "accepted-with-conditions"].includes(signoff.status)) {
      const scopedArtifactIds = new Set(signoff.artifactIds);
      for (const claimId of signoff.claimIds) {
        const claim = content.claims.find(
          (candidate) => candidate.id === claimId,
        );
        for (const artifactId of claim?.artifactIds ?? []) {
          scopedArtifactIds.add(artifactId);
        }
      }
      for (const evidenceId of signoff.evidenceIds) {
        const evidence = content.evidence.find(
          (candidate) => candidate.id === evidenceId,
        );
        if (
          evidence !== undefined &&
          !evidence.artifactIds.some((artifactId) =>
            scopedArtifactIds.has(artifactId),
          )
        ) {
          diagnostic(
            diagnostics,
            "signoff-evidence-locus",
            `${path}.evidenceIds`,
            `Signoff evidence ${evidenceId} does not intersect the accepted claim/artifact scope.`,
          );
        }
      }
    }
    for (const riskId of signoff.acceptedRiskIds) {
      const risk = content.risks.find((candidate) => candidate.id === riskId);
      if (risk !== undefined && risk.status !== "accepted") {
        diagnostic(
          diagnostics,
          "signoff-risk-status",
          `${path}.acceptedRiskIds`,
          `Risk ${riskId} must have status=accepted before a signoff can accept it.`,
        );
      }
    }
    if (
      ["accepted", "accepted-with-conditions"].includes(signoff.status) &&
      content.risks.some(
        (risk) =>
          ["high", "critical"].includes(risk.severity) &&
          risk.status === "open",
      )
    ) {
      diagnostic(
        diagnostics,
        "signoff-open-risk",
        path,
        "An accepted signoff cannot hide an open high or critical risk.",
      );
    }
  }

  for (const [index, item] of content.provenance.entries()) {
    const path = `content.provenance.${index}`;
    const subjectSet =
      item.subjectType === "artifact"
        ? ids.artifacts
        : item.subjectType === "activity"
          ? ids.activities
          : item.subjectType === "evidence"
            ? ids.evidence
            : ids.claims;
    if (!subjectSet.has(item.subjectId)) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `${path}.subjectId`,
        `Unknown ${item.subjectType} identifier: ${item.subjectId}`,
      );
    }
    checkReferences(
      item.sourceArtifactIds,
      ids.artifacts,
      `${path}.sourceArtifactIds`,
      "artifact",
      diagnostics,
    );
    reportDuplicates(
      item.sourceRecordDigests,
      `${path}.sourceRecordDigests`,
      "source record digest",
      diagnostics,
    );
  }

  for (const [index, extension] of content.extensions.entries()) {
    const path = `content.extensions.${index}.appliesTo`;
    checkReferences(
      extension.appliesTo.stageIds,
      ids.stages,
      `${path}.stageIds`,
      "stage",
      diagnostics,
    );
    checkReferences(
      extension.appliesTo.activityIds,
      ids.activities,
      `${path}.activityIds`,
      "activity",
      diagnostics,
    );
    checkReferences(
      extension.appliesTo.artifactIds,
      ids.artifacts,
      `${path}.artifactIds`,
      "artifact",
      diagnostics,
    );
    checkReferences(
      extension.appliesTo.evidenceIds,
      ids.evidence,
      `${path}.evidenceIds`,
      "evidence",
      diagnostics,
    );
    checkReferences(
      extension.appliesTo.claimIds,
      ids.claims,
      `${path}.claimIds`,
      "claim",
      diagnostics,
    );
  }
  validateExtensions(content.extensions, content, diagnostics);
  validateKnownAdapterCoverage(content, diagnostics);

  if (
    content.completeness.status === "complete" &&
    (content.completeness.omittedSections.length > 0 ||
      content.completeness.reasons.length > 0)
  ) {
    diagnostic(
      diagnostics,
      "completeness-contradiction",
      "content.completeness",
      "A complete record cannot list omitted sections or partial-record reasons.",
    );
  }
  if (
    content.completeness.status === "partial" &&
    content.completeness.reasons.length === 0
  ) {
    diagnostic(
      diagnostics,
      "completeness-reason",
      "content.completeness.reasons",
      "A partial record requires at least one reason.",
    );
  }

  reportDuplicates(
    record.lineage.parents.map((parent) => parent.recordId),
    "lineage.parents",
    "parent record",
    diagnostics,
  );
  for (const parent of record.lineage.parents) {
    if (parent.recordId === record.recordId) {
      diagnostic(
        diagnostics,
        "lineage-self-reference",
        "lineage.parents",
        "A record cannot name itself as a parent.",
      );
    }
  }
  if (
    record.recordType === "aggregate" &&
    !record.lineage.parents.some((parent) => parent.relation === "aggregates")
  ) {
    diagnostic(
      diagnostics,
      "aggregate-lineage",
      "lineage.parents",
      "An aggregate record requires at least one parent with relation=aggregates.",
    );
  }
  if (record.recordType === "aggregate") {
    const boundSourceDigests = new Set(
      content.provenance.flatMap((item) => item.sourceRecordDigests),
    );
    for (const parent of record.lineage.parents.filter(
      (item) => item.relation === "aggregates",
    )) {
      if (!boundSourceDigests.has(parent.recordDigest)) {
        diagnostic(
          diagnostics,
          "aggregate-evidence-lineage",
          "content.provenance",
          `Aggregate parent ${parent.recordId} must bind its recordDigest into content.provenance.sourceRecordDigests so evidenceDigest identifies the exact child set.`,
        );
      }
    }
  }
  if (
    record.recordType === "run" &&
    record.lineage.parents.some((parent) => parent.relation === "aggregates")
  ) {
    diagnostic(
      diagnostics,
      "aggregate-lineage",
      "lineage.parents",
      "Only recordType=aggregate may use relation=aggregates.",
    );
  }
  reportDuplicates(
    record.metadata.activityTiming.map((item) => item.activityId),
    "metadata.activityTiming",
    "activity timing",
    diagnostics,
  );
  for (const [index, timing] of record.metadata.activityTiming.entries()) {
    if (!ids.activities.has(timing.activityId)) {
      diagnostic(
        diagnostics,
        "dangling-reference",
        `metadata.activityTiming.${index}.activityId`,
        `Unknown activity identifier: ${timing.activityId}`,
      );
    }
    if (
      timing.startedAt !== undefined &&
      timing.finishedAt !== undefined &&
      Date.parse(timing.finishedAt) < Date.parse(timing.startedAt)
    ) {
      diagnostic(
        diagnostics,
        "activity-timestamp-order",
        `metadata.activityTiming.${index}`,
        "finishedAt cannot be earlier than startedAt.",
      );
    }
    if (
      timing.startedAt !== undefined &&
      timing.finishedAt !== undefined &&
      timing.durationMilliseconds !== undefined &&
      Date.parse(timing.finishedAt) - Date.parse(timing.startedAt) !==
        timing.durationMilliseconds
    ) {
      diagnostic(
        diagnostics,
        "activity-duration",
        `metadata.activityTiming.${index}.durationMilliseconds`,
        "durationMilliseconds must equal the elapsed UTC timestamp interval at millisecond precision.",
      );
    }
    if (
      record.metadata.capturedAt !== undefined &&
      timing.finishedAt !== undefined &&
      Date.parse(timing.finishedAt) > Date.parse(record.metadata.capturedAt)
    ) {
      diagnostic(
        diagnostics,
        "capture-timestamp-order",
        `metadata.activityTiming.${index}.finishedAt`,
        "An activity cannot finish after the record's capturedAt timestamp.",
      );
    }
  }

  return diagnostics;
}

export interface RunRecordValidation {
  valid: boolean;
  diagnostics: Diagnostic[];
  record?: SealedRunRecord;
}

export function validateAndSealRunRecord(
  input: unknown,
  expected: {
    recordDigest?: string;
    evidenceDigest?: string;
  } = {},
): RunRecordValidation {
  const boundDiagnostics = inspectJsonBounds(input);
  if (boundDiagnostics.some((item) => item.severity === "error")) {
    return { valid: false, diagnostics: boundDiagnostics };
  }

  const parsed = RunRecordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      diagnostics: [
        ...boundDiagnostics,
        ...parsed.error.issues.map((issue) => ({
          severity: "error" as const,
          code: "run-record-schema",
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      ],
    };
  }

  const suppliedSeal = parsed.data.seal;
  const normalizedContent = normalizeContent(parsed.data.content);
  const normalizedWithoutSeal = {
    schemaVersion: parsed.data.schemaVersion,
    recordId: parsed.data.recordId,
    recordType: parsed.data.recordType,
    recordStatus: parsed.data.recordStatus,
    metadata: {
      ...parsed.data.metadata,
      activityTiming: [...parsed.data.metadata.activityTiming].sort(
        (left, right) =>
          compareCodeUnits(left.activityId, right.activityId),
      ),
    },
    lineage: {
      parents: [...parsed.data.lineage.parents].sort((left, right) => {
        const byId = compareCodeUnits(left.recordId, right.recordId);
        return byId === 0
          ? compareCodeUnits(left.relation, right.relation)
          : byId;
      }),
    },
    content: normalizedContent,
  } satisfies Omit<RunRecord, "seal">;
  const semantic = semanticDiagnostics(normalizedWithoutSeal);
  const diagnostics = [...boundDiagnostics, ...semantic];
  const evidenceDigest = digestCanonicalJson(normalizedContent);
  const recordDigest = digestCanonicalJson(normalizedWithoutSeal);
  const normalizedCollectionBounds = collectionBounds(normalizedContent);

  for (const extension of parsed.data.content.extensions) {
    if (
      extension.payloadDigest !== undefined &&
      extension.payloadDigest !== digestCanonicalJson(extension.payload)
    ) {
      // The semantic pass reports the precise path. This keeps the seal from
      // being accepted even if a future refactor changes that pass.
      if (
        !diagnostics.some(
          (item) => item.code === "extension-digest-conflict",
        )
      ) {
        diagnostic(
          diagnostics,
          "extension-digest-conflict",
          "content.extensions",
          "An extension payload digest does not match its canonical payload.",
        );
      }
    }
  }

  if (
    suppliedSeal !== undefined &&
    suppliedSeal.evidenceDigest !== evidenceDigest
  ) {
    diagnostic(
      diagnostics,
      "evidence-digest-conflict",
      "seal.evidenceDigest",
      "The embedded evidence digest does not match normalized record content.",
    );
  }
  if (
    suppliedSeal !== undefined &&
    suppliedSeal.recordDigest !== recordDigest
  ) {
    diagnostic(
      diagnostics,
      "record-digest-conflict",
      "seal.recordDigest",
      "The embedded record digest does not match the normalized record.",
    );
  }
  if (
    suppliedSeal !== undefined &&
    canonicalJson(suppliedSeal.collectionBounds) !==
      canonicalJson(normalizedCollectionBounds)
  ) {
    diagnostic(
      diagnostics,
      "seal-collection-bounds-conflict",
      "seal.collectionBounds",
      "The embedded collection bounds do not match the normalized record.",
    );
  }
  if (
    expected.evidenceDigest !== undefined &&
    expected.evidenceDigest !== evidenceDigest
  ) {
    diagnostic(
      diagnostics,
      "expected-evidence-digest-conflict",
      "expectedEvidenceDigest",
      "The expected evidence digest does not match normalized record content.",
    );
  }
  if (
    expected.recordDigest !== undefined &&
    expected.recordDigest !== recordDigest
  ) {
    diagnostic(
      diagnostics,
      "expected-record-digest-conflict",
      "expectedRecordDigest",
      "The expected record digest does not match the normalized record.",
    );
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return { valid: false, diagnostics };
  }

  const sealedRecord: SealedRunRecord = {
    ...normalizedWithoutSeal,
    seal: {
      canonicalization: CANONICAL_JSON_PROFILE,
      evidenceDigest,
      recordDigest,
      authenticity: RUN_RECORD_AUTHENTICITY,
      evidenceDigestScope: "content",
      recordDigestScope: "record-excluding-seal",
      collectionBounds: normalizedCollectionBounds,
    },
  };
  SealedRunRecordSchema.parse(sealedRecord);
  return { valid: true, diagnostics, record: sealedRecord };
}

export function validateAndSealSerializedRunRecord(
  serializedRecord: string,
  expected: {
    recordDigest?: string;
    evidenceDigest?: string;
  } = {},
): RunRecordValidation {
  if (
    Buffer.byteLength(serializedRecord, "utf8") > MAX_RUN_RECORD_BYTES
  ) {
    return {
      valid: false,
      diagnostics: [
        {
          severity: "error",
          code: "record-byte-bound",
          path: "serializedRecord",
          message: `Serialized run records may contain at most ${MAX_RUN_RECORD_BYTES} UTF-8 bytes.`,
        },
      ],
    };
  }
  try {
    const parsed = parseJsonWithoutDuplicateKeys(serializedRecord, {
      maxCharacters: MAX_RUN_RECORD_BYTES,
      maxDepth: MAX_RUN_RECORD_DEPTH,
    });
    return validateAndSealRunRecord(parsed, expected);
  } catch (error) {
    return {
      valid: false,
      diagnostics: [
        {
          severity: "error",
          code:
            error instanceof DuplicateJsonKeyError
              ? "duplicate-json-key"
              : "serialized-json-invalid",
          path:
            error instanceof DuplicateJsonKeyError
              ? error.objectPath
              : "serializedRecord",
          message:
            error instanceof Error
              ? error.message.slice(0, MAX_STATEMENT_CHARACTERS)
              : "Serialized run record is invalid JSON.",
        },
      ],
    };
  }
}

export function runRecordSchemaResource(): unknown {
  return {
    schemaVersion: "circuitarium.schema-resource/0.1",
    recordVersion: RUN_RECORD_VERSION,
    jsonSchema: z.toJSONSchema(RunRecordSchema, {
      target: "draft-2020-12",
    }),
    canonicalization: {
      profile: CANONICAL_JSON_PROFILE,
      objectKeys: "ECMAScript UTF-16 code-unit order",
      arrays:
        "Stage and activity arrays preserve process order. Identifier-based collections and reference sets are normalized by stable identifier before sealing.",
      numbers:
        "Finite IEEE-754 JSON numbers only; unsafe integers are rejected and -0 canonicalizes to 0. Exact engineering quantities use decimal strings plus units.",
      objects:
        "Only arrays and plain JSON objects are accepted. Class instances, Date, Map, Set, functions, symbols, cycles, and other non-JSON values are rejected.",
      absence:
        "Optional absent fields are omitted. null is retained only where a schema explicitly permits it.",
    },
    digestScopes: {
      evidenceDigest:
        "Canonical normalized content only. Record IDs, lineage, timestamps, execution IDs, and server instance IDs do not change it. Aggregate records must repeat every aggregated parent digest in content.provenance, so changing the child set changes evidenceDigest.",
      recordDigest:
        "The entire normalized record except seal. Metadata changes therefore change recordDigest.",
    },
    semanticConstraints: [
      "Stage and activity sequence values are contiguous, one-based, and agree with array order; dependencies point only to earlier entries and cannot flow backward across stage order.",
      "Every typed reference resolves, identifiers are unique within their collection, and artifact derivation is acyclic.",
      "Materialized artifacts carry exact SHA-256 identity. Producing activities and output artifacts reference each other; a non-planned output requires a completed or reported-only producer.",
      "A completed or reported-only activity needs an honest observation basis plus a digest, evidence, diagnostic, or output-artifact receipt. Activity-produced evidence repeats the activity result digest and verdict-bearing evidence determines the activity outcome; output artifact digests identify the separate artifact value. Terminal work cannot depend on nonterminal work.",
      "Evidence kind must fit its activity kind and every known Circuitarium operation's maximum authority. Observation basis determines evidence authenticity.",
      "Passing and failing claims require outcome-matching evidence for every exact subject at the same artifact and stage locus. Expected specifications and verdict-bearing vectors cannot share or derive from the implementation under test through artifact lineage, provenance, or a producer activity; the comparison must consume both sides. A truth table and expected specification remain observations until an explicit comparison receipt passes.",
      "Truth tables and vectors require nonempty bounded coverage. Passing vectors require untruncated exhaustive or listed-sequence coverage with equal planned and executed counts.",
      "Known adapter evidence requires a critical, version-pinned extension whose applied activities, evidence, claims, project, vector, runtime status, runtime safety, and toolchain identity share one exact locus.",
      "Circuitarium operation namespaces accept only exact lowercase registered identifiers and fail closed on unknown or noncanonical names.",
      "Unknown critical extensions fail closed. Unknown noncritical extensions are preserved, digest-bound, and uninterpreted.",
      "Accepted signoff is a scoped caller-reported attestation whose evidence intersects its claim/artifact scope. It cannot hide open high or critical risks and is never project-wide certification.",
      "Aggregate records bind every aggregated parent record digest into content provenance so their evidence identity changes with the child set.",
      "Bounds reject oversized input; evidence and diagnostics are never silently truncated.",
    ],
    compatibility: {
      claimEvidenceKinds: Object.fromEntries(
        Object.entries(CLAIM_SUPPORT).map(([claimClass, kinds]) => [
          claimClass,
          [...kinds].sort(compareCodeUnits),
        ]),
      ),
      evidenceActivityKinds: Object.fromEntries(
        Object.entries(EVIDENCE_ACTIVITY_KINDS).map(
          ([evidenceKind, kinds]) => [
            evidenceKind,
            [...kinds].sort(compareCodeUnits),
          ],
        ),
      ),
      knownOperationEvidenceKinds: Object.fromEntries(
        [...KNOWN_OPERATION_EVIDENCE_KINDS.entries()]
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([operation, kinds]) => [
            operation,
            [...kinds].sort(compareCodeUnits),
          ]),
      ),
      observationAuthenticity: {
        "host-observed": "local-computed-unsigned",
        "tool-reported": "tool-reported-unverified",
        "caller-reported": "caller-reported-unverified",
        "externally-reported": "external-unverified",
      },
      claimBasis: {
        "reported-evidence":
          "Use when the verdict is supported only by caller or external reports.",
        "validated-evidence":
          "Requires a host-computed or tool-reported item whose outcome supports a pass/fail verdict.",
        "independent-review":
          "Requires caller/external qualified-review evidence whose outcome supports a pass/fail verdict.",
      },
      verdictSubjectArtifactRoles: [...SUBJECT_ARTIFACT_ROLES].sort(
        compareCodeUnits,
      ),
      oracleIndependence: {
        expectedSpecification:
          "Must be a distinct artifact identity and SHA-256 value from every implementation under test, with no direct, transitive, provenance-source, or producer-input dependency on it.",
        testVector:
          "Verdict-bearing vectors follow the same independence rule and must be consumed with a claim-scoped subject by their comparison activity.",
      },
    },
    bounds: {
      encodedBytes: MAX_RUN_RECORD_BYTES,
      depth: MAX_RUN_RECORD_DEPTH,
      aggregateProperties: MAX_RUN_RECORD_PROPERTIES,
      stringCharacters: MAX_RUN_RECORD_STRING_CHARACTERS,
      stages: MAX_RUN_RECORD_STAGES,
      toolIdentities: MAX_RUN_RECORD_TOOL_IDENTITIES,
      artifacts: MAX_RUN_RECORD_ARTIFACTS,
      activities: MAX_RUN_RECORD_ACTIVITIES,
      claims: MAX_RUN_RECORD_CLAIMS,
      evidence: MAX_RUN_RECORD_EVIDENCE,
      diagnostics: MAX_RUN_RECORD_DIAGNOSTICS,
      risks: MAX_RUN_RECORD_RISKS,
      signoffs: MAX_RUN_RECORD_SIGNOFFS,
      provenance: MAX_RUN_RECORD_PROVENANCE,
      extensions: MAX_RUN_RECORD_EXTENSIONS,
      extensionBytes: MAX_RUN_RECORD_EXTENSION_BYTES,
      lineageParents: MAX_RUN_RECORD_LINEAGE_PARENTS,
      intentItemsPerCollection: MAX_RUN_RECORD_INTENT_ITEMS,
    },
    extensions: {
      known: [
        CRUMB_RUN_RECORD_EXTENSION_ID,
        LOGISIM_RUN_RECORD_EXTENSION_ID,
      ],
      rule:
        "Adapter-specific data belongs in a bounded reverse-domain extension and cannot shadow core claims, verdicts, seals, or authenticity.",
    },
    parserBoundary:
      "Use serializedRecord for external JSON: Circuitarium rejects duplicate keys, escaped-equivalent duplicate keys, BOMs, trailing content, excessive depth, and excessive encoded size before JSON.parse. Unsafe integers and other non-JSON numeric values fail bounded validation after parsing. The record-object input cannot recover duplicate keys already collapsed by an upstream parser.",
    trustBoundary:
      "SHA-256 sealing supplies portable content identity and integrity only when an expected digest is trusted separately. Records are unsigned-unverified: they do not prove authorship, execution, permission, safety, signoff authority, physical correctness, or fabrication readiness.",
  };
}
