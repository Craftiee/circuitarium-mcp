import { z } from "zod";

import {
  compareCodeUnits,
  digestCanonicalJson,
  sha256Text,
} from "./canonical.js";

export const MAX_VERIFICATION_CLAIMS = 32;
export const MAX_VERIFICATION_EVIDENCE_ITEMS = 64;
export const MAX_VERIFICATION_SIGNALS = 64;
export const MAX_VERIFICATION_INTERFACE_BITS = 1_024;
export const MAX_VERIFICATION_STEPS = 32;
export const MAX_VERIFICATION_MATRIX_ENTRIES = 192;
export const MAX_VERIFICATION_GAPS = 128;
export const MAX_VERIFICATION_TEST_SUGGESTIONS = 32;
export const MAX_VERIFICATION_CASES = 1_000_000;
export const MAX_LOGISIM_TRUTH_TABLE_INPUT_BITS = 12;
export const MAX_LOGISIM_TRUTH_TABLE_ROWS = 4_096;

const MAX_IDENTIFIER_CHARACTERS = 64;
const MAX_PROJECT_REF_CHARACTERS = 4_096;
const MAX_CIRCUIT_NAME_CHARACTERS = 256;
const MAX_CLAIM_STATEMENT_CHARACTERS = 512;
const MAX_CLAIM_STATEMENT_PREVIEW_CHARACTERS = 160;
const MAX_REASON_CHARACTERS = 1_024;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_CHARACTERS)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u,
    "Use a stable identifier without spaces",
  );
const ProjectRefSchema = z.string().min(1).max(MAX_PROJECT_REF_CHARACTERS);
const ProjectDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const CircuitNameSchema = z.string().min(1).max(MAX_CIRCUIT_NAME_CHARACTERS);

export const VerificationClaimClassSchema = z.enum([
  "artifact-structure",
  "topology-connectivity",
  "static-electrical-rules",
  "simulator-load",
  "combinational-behavior",
  "sequential-behavior",
  "conversion-readiness",
  "physical-hardware",
]);

export const VerificationEvidenceKindSchema = z.enum([
  "static-analysis",
  "static-netlist",
  "static-erc",
  "conversion-report",
  "simulator-project-load",
  "truth-table",
  "test-vector",
  "expected-specification",
  "physical-measurement",
  "qualified-review",
]);

export const VerificationEvidenceSourceSchema = z.enum([
  "crumb_validate_design",
  "crumb_analyze_design",
  "crumb_export_netlist",
  "crumb_check_design",
  "logisim_analyze_design",
  "logisim_export_netlist",
  "logisim_component_stats",
  "logisim_truth_table",
  "logisim_run_test_vector",
  "external",
]);

const CrumbVerificationTargetSchema = z
  .object({
    backendId: z.literal("crumb.file"),
    compatibilityProfile: z
      .literal("crumb.unity/1.3.5")
      .default("crumb.unity/1.3.5"),
    projectRef: ProjectRefSchema,
    projectDigest: ProjectDigestSchema.optional(),
    topologyMode: z
      .enum(["direct-only", "known-board-v1.3.5"])
      .default("known-board-v1.3.5"),
    applySwitchStates: z.boolean().default(false),
  })
  .strict();

const LogisimVerificationTargetSchema = z
  .object({
    backendId: z.literal("logisim.evolution"),
    compatibilityProfile: z
      .literal("logisim-evolution/4.1.0")
      .default("logisim-evolution/4.1.0"),
    projectRef: ProjectRefSchema,
    projectDigest: ProjectDigestSchema.optional(),
    circuit: CircuitNameSchema.optional(),
    vectorRef: ProjectRefSchema.optional(),
    vectorDigest: ProjectDigestSchema.optional(),
    runtimeStatus: z
      .enum([
        "available",
        "unconfigured",
        "unavailable",
        "version-mismatch",
        "unknown",
      ])
      .default("unknown"),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.vectorDigest !== undefined && target.vectorRef === undefined) {
      context.addIssue({
        code: "custom",
        path: ["vectorDigest"],
        message: "vectorDigest requires vectorRef",
      });
    }
  });

export const VerificationTargetSchema = z.discriminatedUnion("backendId", [
  CrumbVerificationTargetSchema,
  LogisimVerificationTargetSchema,
]);

export const VerificationClaimScopeSchema = z.enum([
  "artifact",
  "selected-circuit",
  "listed-cases",
  "physical-system",
]);

export const VerificationClaimSchema = z
  .object({
    id: IdentifierSchema,
    claimClass: VerificationClaimClassSchema,
    objective: z.enum(["characterize", "verify"]),
    scope: VerificationClaimScopeSchema,
    statement: z.string().min(1).max(MAX_CLAIM_STATEMENT_CHARACTERS).optional(),
  })
  .strict()
  .superRefine((claim, context) => {
    const allowedScopes = {
      "artifact-structure": ["artifact"],
      "topology-connectivity": ["artifact", "selected-circuit"],
      "static-electrical-rules": ["artifact"],
      "simulator-load": ["selected-circuit"],
      "combinational-behavior": ["selected-circuit", "listed-cases"],
      "sequential-behavior": ["selected-circuit", "listed-cases"],
      "conversion-readiness": ["artifact"],
      "physical-hardware": ["physical-system"],
    } satisfies Record<
      z.infer<typeof VerificationClaimClassSchema>,
      readonly z.infer<typeof VerificationClaimScopeSchema>[]
    >;
    const claimScopes = allowedScopes[claim.claimClass] as readonly z.infer<
      typeof VerificationClaimScopeSchema
    >[];
    if (!claimScopes.includes(claim.scope)) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message:
          `${claim.claimClass} claims require one of these scopes: ` +
          allowedScopes[claim.claimClass].join(", "),
      });
    }
  });

export const VerificationSignalSchema = z
  .object({
    id: IdentifierSchema,
    direction: z.enum(["input", "output", "inout"]),
    width: z.number().int().min(1).max(256),
    role: z.enum([
      "data",
      "clock",
      "reset",
      "enable",
      "select",
      "carry",
      "other",
    ]),
    activeLevel: z.enum(["high", "low"]).optional(),
  })
  .strict();

export const VerificationInterfaceSchema = z
  .object({
    designIntent: z
      .enum(["combinational", "sequential", "mixed", "unknown"])
      .default("unknown"),
    signals: z
      .array(VerificationSignalSchema)
      .max(MAX_VERIFICATION_SIGNALS)
      .default([]),
  })
  .strict()
  .superRefine((declaredInterface, context) => {
    addDuplicateIssues(
      declaredInterface.signals.map((signal) => signal.id),
      ["signals"],
      "signal",
      context,
    );
    const totalBits = declaredInterface.signals.reduce(
      (sum, signal) => sum + signal.width,
      0,
    );
    if (totalBits > MAX_VERIFICATION_INTERFACE_BITS) {
      context.addIssue({
        code: "too_big",
        origin: "array",
        maximum: MAX_VERIFICATION_INTERFACE_BITS,
        inclusive: true,
        path: ["signals"],
        message:
          `Declared interface contains ${totalBits} bits; ` +
          `the limit is ${MAX_VERIFICATION_INTERFACE_BITS}`,
      });
    }
  });

export const VerificationCoverageSchema = z
  .object({
    mode: z.enum([
      "not-applicable",
      "sampled",
      "partitioned",
      "exhaustive",
      "listed-sequences",
    ]),
    casesPlanned: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_VERIFICATION_CASES)
      .optional(),
    casesExecuted: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_VERIFICATION_CASES)
      .optional(),
    truncated: z.boolean().default(false),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      coverage.casesPlanned !== undefined &&
      coverage.casesExecuted !== undefined &&
      coverage.casesExecuted > coverage.casesPlanned
    ) {
      context.addIssue({
        code: "custom",
        path: ["casesExecuted"],
        message: "casesExecuted cannot exceed casesPlanned",
      });
    }
    if (
      coverage.mode === "exhaustive" &&
      (coverage.truncated ||
        coverage.casesPlanned === undefined ||
        coverage.casesExecuted === undefined ||
        coverage.casesPlanned !== coverage.casesExecuted)
    ) {
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message:
          "Exhaustive coverage requires equal planned and executed case counts and truncated=false",
      });
    }
  });

const CrumbArtifactEvidenceBindingSchema = z
  .object({
    backendId: z.literal("crumb.file"),
    compatibilityProfile: z.literal("crumb.unity/1.3.5"),
    locus: z.literal("artifact"),
  })
  .strict();

const CrumbTopologyEvidenceBindingSchema = z
  .object({
    backendId: z.literal("crumb.file"),
    compatibilityProfile: z.literal("crumb.unity/1.3.5"),
    locus: z.literal("topology"),
    topologyMode: z.enum(["direct-only", "known-board-v1.3.5"]),
    applySwitchStates: z.boolean(),
  })
  .strict();

const LogisimArtifactEvidenceBindingSchema = z
  .object({
    backendId: z.literal("logisim.evolution"),
    compatibilityProfile: z.literal("logisim-evolution/4.1.0"),
    locus: z.literal("artifact"),
  })
  .strict();

const LogisimCircuitEvidenceBindingSchema = z
  .object({
    backendId: z.literal("logisim.evolution"),
    compatibilityProfile: z.literal("logisim-evolution/4.1.0"),
    locus: z.literal("circuit"),
    circuit: CircuitNameSchema,
  })
  .strict();

export const VerificationEvidenceBindingSchema = z.union([
  CrumbArtifactEvidenceBindingSchema,
  CrumbTopologyEvidenceBindingSchema,
  LogisimArtifactEvidenceBindingSchema,
  LogisimCircuitEvidenceBindingSchema,
]);

export const VerificationEvidenceFactsSchema = z
  .object({
    runtimeSafe: z.boolean().optional(),
    unknownConstructCount: z.number().int().nonnegative().optional(),
    distinctInputAssignments: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_VERIFICATION_CASES)
      .optional(),
    conversionCompleteness: z.enum(["complete", "partial"]).optional(),
    conversionLossImpacts: z
      .array(z.enum(["metadata", "topology", "behavior", "simulation"]))
      .max(4)
      .default([]),
    ruleSet: z.array(IdentifierSchema).max(64).default([]),
  })
  .strict()
  .superRefine((facts, context) => {
    addDuplicateIssues(
      facts.conversionLossImpacts,
      ["conversionLossImpacts"],
      "conversion loss impact",
      context,
    );
    addDuplicateIssues(facts.ruleSet, ["ruleSet"], "rule id", context);
  });

export const VerificationEvidenceSchema = z
  .object({
    id: IdentifierSchema,
    claimIds: z.array(IdentifierSchema).min(1).max(MAX_VERIFICATION_CLAIMS),
    kind: VerificationEvidenceKindSchema,
    source: VerificationEvidenceSourceSchema,
    outcome: z.enum(["observed", "pass", "fail", "inconclusive"]),
    projectDigest: ProjectDigestSchema,
    binding: VerificationEvidenceBindingSchema,
    vectorRef: ProjectRefSchema.optional(),
    vectorDigest: ProjectDigestSchema.optional(),
    coverage: VerificationCoverageSchema,
    facts: VerificationEvidenceFactsSchema.default({
      conversionLossImpacts: [],
      ruleSet: [],
    }),
  })
  .strict()
  .superRefine((evidence, context) => {
    addDuplicateIssues(
      evidence.claimIds,
      ["claimIds"],
      "claim reference",
      context,
    );
    if (evidence.kind === "truth-table" && evidence.outcome !== "observed") {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message:
          "Truth-table evidence characterizes observed output and must use outcome=observed",
      });
    }
    if (
      ["static-erc", "test-vector"].includes(evidence.kind) &&
      evidence.outcome === "observed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: `${evidence.kind} evidence must report pass, fail, or inconclusive`,
      });
    }
    if (
      evidence.kind === "test-vector" &&
      (evidence.vectorRef === undefined || evidence.vectorDigest === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: [evidence.vectorRef === undefined ? "vectorRef" : "vectorDigest"],
        message: "Test-vector evidence requires vectorRef and vectorDigest",
      });
    }
    if (
      evidence.kind !== "test-vector" &&
      (evidence.vectorRef !== undefined || evidence.vectorDigest !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: [evidence.vectorRef !== undefined ? "vectorRef" : "vectorDigest"],
        message:
          "vectorRef and vectorDigest are valid only for test-vector evidence",
      });
    }
    if (!sourceSupportsEvidenceKind(evidence.source, evidence.kind)) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: `${evidence.source} cannot supply ${evidence.kind} evidence`,
      });
    }
    if (!sourceSupportsEvidenceBinding(evidence)) {
      context.addIssue({
        code: "custom",
        path: ["binding"],
        message:
          `${evidence.source} ${evidence.kind} evidence requires its exact ` +
          "artifact, topology, or circuit binding",
      });
    }
  });

export const VerificationPlanInputSchema = z
  .object({
    target: VerificationTargetSchema,
    claims: z
      .array(VerificationClaimSchema)
      .min(1)
      .max(MAX_VERIFICATION_CLAIMS),
    declaredInterface: VerificationInterfaceSchema.optional(),
    evidence: z
      .array(VerificationEvidenceSchema)
      .max(MAX_VERIFICATION_EVIDENCE_ITEMS)
      .default([]),
  })
  .strict()
  .superRefine((input, context) => {
    addDuplicateIssues(
      input.claims.map((claim) => claim.id),
      ["claims"],
      "claim",
      context,
    );
    addDuplicateIssues(
      input.evidence.map((evidence) => evidence.id),
      ["evidence"],
      "evidence",
      context,
    );

    const claimIds = new Set(input.claims.map((claim) => claim.id));
    const evidenceDigests = new Set<string>();
    const vectorDigests = new Set<string>();
    for (const [evidenceIndex, evidence] of input.evidence.entries()) {
      evidenceDigests.add(evidence.projectDigest);
      if (evidence.kind === "test-vector") {
        if (evidence.vectorDigest !== undefined) {
          vectorDigests.add(evidence.vectorDigest);
        }
        if (
          input.target.backendId === "logisim.evolution" &&
          (input.target.vectorRef === undefined ||
            evidence.vectorRef !== input.target.vectorRef)
        ) {
          context.addIssue({
            code: "custom",
            path: ["evidence", evidenceIndex, "vectorRef"],
            message:
              input.target.vectorRef === undefined
                ? "Test-vector evidence requires an exact target vectorRef"
                : "Test-vector evidence vectorRef does not match the target vectorRef",
          });
        }
      }
      for (const [claimIndex, claimId] of evidence.claimIds.entries()) {
        if (!claimIds.has(claimId)) {
          context.addIssue({
            code: "custom",
            path: ["evidence", evidenceIndex, "claimIds", claimIndex],
            message: `Evidence references unknown claim: ${claimId}`,
          });
        }
      }
      if (
        input.target.projectDigest !== undefined &&
        evidence.projectDigest !== input.target.projectDigest
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence", evidenceIndex, "projectDigest"],
          message:
            "Evidence projectDigest does not match the target projectDigest",
        });
      }
      if (
        input.target.backendId === "crumb.file" &&
        evidence.binding.backendId !== "crumb.file"
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence", evidenceIndex, "binding", "backendId"],
          message: "Evidence binding does not match the CRUMB target",
        });
      }
      if (
        input.target.backendId === "logisim.evolution" &&
        evidence.binding.backendId !== "logisim.evolution"
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence", evidenceIndex, "binding", "backendId"],
          message: "Evidence binding does not match the Logisim target",
        });
      }
      if (
        input.target.backendId === "crumb.file" &&
        evidence.binding.backendId === "crumb.file" &&
        evidence.binding.locus === "topology" &&
        (evidence.binding.topologyMode !== input.target.topologyMode ||
          evidence.binding.applySwitchStates !== input.target.applySwitchStates)
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence", evidenceIndex, "binding"],
          message:
            "Topology evidence binding does not match the target topologyMode and applySwitchStates",
        });
      }
      if (
        input.target.backendId === "logisim.evolution" &&
        evidence.binding.backendId === "logisim.evolution" &&
        evidence.binding.locus === "circuit" &&
        (input.target.circuit === undefined ||
          evidence.binding.circuit !== input.target.circuit)
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence", evidenceIndex, "binding", "circuit"],
          message:
            input.target.circuit === undefined
              ? "Circuit-bound evidence requires an explicit target circuit"
              : "Evidence circuit does not match the target circuit",
        });
      }
      if (
        input.target.backendId === "logisim.evolution" &&
        input.target.vectorDigest !== undefined &&
        evidence.kind === "test-vector" &&
        evidence.vectorDigest !== input.target.vectorDigest
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence", evidenceIndex, "vectorDigest"],
          message:
            "Test-vector evidence vectorDigest does not match the target vectorDigest",
        });
      }
    }
    if (input.target.projectDigest === undefined && evidenceDigests.size > 1) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message:
          "All evidence must bind to one projectDigest when the target digest is omitted",
      });
    }
    if (
      input.target.backendId === "logisim.evolution" &&
      input.target.vectorDigest === undefined &&
      vectorDigests.size > 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message:
          "All test-vector evidence must bind to one vectorDigest when the target digest is omitted",
      });
    }
  });

const PlanStatusSchema = z.enum([
  "reported-covered",
  "reported-failed",
  "missing-evidence",
  "inconclusive",
  "unsupported",
]);

const CollectionBoundsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    truncated: z.boolean(),
  })
  .strict();

const ClaimStatementInfoSchema = z
  .object({
    characters: z.number().int().nonnegative(),
    sha256: ProjectDigestSchema,
    preview: z.string().max(MAX_CLAIM_STATEMENT_PREVIEW_CHARACTERS),
    previewTruncated: z.boolean(),
    trust: z.literal("untrusted-caller-authored"),
  })
  .strict();

export const VerificationClaimPlanSchema = z
  .object({
    id: IdentifierSchema,
    claimClass: VerificationClaimClassSchema,
    objective: z.enum(["characterize", "verify"]),
    scope: z.enum([
      "artifact",
      "selected-circuit",
      "listed-cases",
      "physical-system",
    ]),
    statement: ClaimStatementInfoSchema.optional(),
    status: PlanStatusSchema,
    matchedEvidenceIds: z
      .array(IdentifierSchema)
      .max(MAX_VERIFICATION_EVIDENCE_ITEMS),
    missingEvidenceKinds: z
      .array(VerificationEvidenceKindSchema)
      .max(VerificationEvidenceKindSchema.options.length),
    boundary: z.literal(
      "Reported evidence is digest-bound caller input, not authenticated proof or certification.",
    ),
  })
  .strict();

const MatrixMinimumCoverageSchema = z.enum([
  "observed",
  "sampled",
  "exhaustive",
  "listed-sequences",
  "complete-no-functional-loss",
]);
const EvidenceBindingLocusSchema = z.enum(["artifact", "topology", "circuit"]);

export const VerificationCoverageMatrixEntrySchema = z
  .object({
    claimId: IdentifierSchema,
    evidenceKind: VerificationEvidenceKindSchema,
    role: z.enum(["required", "supporting"]),
    bindingLocus: EvidenceBindingLocusSchema,
    minimumCoverage: MatrixMinimumCoverageSchema,
    expectedCaseCount: z
      .number()
      .int()
      .positive()
      .max(MAX_LOGISIM_TRUTH_TABLE_ROWS)
      .optional(),
    status: z.enum([
      "missing",
      "reported-observed",
      "reported-pass",
      "reported-fail",
      "inconclusive",
    ]),
    evidenceIds: z.array(IdentifierSchema).max(MAX_VERIFICATION_EVIDENCE_ITEMS),
  })
  .strict();

const VerificationToolNameSchema = z.enum([
  "electronics_capabilities",
  "crumb_validate_design",
  "crumb_analyze_design",
  "crumb_export_netlist",
  "crumb_check_design",
  "logisim_analyze_design",
  "logisim_export_netlist",
  "logisim_component_stats",
  "logisim_truth_table",
  "logisim_run_test_vector",
]);

const VerificationArgumentBindingSchema = z
  .object({
    argument: IdentifierSchema,
    fromStepId: IdentifierSchema,
    outputPath: z.string().min(1).max(256),
  })
  .strict();

const McpVerificationStepSchema = z
  .object({
    id: IdentifierSchema,
    actionType: z.literal("mcp-tool"),
    phase: z.enum(["discovery", "static", "runtime", "simulation"]),
    tool: VerificationToolNameSchema,
    arguments: z.record(z.string(), z.json()),
    argumentBindings: z.array(VerificationArgumentBindingSchema).max(8),
    claimIds: z.array(IdentifierSchema).max(MAX_VERIFICATION_CLAIMS),
    produces: z
      .array(VerificationEvidenceKindSchema)
      .max(VerificationEvidenceKindSchema.options.length),
    dependsOn: z.array(IdentifierSchema).max(MAX_VERIFICATION_STEPS),
    stopOnFailure: z.boolean(),
  })
  .strict();

const ExternalVerificationStepSchema = z
  .object({
    id: IdentifierSchema,
    actionType: z.literal("external"),
    phase: z.literal("external"),
    kind: z.enum([
      "author-expected-specification",
      "author-test-vector",
      "configure-logisim-runtime",
      "measure-physical-hardware",
      "qualified-engineering-review",
    ]),
    reason: z.string().min(1).max(MAX_REASON_CHARACTERS),
    claimIds: z.array(IdentifierSchema).max(MAX_VERIFICATION_CLAIMS),
    dependsOn: z.array(IdentifierSchema).max(MAX_VERIFICATION_STEPS),
  })
  .strict();

export const VerificationStepSchema = z.discriminatedUnion("actionType", [
  McpVerificationStepSchema,
  ExternalVerificationStepSchema,
]);

export const VerificationTestSuggestionSchema = z
  .object({
    id: IdentifierSchema,
    pattern: z.enum([
      "exhaustive-all-combinations",
      "all-zero",
      "all-one",
      "walking-one",
      "walking-zero",
      "control-polarities",
      "carry-boundaries",
      "reset-assert-release",
      "enable-hold-toggle",
      "ordinary-state-transition",
      "wraparound-or-saturation",
      "invalid-control-combination",
    ]),
    claimIds: z.array(IdentifierSchema).max(MAX_VERIFICATION_CLAIMS),
    signalIds: z.array(IdentifierSchema).max(MAX_VERIFICATION_SIGNALS),
    estimatedCases: z
      .number()
      .int()
      .positive()
      .max(MAX_LOGISIM_TRUTH_TABLE_ROWS)
      .optional(),
    expectedOutputsRequired: z.literal(true),
    reason: z.string().min(1).max(MAX_REASON_CHARACTERS),
  })
  .strict();

export const VerificationGapSchema = z
  .object({
    code: IdentifierSchema,
    severity: z.enum(["error", "warning", "info"]),
    claimIds: z.array(IdentifierSchema).max(MAX_VERIFICATION_CLAIMS),
    message: z.string().min(1).max(MAX_REASON_CHARACTERS),
    resolvableByStepIds: z.array(IdentifierSchema).max(MAX_VERIFICATION_STEPS),
  })
  .strict();

const EvidenceBoundarySchema = z
  .object({
    plannerReadsWorkspace: z.literal(false),
    plannerExecutesTools: z.literal(false),
    plannerLaunchesSimulator: z.literal(false),
    callerEvidenceAuthenticated: z.literal(false),
    truthTableIsExpectedOracle: z.literal(false),
    reportedCoverageIsCertification: z.literal(false),
    physicalApprovalProvided: z.literal(false),
  })
  .strict();

export const VerificationPlanDataSchema = z
  .object({
    planVersion: z.literal("electronics.verification-plan/0.1"),
    requestDigest: ProjectDigestSchema,
    planDigest: ProjectDigestSchema,
    target: VerificationTargetSchema,
    overallStatus: PlanStatusSchema,
    claims: z.array(VerificationClaimPlanSchema).max(MAX_VERIFICATION_CLAIMS),
    coverageMatrix: z
      .array(VerificationCoverageMatrixEntrySchema)
      .max(MAX_VERIFICATION_MATRIX_ENTRIES),
    steps: z.array(VerificationStepSchema).max(MAX_VERIFICATION_STEPS),
    testSuggestions: z
      .array(VerificationTestSuggestionSchema)
      .max(MAX_VERIFICATION_TEST_SUGGESTIONS),
    gaps: z.array(VerificationGapSchema).max(MAX_VERIFICATION_GAPS),
    collectionBounds: z
      .object({
        claims: CollectionBoundsSchema,
        evidence: CollectionBoundsSchema,
        coverageMatrix: CollectionBoundsSchema,
        steps: CollectionBoundsSchema,
        testSuggestions: CollectionBoundsSchema,
        gaps: CollectionBoundsSchema,
      })
      .strict(),
    evidenceBoundary: EvidenceBoundarySchema,
  })
  .strict();

export type VerificationPlanInput = z.infer<typeof VerificationPlanInputSchema>;
export type VerificationPlanData = z.infer<typeof VerificationPlanDataSchema>;
type VerificationClaim = z.infer<typeof VerificationClaimSchema>;
type VerificationEvidence = z.infer<typeof VerificationEvidenceSchema>;
type VerificationEvidenceKind = z.infer<typeof VerificationEvidenceKindSchema>;
type VerificationCoverageMatrixEntry = z.infer<
  typeof VerificationCoverageMatrixEntrySchema
>;
type VerificationStep = z.infer<typeof VerificationStepSchema>;
type VerificationGap = z.infer<typeof VerificationGapSchema>;
type VerificationTestSuggestion = z.infer<
  typeof VerificationTestSuggestionSchema
>;
type PlanStatus = z.infer<typeof PlanStatusSchema>;
type MatrixMinimumCoverage = z.infer<typeof MatrixMinimumCoverageSchema>;
type JsonValue = z.infer<ReturnType<typeof z.json>>;

interface EvidenceRequirement {
  kind: VerificationEvidenceKind;
  role: "required" | "supporting";
  bindingLocus: z.infer<typeof EvidenceBindingLocusSchema>;
  minimumCoverage: MatrixMinimumCoverage;
}

interface ClaimAssessment {
  claim: VerificationClaim;
  status: PlanStatus;
  requirements: EvidenceRequirement[];
  matrix: VerificationCoverageMatrixEntry[];
  matchedEvidenceIds: string[];
  missingEvidenceKinds: VerificationEvidenceKind[];
}

function addDuplicateIssues(
  values: readonly string[],
  path: PropertyKey[],
  noun: string,
  context: z.core.$RefinementCtx<unknown>,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Duplicate ${noun} identifier: ${value}`,
      });
    }
    seen.add(value);
  }
}

function sourceSupportsEvidenceKind(
  source: z.infer<typeof VerificationEvidenceSourceSchema>,
  kind: VerificationEvidenceKind,
): boolean {
  const allowed: Record<
    z.infer<typeof VerificationEvidenceSourceSchema>,
    readonly VerificationEvidenceKind[]
  > = {
    crumb_validate_design: ["static-analysis"],
    crumb_analyze_design: ["static-analysis", "conversion-report"],
    crumb_export_netlist: ["static-netlist"],
    crumb_check_design: ["static-erc"],
    logisim_analyze_design: ["static-analysis", "conversion-report"],
    logisim_export_netlist: ["static-netlist"],
    logisim_component_stats: ["simulator-project-load"],
    logisim_truth_table: ["truth-table"],
    logisim_run_test_vector: ["test-vector"],
    external: [
      "expected-specification",
      "physical-measurement",
      "qualified-review",
    ],
  };
  return allowed[source].includes(kind);
}

function sourceSupportsEvidenceBinding(
  evidence: VerificationEvidence,
): boolean {
  const binding = evidence.binding;
  switch (evidence.source) {
    case "crumb_validate_design":
    case "crumb_analyze_design":
      return binding.backendId === "crumb.file" && binding.locus === "artifact";
    case "crumb_export_netlist":
    case "crumb_check_design":
      return binding.backendId === "crumb.file" && binding.locus === "topology";
    case "logisim_analyze_design":
      return (
        binding.backendId === "logisim.evolution" &&
        binding.locus === "artifact"
      );
    case "logisim_export_netlist":
    case "logisim_component_stats":
    case "logisim_truth_table":
    case "logisim_run_test_vector":
      return (
        binding.backendId === "logisim.evolution" && binding.locus === "circuit"
      );
    case "external":
      if (evidence.kind === "expected-specification") {
        return (
          binding.backendId === "logisim.evolution" &&
          binding.locus === "circuit"
        );
      }
      return binding.locus === "artifact";
  }
}

function normalizedInput(input: VerificationPlanInput): VerificationPlanInput {
  const claims = [...input.claims].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
  const evidence = [...input.evidence]
    .map((item) => ({
      ...item,
      claimIds: [...item.claimIds].sort(compareCodeUnits),
      facts: {
        ...item.facts,
        conversionLossImpacts: [...item.facts.conversionLossImpacts].sort(
          compareCodeUnits,
        ),
        ruleSet: [...item.facts.ruleSet].sort(compareCodeUnits),
      },
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const declaredInterface =
    input.declaredInterface === undefined
      ? undefined
      : {
          ...input.declaredInterface,
          signals: [...input.declaredInterface.signals].sort((left, right) =>
            compareCodeUnits(left.id, right.id),
          ),
        };
  return {
    target: input.target,
    claims,
    ...(declaredInterface === undefined ? {} : { declaredInterface }),
    evidence,
  };
}

function requirementsFor(
  target: VerificationPlanInput["target"],
  claim: VerificationClaim,
): EvidenceRequirement[] {
  switch (claim.claimClass) {
    case "artifact-structure":
      return [
        {
          kind: "static-analysis",
          role: "required",
          bindingLocus: "artifact",
          minimumCoverage: "observed",
        },
      ];
    case "topology-connectivity":
      return [
        {
          kind: "static-analysis",
          role: "required",
          bindingLocus: "artifact",
          minimumCoverage: "observed",
        },
        {
          kind: "static-netlist",
          role: "required",
          bindingLocus:
            target.backendId === "crumb.file" ? "topology" : "circuit",
          minimumCoverage: "observed",
        },
      ];
    case "static-electrical-rules":
      return target.backendId === "crumb.file"
        ? [
            {
              kind: "static-erc",
              role: "required",
              bindingLocus: "topology",
              minimumCoverage: "observed",
            },
          ]
        : [];
    case "simulator-load":
      return target.backendId === "logisim.evolution"
        ? [
            {
              kind: "simulator-project-load",
              role: "required",
              bindingLocus: "circuit",
              minimumCoverage: "observed",
            },
          ]
        : [];
    case "combinational-behavior":
      if (target.backendId !== "logisim.evolution") {
        return [];
      }
      return claim.objective === "characterize"
        ? [
            {
              kind: "truth-table",
              role: "required",
              bindingLocus: "circuit",
              minimumCoverage:
                claim.scope === "listed-cases" ? "sampled" : "exhaustive",
            },
            {
              kind: "static-analysis",
              role: "supporting",
              bindingLocus: "artifact",
              minimumCoverage: "observed",
            },
            {
              kind: "simulator-project-load",
              role: "supporting",
              bindingLocus: "circuit",
              minimumCoverage: "observed",
            },
          ]
        : [
            {
              kind: "test-vector",
              role: "required",
              bindingLocus: "circuit",
              minimumCoverage:
                claim.scope === "listed-cases"
                  ? "listed-sequences"
                  : "exhaustive",
            },
            {
              kind: "expected-specification",
              role: "supporting",
              bindingLocus: "circuit",
              minimumCoverage: "observed",
            },
            {
              kind: "static-analysis",
              role: "supporting",
              bindingLocus: "artifact",
              minimumCoverage: "observed",
            },
            {
              kind: "simulator-project-load",
              role: "supporting",
              bindingLocus: "circuit",
              minimumCoverage: "observed",
            },
          ];
    case "sequential-behavior":
      return target.backendId === "logisim.evolution"
        ? [
            {
              kind: "test-vector",
              role: "required",
              bindingLocus: "circuit",
              minimumCoverage: "listed-sequences",
            },
            {
              kind: "expected-specification",
              role: "supporting",
              bindingLocus: "circuit",
              minimumCoverage: "observed",
            },
            {
              kind: "static-analysis",
              role: "supporting",
              bindingLocus: "artifact",
              minimumCoverage: "observed",
            },
            {
              kind: "simulator-project-load",
              role: "supporting",
              bindingLocus: "circuit",
              minimumCoverage: "observed",
            },
          ]
        : [];
    case "conversion-readiness":
      return [
        {
          kind: "conversion-report",
          role: "required",
          bindingLocus: "artifact",
          minimumCoverage: "complete-no-functional-loss",
        },
      ];
    case "physical-hardware":
      return [
        {
          kind: "physical-measurement",
          role: "required",
          bindingLocus: "artifact",
          minimumCoverage: "sampled",
        },
        {
          kind: "qualified-review",
          role: "required",
          bindingLocus: "artifact",
          minimumCoverage: "observed",
        },
      ];
  }
}

function isUnsupported(
  target: VerificationPlanInput["target"],
  claim: VerificationClaim,
): boolean {
  if (
    target.backendId === "crumb.file" &&
    [
      "simulator-load",
      "combinational-behavior",
      "sequential-behavior",
    ].includes(claim.claimClass)
  ) {
    return true;
  }
  return (
    target.backendId === "logisim.evolution" &&
    claim.claimClass === "static-electrical-rules"
  );
}

function meetsCoverage(
  evidence: VerificationEvidence,
  minimumCoverage: MatrixMinimumCoverage,
  expectedCaseCount: number | undefined,
): boolean {
  switch (minimumCoverage) {
    case "observed":
      return evidence.outcome !== "inconclusive";
    case "sampled":
      return (
        ["sampled", "partitioned", "exhaustive", "listed-sequences"].includes(
          evidence.coverage.mode,
        ) &&
        (evidence.coverage.casesExecuted ?? 0) > 0 &&
        !evidence.coverage.truncated
      );
    case "exhaustive":
      return (
        expectedCaseCount !== undefined &&
        evidence.coverage.mode === "exhaustive" &&
        evidence.coverage.casesPlanned === expectedCaseCount &&
        evidence.coverage.casesExecuted === expectedCaseCount &&
        (evidence.kind !== "test-vector" ||
          evidence.facts.distinctInputAssignments === expectedCaseCount) &&
        !evidence.coverage.truncated
      );
    case "listed-sequences":
      return (
        ["listed-sequences", "exhaustive"].includes(evidence.coverage.mode) &&
        (evidence.coverage.casesPlanned ?? 0) > 0 &&
        evidence.coverage.casesPlanned === evidence.coverage.casesExecuted &&
        (evidence.coverage.casesExecuted ?? 0) > 0 &&
        !evidence.coverage.truncated
      );
    case "complete-no-functional-loss":
      return (
        evidence.facts.conversionCompleteness === "complete" &&
        evidence.facts.conversionLossImpacts.every(
          (impact) => impact === "metadata",
        )
      );
  }
}

function matrixStatus(
  evidence: readonly VerificationEvidence[],
  minimumCoverage: MatrixMinimumCoverage,
  expectedCaseCount: number | undefined,
): VerificationCoverageMatrixEntry["status"] {
  if (evidence.length === 0) {
    return "missing";
  }
  if (evidence.some((item) => item.outcome === "fail")) {
    return "reported-fail";
  }
  const adequate = evidence.filter((item) =>
    meetsCoverage(item, minimumCoverage, expectedCaseCount),
  );
  if (
    adequate.length === 0 ||
    adequate.some((item) => item.outcome === "inconclusive")
  ) {
    return "inconclusive";
  }
  return adequate.some((item) => item.outcome === "pass")
    ? "reported-pass"
    : "reported-observed";
}

function assessClaim(
  target: VerificationPlanInput["target"],
  claim: VerificationClaim,
  declaredInterface: VerificationPlanInput["declaredInterface"],
  evidence: readonly VerificationEvidence[],
): ClaimAssessment {
  const requirements = requirementsFor(target, claim);
  if (isUnsupported(target, claim)) {
    return {
      claim,
      status: "unsupported",
      requirements,
      matrix: [],
      matchedEvidenceIds: [],
      missingEvidenceKinds: [],
    };
  }

  const matrix = requirements.map((requirement) => {
    const expectedCaseCount =
      requirement.minimumCoverage === "exhaustive"
        ? exhaustiveCaseCount(declaredInterface)
        : undefined;
    const matching = evidence.filter(
      (item) =>
        item.kind === requirement.kind &&
        item.claimIds.includes(claim.id) &&
        item.binding.locus === requirement.bindingLocus,
    );
    return {
      claimId: claim.id,
      evidenceKind: requirement.kind,
      role: requirement.role,
      bindingLocus: requirement.bindingLocus,
      minimumCoverage: requirement.minimumCoverage,
      ...(expectedCaseCount === undefined ? {} : { expectedCaseCount }),
      status: matrixStatus(
        matching,
        requirement.minimumCoverage,
        expectedCaseCount,
      ),
      evidenceIds: matching.map((item) => item.id).sort(),
    };
  });
  const required = matrix.filter((entry) => entry.role === "required");
  const matchingEvidence = evidence
    .filter((item) => item.claimIds.includes(claim.id))
    .map((item) => item.id)
    .sort();
  const missingEvidenceKinds = required
    .filter((entry) => entry.status === "missing")
    .map((entry) => entry.evidenceKind);
  const hasReportedFailure = matrix.some(
    (entry) => entry.status === "reported-fail",
  );
  const hasUnsafeRuntimeEvidence =
    target.backendId === "logisim.evolution" &&
    [
      "simulator-load",
      "combinational-behavior",
      "sequential-behavior",
    ].includes(claim.claimClass) &&
    runtimeUnsafe(evidence);

  let status: PlanStatus;
  if (hasReportedFailure || hasUnsafeRuntimeEvidence) {
    status = "reported-failed";
  } else if (required.some((entry) => entry.status === "missing")) {
    status = "missing-evidence";
  } else if (
    required.some((entry) => entry.status === "inconclusive") ||
    (claim.claimClass === "topology-connectivity" &&
      target.backendId === "logisim.evolution") ||
    (claim.claimClass === "sequential-behavior" &&
      claim.scope !== "listed-cases") ||
    claim.claimClass === "physical-hardware"
  ) {
    status = "inconclusive";
  } else {
    status = "reported-covered";
  }

  return {
    claim,
    status,
    requirements,
    matrix,
    matchedEvidenceIds: matchingEvidence,
    missingEvidenceKinds,
  };
}

function projectArguments(
  target: VerificationPlanInput["target"],
  evidence: readonly VerificationEvidence[],
): Record<string, JsonValue> {
  const effectiveDigest = target.projectDigest ?? evidence[0]?.projectDigest;
  return {
    path: target.projectRef,
    ...(effectiveDigest === undefined
      ? {}
      : { expectedProjectDigest: effectiveDigest }),
  };
}

function digestBinding(
  target: VerificationPlanInput["target"],
  evidence: readonly VerificationEvidence[],
  fromStepId: string,
): z.infer<typeof VerificationArgumentBindingSchema>[] {
  return target.projectDigest === undefined && evidence.length === 0
    ? [
        {
          argument: "expectedProjectDigest",
          fromStepId,
          outputPath: "context.projectDigest",
        },
      ]
    : [];
}

function effectiveVectorDigest(
  target: z.infer<typeof LogisimVerificationTargetSchema>,
  evidence: readonly VerificationEvidence[],
): string | undefined {
  return (
    target.vectorDigest ??
    evidence.find((item) => item.kind === "test-vector")?.vectorDigest
  );
}

function unresolvedClaimIds(
  assessments: readonly ClaimAssessment[],
  classes: readonly z.infer<typeof VerificationClaimClassSchema>[],
): string[] {
  return assessments
    .filter(
      (assessment) =>
        classes.includes(assessment.claim.claimClass) &&
        !["reported-covered", "unsupported"].includes(assessment.status),
    )
    .map((assessment) => assessment.claim.id)
    .sort();
}

function buildCrumbSteps(
  target: z.infer<typeof CrumbVerificationTargetSchema>,
  assessments: readonly ClaimAssessment[],
  evidence: readonly VerificationEvidence[],
): VerificationStep[] {
  const claimIds = unresolvedClaimIds(assessments, [
    "artifact-structure",
    "topology-connectivity",
    "static-electrical-rules",
    "conversion-readiness",
  ]);
  if (claimIds.length === 0) {
    return [];
  }
  const project = projectArguments(target, evidence);
  const binding = digestBinding(target, evidence, "crumb-validate");
  const steps: VerificationStep[] = [
    {
      id: "crumb-validate",
      actionType: "mcp-tool",
      phase: "static",
      tool: "crumb_validate_design",
      arguments: project,
      argumentBindings: [],
      claimIds,
      produces: ["static-analysis"],
      dependsOn: [],
      stopOnFailure: true,
    },
  ];
  const analysisClaimIds = unresolvedClaimIds(assessments, [
    "artifact-structure",
    "topology-connectivity",
    "conversion-readiness",
  ]);
  if (analysisClaimIds.length > 0) {
    steps.push({
      id: "crumb-analyze",
      actionType: "mcp-tool",
      phase: "static",
      tool: "crumb_analyze_design",
      arguments: { ...project, view: "summary" },
      argumentBindings: binding,
      claimIds: analysisClaimIds,
      produces: ["static-analysis", "conversion-report"],
      dependsOn: ["crumb-validate"],
      stopOnFailure: true,
    });
  }
  const topologyClaimIds = unresolvedClaimIds(assessments, [
    "topology-connectivity",
  ]);
  if (topologyClaimIds.length > 0) {
    steps.push({
      id: "crumb-netlist",
      actionType: "mcp-tool",
      phase: "static",
      tool: "crumb_export_netlist",
      arguments: {
        ...project,
        topologyMode: target.topologyMode,
        applySwitchStates: target.applySwitchStates,
      },
      argumentBindings: binding,
      claimIds: topologyClaimIds,
      produces: ["static-netlist"],
      dependsOn: [
        analysisClaimIds.length > 0 ? "crumb-analyze" : "crumb-validate",
      ],
      stopOnFailure: true,
    });
  }
  const ercClaimIds = unresolvedClaimIds(assessments, [
    "static-electrical-rules",
  ]);
  if (ercClaimIds.length > 0) {
    steps.push({
      id: "crumb-erc",
      actionType: "mcp-tool",
      phase: "static",
      tool: "crumb_check_design",
      arguments: {
        ...project,
        topologyMode: target.topologyMode,
        applySwitchStates: target.applySwitchStates,
      },
      argumentBindings: binding,
      claimIds: ercClaimIds,
      produces: ["static-erc"],
      dependsOn: [
        topologyClaimIds.length > 0
          ? "crumb-netlist"
          : analysisClaimIds.length > 0
            ? "crumb-analyze"
            : "crumb-validate",
      ],
      stopOnFailure: false,
    });
  }
  return steps;
}

function runtimeUnsafe(evidence: readonly VerificationEvidence[]): boolean {
  return evidence.some(
    (item) =>
      item.kind === "static-analysis" && item.facts.runtimeSafe === false,
  );
}

function buildLogisimSteps(
  target: z.infer<typeof LogisimVerificationTargetSchema>,
  assessments: readonly ClaimAssessment[],
  declaredInterface: VerificationPlanInput["declaredInterface"],
  evidence: readonly VerificationEvidence[],
): VerificationStep[] {
  const steps: VerificationStep[] = [];
  const staticClaimIds = unresolvedClaimIds(assessments, [
    "artifact-structure",
    "topology-connectivity",
    "simulator-load",
    "combinational-behavior",
    "sequential-behavior",
    "conversion-readiness",
  ]);
  if (staticClaimIds.length === 0) {
    return steps;
  }
  const project = projectArguments(target, evidence);
  steps.push({
    id: "logisim-analyze",
    actionType: "mcp-tool",
    phase: "static",
    tool: "logisim_analyze_design",
    arguments: project,
    argumentBindings: [],
    claimIds: staticClaimIds,
    produces: ["static-analysis", "conversion-report"],
    dependsOn: [],
    stopOnFailure: true,
  });
  const binding = digestBinding(target, evidence, "logisim-analyze");

  if (target.circuit === undefined) {
    return steps;
  }

  const topologyClaims = unresolvedClaimIds(assessments, [
    "topology-connectivity",
  ]);
  if (topologyClaims.length > 0) {
    steps.push({
      id: "logisim-netlist",
      actionType: "mcp-tool",
      phase: "static",
      tool: "logisim_export_netlist",
      arguments: {
        ...project,
        ...(target.circuit === undefined ? {} : { circuit: target.circuit }),
      },
      argumentBindings: binding,
      claimIds: topologyClaims,
      produces: ["static-netlist"],
      dependsOn: ["logisim-analyze"],
      stopOnFailure: false,
    });
  }

  const runtimeClaimIds = unresolvedClaimIds(assessments, [
    "simulator-load",
    "combinational-behavior",
    "sequential-behavior",
  ]);
  if (runtimeClaimIds.length === 0 || runtimeUnsafe(evidence)) {
    return steps;
  }

  const runtimeDependency = "logisim-analyze";
  if (target.runtimeStatus === "unknown") {
    steps.push({
      id: "runtime-capabilities",
      actionType: "mcp-tool",
      phase: "discovery",
      tool: "electronics_capabilities",
      arguments: {},
      argumentBindings: [],
      claimIds: runtimeClaimIds,
      produces: [],
      dependsOn: [],
      stopOnFailure: true,
    });
    return steps;
  } else if (target.runtimeStatus !== "available") {
    steps.push({
      id: "configure-logisim-runtime",
      actionType: "external",
      phase: "external",
      kind: "configure-logisim-runtime",
      reason:
        "Configure the version-pinned Logisim-evolution 4.1.0 JAR before requesting runtime evidence.",
      claimIds: runtimeClaimIds,
      dependsOn: ["logisim-analyze"],
    });
    return steps;
  }

  steps.push({
    id: "logisim-project-load",
    actionType: "mcp-tool",
    phase: "runtime",
    tool: "logisim_component_stats",
    arguments: {
      ...project,
      ...(target.circuit === undefined ? {} : { circuit: target.circuit }),
    },
    argumentBindings: binding,
    claimIds: runtimeClaimIds,
    produces: ["simulator-project-load"],
    dependsOn: [runtimeDependency],
    stopOnFailure: true,
  });

  const combinationalClaimIds = unresolvedClaimIds(assessments, [
    "combinational-behavior",
  ]);
  const expectedCombinationalCases = exhaustiveCaseCount(declaredInterface);
  if (
    combinationalClaimIds.length > 0 &&
    expectedCombinationalCases !== undefined
  ) {
    steps.push({
      id: "logisim-truth-table",
      actionType: "mcp-tool",
      phase: "simulation",
      tool: "logisim_truth_table",
      arguments: {
        ...project,
        ...(target.circuit === undefined ? {} : { circuit: target.circuit }),
      },
      argumentBindings: binding,
      claimIds: combinationalClaimIds,
      produces: ["truth-table"],
      dependsOn: ["logisim-project-load"],
      stopOnFailure: false,
    });
  }

  const behavioralClaimIds = assessments
    .filter(
      (assessment) =>
        !["reported-covered", "unsupported"].includes(assessment.status) &&
        assessment.requirements.some(
          (requirement) =>
            requirement.role === "required" &&
            requirement.kind === "test-vector",
        ),
    )
    .map((assessment) => assessment.claim.id)
    .sort();
  if (behavioralClaimIds.length > 0) {
    if (target.vectorRef === undefined) {
      steps.push({
        id: "author-test-vector",
        actionType: "external",
        phase: "external",
        kind: "author-test-vector",
        reason:
          "Author a bounded vector file with explicit expected outputs; a generated truth table is not an expected oracle.",
        claimIds: behavioralClaimIds,
        dependsOn: ["logisim-analyze"],
      });
    } else {
      const vectorDigest = effectiveVectorDigest(target, evidence);
      steps.push({
        id: "logisim-test-vector",
        actionType: "mcp-tool",
        phase: "simulation",
        tool: "logisim_run_test_vector",
        arguments: {
          ...project,
          vectorPath: target.vectorRef,
          ...(vectorDigest === undefined
            ? {}
            : { expectedVectorDigest: vectorDigest }),
          ...(target.circuit === undefined ? {} : { circuit: target.circuit }),
        },
        argumentBindings: binding,
        claimIds: behavioralClaimIds,
        produces: ["test-vector"],
        dependsOn: ["logisim-project-load"],
        stopOnFailure: false,
      });
    }
  }
  return steps;
}

function countInputBits(
  declaredInterface: VerificationPlanInput["declaredInterface"],
): number {
  return (
    declaredInterface?.signals
      .filter((signal) => signal.direction === "input")
      .reduce((sum, signal) => sum + signal.width, 0) ?? 0
  );
}

function exhaustiveCaseCount(
  declaredInterface: VerificationPlanInput["declaredInterface"],
): number | undefined {
  if (
    declaredInterface?.designIntent !== "combinational" ||
    declaredInterface.signals.some((signal) => signal.direction === "inout") ||
    !declaredInterface.signals.some((signal) => signal.direction === "output")
  ) {
    return undefined;
  }
  const inputBits = countInputBits(declaredInterface);
  return inputBits <= MAX_LOGISIM_TRUTH_TABLE_INPUT_BITS
    ? 2 ** inputBits
    : undefined;
}

function makeSuggestion(
  id: string,
  pattern: VerificationTestSuggestion["pattern"],
  claimIds: string[],
  signalIds: string[],
  reason: string,
  estimatedCases?: number,
): VerificationTestSuggestion {
  return {
    id,
    pattern,
    claimIds,
    signalIds,
    ...(estimatedCases === undefined ? {} : { estimatedCases }),
    expectedOutputsRequired: true,
    reason,
  };
}

function buildTestSuggestions(
  assessments: readonly ClaimAssessment[],
  declaredInterface: VerificationPlanInput["declaredInterface"],
): VerificationTestSuggestion[] {
  const suggestions: VerificationTestSuggestion[] = [];
  const signals = declaredInterface?.signals ?? [];
  const inputSignals = signals
    .filter((signal) => signal.direction === "input")
    .map((signal) => signal.id);
  const inputBits = countInputBits(declaredInterface);
  const combinationalClaimIds = assessments
    .filter(
      (assessment) => assessment.claim.claimClass === "combinational-behavior",
    )
    .map((assessment) => assessment.claim.id);
  if (
    combinationalClaimIds.length > 0 &&
    declaredInterface?.designIntent === "combinational" &&
    declaredInterface.signals.some((signal) => signal.direction === "output") &&
    !declaredInterface.signals.some((signal) => signal.direction === "inout")
  ) {
    if (inputBits <= MAX_LOGISIM_TRUTH_TABLE_INPUT_BITS) {
      suggestions.push(
        makeSuggestion(
          "test-exhaustive-combinations",
          "exhaustive-all-combinations",
          combinationalClaimIds,
          inputSignals,
          "Exercise every declared input combination and compare each output with an independently authored expectation.",
          2 ** inputBits,
        ),
      );
    } else {
      suggestions.push(
        makeSuggestion(
          "test-all-zero",
          "all-zero",
          combinationalClaimIds,
          inputSignals,
          "Check the all-zero boundary with explicit expected outputs.",
          1,
        ),
        makeSuggestion(
          "test-all-one",
          "all-one",
          combinationalClaimIds,
          inputSignals,
          "Check the all-one boundary with explicit expected outputs.",
          1,
        ),
        makeSuggestion(
          "test-walking-one",
          "walking-one",
          combinationalClaimIds,
          inputSignals,
          "Partition the oversized input space with a walking-one pattern.",
        ),
        makeSuggestion(
          "test-walking-zero",
          "walking-zero",
          combinationalClaimIds,
          inputSignals,
          "Partition the oversized input space with a walking-zero pattern.",
        ),
      );
    }
    const controlSignals = signals
      .filter((signal) => ["enable", "select", "reset"].includes(signal.role))
      .map((signal) => signal.id);
    if (controlSignals.length > 0) {
      suggestions.push(
        makeSuggestion(
          "test-control-polarities",
          "control-polarities",
          combinationalClaimIds,
          controlSignals,
          "Exercise both asserted and deasserted states of every declared control.",
        ),
      );
    }
    const carrySignals = signals
      .filter((signal) => signal.role === "carry")
      .map((signal) => signal.id);
    if (carrySignals.length > 0) {
      suggestions.push(
        makeSuggestion(
          "test-carry-boundaries",
          "carry-boundaries",
          combinationalClaimIds,
          carrySignals,
          "Exercise carry generation and propagation boundaries.",
        ),
      );
    }
  }

  const sequentialClaimIds = assessments
    .filter(
      (assessment) => assessment.claim.claimClass === "sequential-behavior",
    )
    .map((assessment) => assessment.claim.id);
  if (sequentialClaimIds.length > 0) {
    const resetSignals = signals
      .filter((signal) => signal.role === "reset")
      .map((signal) => signal.id);
    if (resetSignals.length > 0) {
      suggestions.push(
        makeSuggestion(
          "test-reset-sequence",
          "reset-assert-release",
          sequentialClaimIds,
          resetSignals,
          "Assert and release reset explicitly before checking stateful behavior.",
        ),
      );
    }
    const enableSignals = signals
      .filter((signal) => signal.role === "enable")
      .map((signal) => signal.id);
    if (enableSignals.length > 0) {
      suggestions.push(
        makeSuggestion(
          "test-enable-sequence",
          "enable-hold-toggle",
          sequentialClaimIds,
          enableSignals,
          "Check hold and transition behavior with enables both asserted and deasserted.",
        ),
      );
    }
    suggestions.push(
      makeSuggestion(
        "test-ordinary-transition",
        "ordinary-state-transition",
        sequentialClaimIds,
        inputSignals,
        "Establish a known state and exercise ordinary documented transitions.",
      ),
      makeSuggestion(
        "test-state-boundary",
        "wraparound-or-saturation",
        sequentialClaimIds,
        inputSignals,
        "Exercise the declared wraparound, saturation, or terminal-state boundary.",
      ),
      makeSuggestion(
        "test-invalid-controls",
        "invalid-control-combination",
        sequentialClaimIds,
        inputSignals,
        "Exercise simultaneous or invalid controls only where expected behavior is explicit.",
      ),
    );
  }
  return suggestions.slice(0, MAX_VERIFICATION_TEST_SUGGESTIONS);
}

function stepIdsProducing(
  steps: readonly VerificationStep[],
  evidenceKind: VerificationEvidenceKind,
): string[] {
  return steps
    .filter(
      (step) =>
        step.actionType === "mcp-tool" && step.produces.includes(evidenceKind),
    )
    .map((step) => step.id);
}

function buildGaps(
  target: VerificationPlanInput["target"],
  assessments: readonly ClaimAssessment[],
  steps: readonly VerificationStep[],
  declaredInterface: VerificationPlanInput["declaredInterface"],
  evidence: readonly VerificationEvidence[],
): VerificationGap[] {
  const gaps: VerificationGap[] = [];
  for (const assessment of assessments) {
    if (assessment.status === "unsupported") {
      gaps.push({
        code: "backend-claim-unsupported",
        severity: "warning",
        claimIds: [assessment.claim.id],
        message:
          `${target.backendId} does not provide evidence for ` +
          `${assessment.claim.claimClass}; use another backend or external evidence.`,
        resolvableByStepIds: [],
      });
    }
    for (const evidenceKind of assessment.missingEvidenceKinds) {
      gaps.push({
        code: `missing-${evidenceKind}`,
        severity: "warning",
        claimIds: [assessment.claim.id],
        message: `Claim ${assessment.claim.id} is missing required ${evidenceKind} evidence.`,
        resolvableByStepIds: stepIdsProducing(steps, evidenceKind),
      });
    }
    for (const entry of assessment.matrix.filter(
      (candidate) =>
        candidate.role === "required" && candidate.status === "inconclusive",
    )) {
      const matchingEvidence = evidence.filter(
        (item) =>
          item.kind === entry.evidenceKind &&
          item.claimIds.includes(assessment.claim.id) &&
          item.binding.locus === entry.bindingLocus,
      );
      let code = `insufficient-${entry.evidenceKind}-coverage`;
      let message =
        `Reported ${entry.evidenceKind} evidence for claim ` +
        `${assessment.claim.id} does not meet ${entry.minimumCoverage} coverage.`;
      if (
        entry.minimumCoverage === "exhaustive" &&
        entry.expectedCaseCount === undefined
      ) {
        code = "exhaustive-interface-unbound";
        message =
          "Exhaustive coverage requires a declared combinational interface with resolved input/output directions and no inout stimulus.";
      } else if (
        entry.minimumCoverage === "exhaustive" &&
        entry.evidenceKind === "test-vector" &&
        matchingEvidence.some(
          (item) =>
            item.coverage.casesPlanned === entry.expectedCaseCount &&
            item.coverage.casesExecuted === entry.expectedCaseCount &&
            item.facts.distinctInputAssignments !== entry.expectedCaseCount,
        )
      ) {
        code = "exhaustive-distinctness-unproven";
        message =
          `Exhaustive vector evidence must report ${entry.expectedCaseCount} ` +
          "distinct input assignments; row count alone can include duplicates.";
      } else if (entry.minimumCoverage === "exhaustive") {
        code = "exhaustive-case-count-mismatch";
        message =
          `Exhaustive evidence must report exactly ${entry.expectedCaseCount} ` +
          "planned and executed cases for the declared input space.";
      } else if (entry.minimumCoverage === "listed-sequences") {
        code = "listed-sequence-count-mismatch";
        message =
          "Listed-sequence evidence requires positive, equal planned and executed case counts with no truncation.";
      }
      gaps.push({
        code,
        severity: "warning",
        claimIds: [assessment.claim.id],
        message,
        resolvableByStepIds: stepIdsProducing(steps, entry.evidenceKind),
      });
    }
    if (
      assessment.claim.claimClass === "topology-connectivity" &&
      target.backendId === "logisim.evolution" &&
      assessment.status !== "missing-evidence"
    ) {
      gaps.push({
        code: "partial-logisim-netlist",
        severity: "warning",
        claimIds: [assessment.claim.id],
        message:
          "The Logisim coordinate-endpoint netlist is partial, so it cannot establish complete connectivity.",
        resolvableByStepIds: [],
      });
    }
    if (
      assessment.claim.claimClass === "sequential-behavior" &&
      assessment.status === "inconclusive" &&
      assessment.claim.scope !== "listed-cases"
    ) {
      gaps.push({
        code: "finite-sequence-boundary",
        severity: "warning",
        claimIds: [assessment.claim.id],
        message:
          "Passing finite vectors reports only the listed sequences and cannot establish universal sequential behavior.",
        resolvableByStepIds: [],
      });
    }
    if (assessment.claim.claimClass === "physical-hardware") {
      gaps.push({
        code: "physical-certification-excluded",
        severity: "warning",
        claimIds: [assessment.claim.id],
        message:
          "This planner cannot approve physical hardware; use measurements, manufacturer data, and qualified review.",
        resolvableByStepIds: steps
          .filter(
            (step) =>
              step.actionType === "external" &&
              step.claimIds.includes(assessment.claim.id),
          )
          .map((step) => step.id),
      });
    }
  }

  const combinationalClaims = assessments
    .filter(
      (assessment) =>
        assessment.claim.claimClass === "combinational-behavior" &&
        target.backendId === "logisim.evolution",
    )
    .map((assessment) => assessment.claim.id);
  if (combinationalClaims.length > 0) {
    const inputBits = countInputBits(declaredInterface);
    if (
      declaredInterface?.designIntent !== "combinational" ||
      !declaredInterface.signals.some((signal) => signal.direction === "output")
    ) {
      gaps.push({
        code: "combinational-interface-undeclared",
        severity: "warning",
        claimIds: combinationalClaims,
        message:
          "Behavioral planning requires a declared combinational interface with at least one output; zero-input constant circuits may still use one explicit vector case.",
        resolvableByStepIds: [],
      });
    } else if (
      declaredInterface.signals.some((signal) => signal.direction === "inout")
    ) {
      gaps.push({
        code: "exhaustive-interface-unbound",
        severity: "warning",
        claimIds: combinationalClaims,
        message:
          "Resolve every inout signal to a concrete stimulus or observation direction before claiming exhaustive coverage.",
        resolvableByStepIds: [],
      });
    } else if (inputBits > MAX_LOGISIM_TRUTH_TABLE_INPUT_BITS) {
      gaps.push({
        code: "truth-table-input-bound",
        severity: "warning",
        claimIds: combinationalClaims,
        message:
          `The declared ${inputBits}-bit input space exceeds the ` +
          `${MAX_LOGISIM_TRUTH_TABLE_INPUT_BITS}-bit exhaustive truth-table bound; use explicit partitions.`,
        resolvableByStepIds: [],
      });
    }
    if (
      evidence.some(
        (item) =>
          item.kind === "truth-table" &&
          item.claimIds.some((claimId) =>
            combinationalClaims.includes(claimId),
          ),
      )
    ) {
      gaps.push({
        code: "truth-table-not-oracle",
        severity: "info",
        claimIds: combinationalClaims,
        message:
          "A truth table reports this design's outputs; it is not an independent expected-output oracle.",
        resolvableByStepIds: [],
      });
    }
  }

  if (
    target.backendId === "logisim.evolution" &&
    target.circuit === undefined
  ) {
    const circuitClaimIds = assessments
      .filter(
        (assessment) =>
          [
            "topology-connectivity",
            "simulator-load",
            "combinational-behavior",
            "sequential-behavior",
          ].includes(assessment.claim.claimClass) &&
          assessment.status !== "unsupported",
      )
      .map((assessment) => assessment.claim.id)
      .sort();
    if (circuitClaimIds.length > 0) {
      gaps.push({
        code: "circuit-target-unresolved",
        severity: "warning",
        claimIds: circuitClaimIds,
        message:
          "Circuit-bound evidence requires an explicit target circuit. Analyze the project, select the intended circuit, and replan.",
        resolvableByStepIds: steps.some(
          (step) =>
            step.actionType === "mcp-tool" &&
            step.tool === "logisim_analyze_design",
        )
          ? ["logisim-analyze"]
          : [],
      });
    }
  }

  const runtimeSafetyClaimIds =
    target.backendId === "logisim.evolution"
      ? assessments
          .filter(
            (assessment) =>
              [
                "simulator-load",
                "combinational-behavior",
                "sequential-behavior",
              ].includes(assessment.claim.claimClass) &&
              assessment.status !== "unsupported",
          )
          .map((assessment) => assessment.claim.id)
          .sort()
      : [];
  if (
    target.backendId === "logisim.evolution" &&
    runtimeUnsafe(evidence) &&
    runtimeSafetyClaimIds.length > 0
  ) {
    gaps.push({
      code: "runtime-safety-blocked",
      severity: "error",
      claimIds: runtimeSafetyClaimIds,
      message:
        "Caller-reported static analysis marked runtime execution unsafe; no JAR subprocess step was planned.",
      resolvableByStepIds: ["logisim-analyze"],
    });
  }
  const runtimeDiscovery = steps.find(
    (step) =>
      step.actionType === "mcp-tool" &&
      step.tool === "electronics_capabilities",
  );
  if (runtimeDiscovery?.actionType === "mcp-tool") {
    gaps.push({
      code: "runtime-status-unresolved",
      severity: "info",
      claimIds: runtimeDiscovery.claimIds,
      message:
        "Runtime availability is unresolved. Inspect electronics_capabilities, set the exact target runtimeStatus, and replan before requesting any JAR subprocess evidence.",
      resolvableByStepIds: [runtimeDiscovery.id],
    });
  }
  return gaps;
}

function addPhysicalSteps(
  steps: VerificationStep[],
  assessments: readonly ClaimAssessment[],
): void {
  const physicalClaimIds = assessments
    .filter((assessment) => assessment.claim.claimClass === "physical-hardware")
    .map((assessment) => assessment.claim.id);
  if (physicalClaimIds.length === 0) {
    return;
  }
  steps.push(
    {
      id: "physical-measurement",
      actionType: "external",
      phase: "external",
      kind: "measure-physical-hardware",
      reason:
        "Collect bounded physical measurements against manufacturer limits; simulator evidence cannot substitute for them.",
      claimIds: physicalClaimIds,
      dependsOn: [],
    },
    {
      id: "qualified-review",
      actionType: "external",
      phase: "external",
      kind: "qualified-engineering-review",
      reason:
        "Obtain qualified engineering review for consequential physical-hardware claims.",
      claimIds: physicalClaimIds,
      dependsOn: ["physical-measurement"],
    },
  );
}

function collectionBounds(total: number, limit: number) {
  return {
    total,
    returned: Math.min(total, limit),
    limit,
    truncated: total > limit,
  };
}

function overallStatus(assessments: readonly ClaimAssessment[]): PlanStatus {
  if (
    assessments.some((assessment) => assessment.status === "reported-failed")
  ) {
    return "reported-failed";
  }
  if (assessments.some((assessment) => assessment.status === "inconclusive")) {
    return "inconclusive";
  }
  if (
    assessments.some((assessment) => assessment.status === "missing-evidence")
  ) {
    return "missing-evidence";
  }
  if (assessments.some((assessment) => assessment.status === "unsupported")) {
    return "unsupported";
  }
  return "reported-covered";
}

function statementInfo(statement: string) {
  const preview = statement.slice(0, MAX_CLAIM_STATEMENT_PREVIEW_CHARACTERS);
  return {
    characters: statement.length,
    sha256: sha256Text(statement),
    preview,
    previewTruncated: preview.length < statement.length,
    trust: "untrusted-caller-authored" as const,
  };
}

/**
 * Builds a deterministic, read-only verification plan from caller-supplied
 * declarations and receipts. This function never reads a workspace, invokes an
 * MCP tool, launches a simulator, or authenticates the supplied evidence.
 */
export function planVerification(input: unknown): VerificationPlanData {
  const parsed = VerificationPlanInputSchema.parse(input);
  const normalized = normalizedInput(parsed);
  const requestDigest = digestCanonicalJson(normalized);
  const assessments = normalized.claims.map((claim) =>
    assessClaim(
      normalized.target,
      claim,
      normalized.declaredInterface,
      normalized.evidence,
    ),
  );
  const coverageMatrix = assessments.flatMap((assessment) => assessment.matrix);
  const steps =
    normalized.target.backendId === "crumb.file"
      ? buildCrumbSteps(normalized.target, assessments, normalized.evidence)
      : buildLogisimSteps(
          normalized.target,
          assessments,
          normalized.declaredInterface,
          normalized.evidence,
        );
  addPhysicalSteps(steps, assessments);
  const boundedSteps = steps.slice(0, MAX_VERIFICATION_STEPS);
  const testSuggestions = buildTestSuggestions(
    assessments,
    normalized.declaredInterface,
  );
  const allGaps = buildGaps(
    normalized.target,
    assessments,
    boundedSteps,
    normalized.declaredInterface,
    normalized.evidence,
  );
  const gaps = allGaps.slice(0, MAX_VERIFICATION_GAPS);
  const claimPlans = assessments.map((assessment) => ({
    id: assessment.claim.id,
    claimClass: assessment.claim.claimClass,
    objective: assessment.claim.objective,
    scope: assessment.claim.scope,
    ...(assessment.claim.statement === undefined
      ? {}
      : { statement: statementInfo(assessment.claim.statement) }),
    status: assessment.status,
    matchedEvidenceIds: assessment.matchedEvidenceIds,
    missingEvidenceKinds: assessment.missingEvidenceKinds,
    boundary:
      "Reported evidence is digest-bound caller input, not authenticated proof or certification." as const,
  }));
  const core = {
    planVersion: "electronics.verification-plan/0.1" as const,
    requestDigest,
    target: normalized.target,
    overallStatus: overallStatus(assessments),
    claims: claimPlans,
    coverageMatrix,
    steps: boundedSteps,
    testSuggestions,
    gaps,
    collectionBounds: {
      claims: collectionBounds(claimPlans.length, MAX_VERIFICATION_CLAIMS),
      evidence: collectionBounds(
        normalized.evidence.length,
        MAX_VERIFICATION_EVIDENCE_ITEMS,
      ),
      coverageMatrix: collectionBounds(
        coverageMatrix.length,
        MAX_VERIFICATION_MATRIX_ENTRIES,
      ),
      steps: collectionBounds(steps.length, MAX_VERIFICATION_STEPS),
      testSuggestions: collectionBounds(
        testSuggestions.length,
        MAX_VERIFICATION_TEST_SUGGESTIONS,
      ),
      gaps: collectionBounds(allGaps.length, MAX_VERIFICATION_GAPS),
    },
    evidenceBoundary: {
      plannerReadsWorkspace: false as const,
      plannerExecutesTools: false as const,
      plannerLaunchesSimulator: false as const,
      callerEvidenceAuthenticated: false as const,
      truthTableIsExpectedOracle: false as const,
      reportedCoverageIsCertification: false as const,
      physicalApprovalProvided: false as const,
    },
  };
  return VerificationPlanDataSchema.parse({
    ...core,
    planDigest: digestCanonicalJson(core),
  });
}
