import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_VERIFICATION_INTERFACE_BITS,
  planVerification,
  VerificationPlanDataSchema,
  VerificationPlanInputSchema,
} from "../src/domain/verification.js";

const PROJECT_DIGEST = `sha256:${"1".repeat(64)}`;
const OTHER_PROJECT_DIGEST = `sha256:${"2".repeat(64)}`;
const VECTOR_DIGEST = `sha256:${"3".repeat(64)}`;
const OTHER_VECTOR_DIGEST = `sha256:${"4".repeat(64)}`;

function claim(
  id: string,
  claimClass:
    | "artifact-structure"
    | "topology-connectivity"
    | "static-electrical-rules"
    | "simulator-load"
    | "combinational-behavior"
    | "sequential-behavior"
    | "conversion-readiness"
    | "physical-hardware",
  objective: "characterize" | "verify" = "verify",
  scope:
    | "artifact"
    | "selected-circuit"
    | "listed-cases"
    | "physical-system" = "artifact",
): Record<string, any> {
  return { id, claimClass, objective, scope };
}

function crumbInput(
  claims = [claim("erc", "static-electrical-rules")],
): Record<string, any> {
  return {
    target: {
      backendId: "crumb.file" as const,
      projectRef: "designs/counter.cru",
      projectDigest: PROJECT_DIGEST,
    },
    claims,
    evidence: [],
  };
}

function logisimInput(
  claims = [
    claim("behavior", "combinational-behavior", "verify", "selected-circuit"),
  ],
): Record<string, any> {
  return {
    target: {
      backendId: "logisim.evolution" as const,
      projectRef: "designs/alu.circ",
      projectDigest: PROJECT_DIGEST,
      circuit: "Main",
      runtimeStatus: "available" as const,
    },
    claims,
    declaredInterface: {
      designIntent: "combinational" as const,
      signals: [
        {
          id: "a",
          direction: "input" as const,
          width: 2,
          role: "data" as const,
        },
        {
          id: "b",
          direction: "input" as const,
          width: 2,
          role: "data" as const,
        },
        {
          id: "sum",
          direction: "output" as const,
          width: 2,
          role: "data" as const,
        },
      ],
    },
    evidence: [],
  };
}

function evidence(
  overrides: Partial<{
    id: string;
    claimIds: string[];
    kind:
      | "static-analysis"
      | "static-netlist"
      | "static-erc"
      | "conversion-report"
      | "simulator-project-load"
      | "truth-table"
      | "test-vector"
      | "expected-specification"
      | "physical-measurement"
      | "qualified-review";
    source:
      | "crumb_validate_design"
      | "crumb_analyze_design"
      | "crumb_export_netlist"
      | "crumb_check_design"
      | "logisim_analyze_design"
      | "logisim_export_netlist"
      | "logisim_component_stats"
      | "logisim_truth_table"
      | "logisim_run_test_vector"
      | "external";
    outcome: "observed" | "pass" | "fail" | "inconclusive";
    projectDigest: string;
    binding:
      | {
          backendId: "crumb.file";
          compatibilityProfile: "crumb.unity/1.3.5";
          locus: "artifact";
        }
      | {
          backendId: "crumb.file";
          compatibilityProfile: "crumb.unity/1.3.5";
          locus: "topology";
          topologyMode: "direct-only" | "known-board-v1.3.5";
          applySwitchStates: boolean;
        }
      | {
          backendId: "logisim.evolution";
          compatibilityProfile: "logisim-evolution/4.1.0";
          locus: "artifact";
        }
      | {
          backendId: "logisim.evolution";
          compatibilityProfile: "logisim-evolution/4.1.0";
          locus: "circuit";
          circuit: string;
        };
    vectorRef: string;
    vectorDigest: string;
    coverage: {
      mode:
        | "not-applicable"
        | "sampled"
        | "partitioned"
        | "exhaustive"
        | "listed-sequences";
      casesPlanned?: number;
      casesExecuted?: number;
      truncated?: boolean;
    };
    facts: {
      runtimeSafe?: boolean;
      unknownConstructCount?: number;
      distinctInputAssignments?: number;
      conversionCompleteness?: "complete" | "partial";
      conversionLossImpacts?: (
        | "metadata"
        | "topology"
        | "behavior"
        | "simulation"
      )[];
      ruleSet?: string[];
    };
  }> = {},
): Record<string, any> {
  const source = overrides.source ?? "logisim_analyze_design";
  const kind = overrides.kind ?? "static-analysis";
  const binding =
    overrides.binding ??
    (source === "crumb_validate_design" || source === "crumb_analyze_design"
      ? {
          backendId: "crumb.file" as const,
          compatibilityProfile: "crumb.unity/1.3.5" as const,
          locus: "artifact" as const,
        }
      : source === "crumb_export_netlist" || source === "crumb_check_design"
        ? {
            backendId: "crumb.file" as const,
            compatibilityProfile: "crumb.unity/1.3.5" as const,
            locus: "topology" as const,
            topologyMode: "known-board-v1.3.5" as const,
            applySwitchStates: false,
          }
        : source === "logisim_analyze_design" ||
            (source === "external" && kind !== "expected-specification")
          ? {
              backendId: "logisim.evolution" as const,
              compatibilityProfile: "logisim-evolution/4.1.0" as const,
              locus: "artifact" as const,
            }
          : {
              backendId: "logisim.evolution" as const,
              compatibilityProfile: "logisim-evolution/4.1.0" as const,
              locus: "circuit" as const,
              circuit: "Main",
            });
  return {
    id: "evidence-one",
    claimIds: ["behavior"],
    kind,
    source,
    outcome: "observed" as const,
    projectDigest: PROJECT_DIGEST,
    binding,
    coverage: {
      mode: "not-applicable" as const,
      truncated: false,
    },
    facts: {},
    ...overrides,
  };
}

test("input validation rejects ambiguous or contradictory evidence", () => {
  const duplicateClaims = crumbInput([
    claim("same", "artifact-structure"),
    claim("same", "topology-connectivity"),
  ]);
  assert.equal(
    VerificationPlanInputSchema.safeParse(duplicateClaims).success,
    false,
  );

  const unknownClaim = crumbInput([claim("known", "artifact-structure")]);
  unknownClaim.evidence.push(
    evidence({
      claimIds: ["missing"],
      source: "crumb_analyze_design",
    }) as never,
  );
  assert.equal(
    VerificationPlanInputSchema.safeParse(unknownClaim).success,
    false,
  );

  const wrongSource = logisimInput();
  wrongSource.evidence.push(
    evidence({
      kind: "truth-table",
      source: "logisim_component_stats",
      outcome: "observed",
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
    }),
  );
  assert.equal(
    VerificationPlanInputSchema.safeParse(wrongSource).success,
    false,
  );

  const wrongDigest = logisimInput();
  wrongDigest.evidence.push(evidence({ projectDigest: OTHER_PROJECT_DIGEST }));
  assert.equal(
    VerificationPlanInputSchema.safeParse(wrongDigest).success,
    false,
  );
});

test("claim classes reject scopes that would misstate their evidence boundary", () => {
  const physicalLogic = logisimInput([
    claim(
      "hardware-logic",
      "combinational-behavior",
      "verify",
      "physical-system",
    ),
  ]);
  assert.equal(
    VerificationPlanInputSchema.safeParse(physicalLogic).success,
    false,
  );

  const circuitOnlyHardware = logisimInput([
    claim("hardware", "physical-hardware", "verify", "selected-circuit"),
  ]);
  assert.equal(
    VerificationPlanInputSchema.safeParse(circuitOnlyHardware).success,
    false,
  );

  const physicalHardware = logisimInput([
    claim("hardware", "physical-hardware", "verify", "physical-system"),
  ]);
  assert.equal(
    VerificationPlanInputSchema.safeParse(physicalHardware).success,
    true,
  );
});

test("input validation enforces vector and exhaustive-coverage invariants", () => {
  const targetDigestWithoutRef = logisimInput();
  Object.assign(targetDigestWithoutRef.target, { vectorDigest: VECTOR_DIGEST });
  assert.equal(
    VerificationPlanInputSchema.safeParse(targetDigestWithoutRef).success,
    false,
  );

  const testVectorWithoutDigest = logisimInput();
  testVectorWithoutDigest.target.vectorRef = "vectors/alu.vec";
  testVectorWithoutDigest.evidence.push(
    evidence({
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/alu.vec",
      coverage: { mode: "listed-sequences", casesExecuted: 4 },
    }),
  );
  assert.equal(
    VerificationPlanInputSchema.safeParse(testVectorWithoutDigest).success,
    false,
  );

  const observedErc = crumbInput();
  observedErc.evidence.push(
    evidence({
      claimIds: ["erc"],
      kind: "static-erc",
      source: "crumb_check_design",
      outcome: "observed",
    }),
  );
  assert.equal(
    VerificationPlanInputSchema.safeParse(observedErc).success,
    false,
  );

  const truncatedExhaustive = logisimInput();
  truncatedExhaustive.evidence.push(
    evidence({
      kind: "truth-table",
      source: "logisim_truth_table",
      outcome: "observed",
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 8,
        truncated: true,
      },
    }),
  );
  assert.equal(
    VerificationPlanInputSchema.safeParse(truncatedExhaustive).success,
    false,
  );
});

test("evidence receipts require the exact backend locus and configuration", () => {
  const wrongCrumbTopology = crumbInput([
    claim("topology", "topology-connectivity"),
  ]);
  wrongCrumbTopology.evidence.push(
    evidence({
      claimIds: ["topology"],
      kind: "static-netlist",
      source: "crumb_export_netlist",
      binding: {
        backendId: "crumb.file",
        compatibilityProfile: "crumb.unity/1.3.5",
        locus: "topology",
        topologyMode: "direct-only",
        applySwitchStates: false,
      },
    }),
  );
  assert.equal(
    VerificationPlanInputSchema.safeParse(wrongCrumbTopology).success,
    false,
  );

  const wrongCircuit = logisimInput();
  wrongCircuit.target.vectorRef = "vectors/alu.vec";
  wrongCircuit.target.vectorDigest = VECTOR_DIGEST;
  wrongCircuit.evidence.push(
    evidence({
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/alu.vec",
      vectorDigest: VECTOR_DIGEST,
      binding: {
        backendId: "logisim.evolution",
        compatibilityProfile: "logisim-evolution/4.1.0",
        locus: "circuit",
        circuit: "Other",
      },
      coverage: {
        mode: "listed-sequences",
        casesPlanned: 1,
        casesExecuted: 1,
      },
    }),
  );
  assert.equal(
    VerificationPlanInputSchema.safeParse(wrongCircuit).success,
    false,
  );

  const wrongSourceLocus = logisimInput();
  wrongSourceLocus.evidence.push(
    evidence({
      kind: "truth-table",
      source: "logisim_truth_table",
      binding: {
        backendId: "logisim.evolution",
        compatibilityProfile: "logisim-evolution/4.1.0",
        locus: "artifact",
      },
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
    }),
  );
  assert.equal(
    VerificationPlanInputSchema.safeParse(wrongSourceLocus).success,
    false,
  );
});

test("test-vector receipts bind to one exact target vector identity", () => {
  const wrongRef = logisimInput();
  wrongRef.target.vectorRef = "vectors/intended.vec";
  wrongRef.evidence.push(
    evidence({
      id: "wrong-ref",
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/other.vec",
      vectorDigest: VECTOR_DIGEST,
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
      facts: { distinctInputAssignments: 16 },
    }),
  );
  assert.equal(VerificationPlanInputSchema.safeParse(wrongRef).success, false);

  const mixedDigests = logisimInput();
  mixedDigests.target.vectorRef = "vectors/intended.vec";
  mixedDigests.evidence = [
    evidence({
      id: "vector-one",
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/intended.vec",
      vectorDigest: VECTOR_DIGEST,
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
      facts: { distinctInputAssignments: 16 },
    }),
    evidence({
      id: "vector-two",
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/intended.vec",
      vectorDigest: OTHER_VECTOR_DIGEST,
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
      facts: { distinctInputAssignments: 16 },
    }),
  ];
  assert.equal(
    VerificationPlanInputSchema.safeParse(mixedDigests).success,
    false,
  );

  const inferredGuard = logisimInput([
    claim("covered", "combinational-behavior", "verify", "selected-circuit"),
    claim("pending", "combinational-behavior", "verify", "selected-circuit"),
  ]);
  inferredGuard.target.vectorRef = "vectors/intended.vec";
  inferredGuard.evidence.push(
    evidence({
      id: "covered-vector",
      claimIds: ["covered"],
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/intended.vec",
      vectorDigest: VECTOR_DIGEST,
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
      facts: { distinctInputAssignments: 16 },
    }),
  );
  const plan = planVerification(inferredGuard);
  const vectorStep = plan.steps.find(
    (step) =>
      step.actionType === "mcp-tool" && step.tool === "logisim_run_test_vector",
  );
  assert.equal(vectorStep?.actionType, "mcp-tool");
  if (vectorStep?.actionType === "mcp-tool") {
    assert.equal(vectorStep.arguments.expectedVectorDigest, VECTOR_DIGEST);
  }
});

test("input validation bounds the declared interface", () => {
  const input = logisimInput();
  input.declaredInterface.signals = [
    {
      id: "wide-a",
      direction: "input",
      width: 256,
      role: "data",
    },
    {
      id: "wide-b",
      direction: "input",
      width: 256,
      role: "data",
    },
    {
      id: "wide-c",
      direction: "input",
      width: 256,
      role: "data",
    },
    {
      id: "wide-d",
      direction: "input",
      width: 256,
      role: "data",
    },
    {
      id: "one-too-many",
      direction: "input",
      width: 1,
      role: "data",
    },
  ];
  assert.equal(
    input.declaredInterface.signals.reduce(
      (sum: number, signal: { width: number }) => sum + signal.width,
      0,
    ),
    MAX_VERIFICATION_INTERFACE_BITS + 1,
  );
  assert.equal(VerificationPlanInputSchema.safeParse(input).success, false);
});

test("plans are canonical across caller collection order", () => {
  const input = logisimInput([
    claim("topology", "topology-connectivity"),
    {
      ...claim(
        "behavior",
        "combinational-behavior",
        "characterize",
        "selected-circuit",
      ),
      statement:
        "The output should match the independently reviewed combinational specification.",
    },
  ]);
  input.evidence = [
    evidence({
      id: "truth",
      claimIds: ["behavior"],
      kind: "truth-table",
      source: "logisim_truth_table",
      outcome: "observed",
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
    }),
    evidence({
      id: "analysis",
      claimIds: ["topology", "behavior"],
    }),
    evidence({
      id: "netlist",
      claimIds: ["topology"],
      kind: "static-netlist",
      source: "logisim_export_netlist",
      outcome: "observed",
    }),
  ];
  const reordered = structuredClone(input);
  reordered.claims.reverse();
  reordered.evidence.reverse();
  reordered.evidence[1]!.claimIds.reverse();
  reordered.declaredInterface.signals.reverse();

  const first = planVerification(input);
  const second = planVerification(reordered);
  assert.deepEqual(first, second);
  assert.equal(first.requestDigest, second.requestDigest);
  assert.equal(first.planDigest, second.planDigest);
  assert.equal(
    first.claims.find((item) => item.id === "behavior")?.statement?.trust,
    "untrusted-caller-authored",
  );
});

test("canonical ordering uses locale-independent code units", () => {
  const input = logisimInput([
    claim("a_", "artifact-structure"),
    claim("a", "artifact-structure"),
    claim("A", "artifact-structure"),
    claim("a-", "artifact-structure"),
  ]);
  const reordered = structuredClone(input);
  reordered.claims.reverse();

  const first = planVerification(input);
  const second = planVerification(reordered);
  assert.deepEqual(
    first.claims.map((item) => item.id),
    ["A", "a", "a-", "a_"],
  );
  assert.equal(first.requestDigest, second.requestDigest);
  assert.equal(first.planDigest, second.planDigest);
});

test("CRUMB ERC planning schedules only the required static work with an exact digest guard", () => {
  const plan = planVerification(crumbInput());
  assert.equal(plan.overallStatus, "missing-evidence");
  assert.deepEqual(
    plan.steps.map((step) =>
      step.actionType === "mcp-tool" ? step.tool : step.kind,
    ),
    ["crumb_validate_design", "crumb_check_design"],
  );
  for (const step of plan.steps) {
    assert.equal(step.actionType, "mcp-tool");
    if (step.actionType === "mcp-tool") {
      assert.equal(step.arguments.expectedProjectDigest, PROJECT_DIGEST);
      assert.deepEqual(step.argumentBindings, []);
      assert.equal(step.tool.startsWith("logisim_"), false);
    }
  }
  VerificationPlanDataSchema.parse(plan);
});

test("CRUMB topology planning includes analysis and a netlist but not ERC", () => {
  const plan = planVerification(
    crumbInput([claim("topology", "topology-connectivity")]),
  );
  assert.deepEqual(
    plan.steps.map((step) =>
      step.actionType === "mcp-tool" ? step.tool : step.kind,
    ),
    ["crumb_validate_design", "crumb_analyze_design", "crumb_export_netlist"],
  );
  assert.equal(
    plan.steps.some(
      (step) =>
        step.actionType === "mcp-tool" && step.tool === "crumb_check_design",
    ),
    false,
  );
});

test("a missing digest is discovered once and bound into later CRUMB steps", () => {
  const input = crumbInput();
  delete (input.target as { projectDigest?: string }).projectDigest;
  const plan = planVerification(input);
  const first = plan.steps[0];
  assert.equal(first?.actionType, "mcp-tool");
  if (first?.actionType === "mcp-tool") {
    assert.equal("expectedProjectDigest" in first.arguments, false);
  }
  for (const step of plan.steps.slice(1)) {
    assert.equal(step.actionType, "mcp-tool");
    if (step.actionType === "mcp-tool") {
      assert.deepEqual(step.argumentBindings, [
        {
          argument: "expectedProjectDigest",
          fromStepId: "crumb-validate",
          outputPath: "context.projectDigest",
        },
      ]);
    }
  }
});

test("a single receipt digest guards reruns when the target digest is omitted", () => {
  const input = crumbInput([
    claim("structure", "artifact-structure"),
    claim("erc", "static-electrical-rules"),
  ]);
  delete input.target.projectDigest;
  input.evidence.push(
    evidence({
      claimIds: ["structure"],
      source: "crumb_analyze_design",
    }),
  );
  const plan = planVerification(input);
  for (const step of plan.steps) {
    assert.equal(step.actionType, "mcp-tool");
    if (step.actionType === "mcp-tool") {
      assert.equal(step.arguments.expectedProjectDigest, PROJECT_DIGEST);
      assert.deepEqual(step.argumentBindings, []);
    }
  }
});

test("CRUMB behavior is honestly unsupported and never schedules simulation", () => {
  const plan = planVerification(
    crumbInput([
      claim("behavior", "combinational-behavior", "verify", "selected-circuit"),
    ]),
  );
  assert.equal(plan.overallStatus, "unsupported");
  assert.equal(plan.claims[0]?.status, "unsupported");
  assert.deepEqual(plan.steps, []);
  assert.ok(plan.gaps.some((gap) => gap.code === "backend-claim-unsupported"));
});

test("a truth table characterizes but is never accepted as a verification oracle", () => {
  const input = logisimInput();
  input.evidence.push(
    evidence({
      id: "truth",
      kind: "truth-table",
      source: "logisim_truth_table",
      outcome: "observed",
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
    }),
  );
  const verificationPlan = planVerification(input);
  assert.equal(verificationPlan.claims[0]?.status, "missing-evidence");
  assert.ok(
    verificationPlan.claims[0]?.missingEvidenceKinds.includes("test-vector"),
  );
  assert.ok(
    verificationPlan.gaps.some((gap) => gap.code === "truth-table-not-oracle"),
  );
  assert.equal(
    verificationPlan.evidenceBoundary.truthTableIsExpectedOracle,
    false,
  );

  const characterization = structuredClone(input);
  characterization.claims[0]!.objective = "characterize";
  const characterizationPlan = planVerification(characterization);
  assert.equal(characterizationPlan.claims[0]?.status, "reported-covered");

  const falselyPassing = structuredClone(input);
  falselyPassing.evidence[0]!.outcome = "pass";
  assert.equal(
    VerificationPlanInputSchema.safeParse(falselyPassing).success,
    false,
  );
});

test("bounded combinational interfaces schedule truth-table and vector work", () => {
  const plan = planVerification(logisimInput());
  const tools = plan.steps.flatMap((step) =>
    step.actionType === "mcp-tool" ? [step.tool] : [],
  );
  assert.ok(tools.includes("logisim_analyze_design"));
  assert.ok(tools.includes("logisim_component_stats"));
  assert.ok(tools.includes("logisim_truth_table"));
  assert.ok(
    plan.steps.some(
      (step) =>
        step.actionType === "external" && step.kind === "author-test-vector",
    ),
  );
  assert.deepEqual(
    plan.testSuggestions.map((suggestion) => suggestion.pattern),
    ["exhaustive-all-combinations"],
  );
  assert.equal(plan.testSuggestions[0]?.estimatedCases, 16);
});

test("unknown Logisim runtime status requires discovery and replanning", () => {
  const input = logisimInput();
  input.target.runtimeStatus = "unknown";
  const plan = planVerification(input);
  const toolSteps = plan.steps.filter(
    (step) => step.actionType === "mcp-tool",
  );
  assert.deepEqual(
    toolSteps.map((step) => step.tool),
    ["logisim_analyze_design", "electronics_capabilities"],
  );
  assert.deepEqual(
    toolSteps.find((step) => step.tool === "electronics_capabilities")
      ?.dependsOn,
    [],
  );
  assert.equal(
    toolSteps.some((step) => step.tool === "logisim_component_stats"),
    false,
  );
  assert.equal(
    toolSteps.some((step) => step.tool === "logisim_truth_table"),
    false,
  );
  assert.ok(
    plan.gaps.some((gap) => gap.code === "runtime-status-unresolved"),
  );
});

test("exhaustive vector coverage matches the declared input space and proves distinctness", () => {
  const input = logisimInput();
  input.target.vectorRef = "vectors/alu.vec";
  input.target.vectorDigest = VECTOR_DIGEST;
  input.evidence.push(
    evidence({
      id: "vectors",
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/alu.vec",
      vectorDigest: VECTOR_DIGEST,
      coverage: {
        mode: "exhaustive",
        casesPlanned: 1,
        casesExecuted: 1,
      },
      facts: { distinctInputAssignments: 1 },
    }),
  );
  const tooShort = planVerification(input);
  assert.equal(tooShort.claims[0]?.status, "inconclusive");
  assert.ok(
    tooShort.gaps.some((gap) => gap.code === "exhaustive-case-count-mismatch"),
  );
  assert.equal(tooShort.coverageMatrix[0]?.expectedCaseCount, 16);

  input.evidence[0]!.coverage = {
    mode: "exhaustive",
    casesPlanned: 16,
    casesExecuted: 16,
  };
  input.evidence[0]!.facts = { distinctInputAssignments: 15 };
  const duplicatesPossible = planVerification(input);
  assert.equal(duplicatesPossible.claims[0]?.status, "inconclusive");
  assert.ok(
    duplicatesPossible.gaps.some(
      (gap) => gap.code === "exhaustive-distinctness-unproven",
    ),
  );

  input.evidence[0]!.facts = { distinctInputAssignments: 16 };
  const exhaustive = planVerification(input);
  assert.equal(exhaustive.claims[0]?.status, "reported-covered");
  assert.equal(exhaustive.overallStatus, "reported-covered");
});

test("a zero-input combinational interface has one exhaustive assignment", () => {
  const input = logisimInput();
  input.target.vectorRef = "vectors/constant.vec";
  input.target.vectorDigest = VECTOR_DIGEST;
  input.declaredInterface.signals = [
    {
      id: "constant-output",
      direction: "output",
      width: 1,
      role: "data",
    },
  ];
  input.evidence.push(
    evidence({
      id: "constant-vector",
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/constant.vec",
      vectorDigest: VECTOR_DIGEST,
      coverage: {
        mode: "exhaustive",
        casesPlanned: 1,
        casesExecuted: 1,
      },
      facts: { distinctInputAssignments: 1 },
    }),
  );
  const plan = planVerification(input);
  assert.equal(plan.claims[0]?.status, "reported-covered");
  assert.equal(plan.coverageMatrix[0]?.expectedCaseCount, 1);
  assert.equal(plan.testSuggestions[0]?.estimatedCases, 1);
});

test("zero-input characterization schedules its one-row truth table", () => {
  const input = logisimInput([
    claim(
      "constant",
      "combinational-behavior",
      "characterize",
      "selected-circuit",
    ),
  ]);
  input.declaredInterface.signals = [
    {
      id: "constant-output",
      direction: "output",
      width: 1,
      role: "data",
    },
  ];
  const plan = planVerification(input);
  const tools = plan.steps.flatMap((step) =>
    step.actionType === "mcp-tool" ? [step.tool] : [],
  );
  assert.ok(tools.includes("logisim_truth_table"));
  assert.equal(
    plan.steps.some(
      (step) =>
        step.actionType === "external" && step.kind === "author-test-vector",
    ),
    false,
  );
  assert.deepEqual(
    plan.gaps.find((gap) => gap.code === "missing-truth-table")
      ?.resolvableByStepIds,
    ["logisim-truth-table"],
  );
  assert.equal(plan.testSuggestions[0]?.estimatedCases, 1);
});

test("circuit-specific claims resolve a circuit before planning runtime work", () => {
  const input = logisimInput();
  delete input.target.circuit;
  const plan = planVerification(input);
  assert.deepEqual(
    plan.steps.map((step) =>
      step.actionType === "mcp-tool" ? step.tool : step.kind,
    ),
    ["logisim_analyze_design"],
  );
  assert.ok(plan.gaps.some((gap) => gap.code === "circuit-target-unresolved"));
});

test("oversized combinational interfaces suppress exhaustive truth-table work", () => {
  const input = logisimInput();
  input.declaredInterface.signals = [
    {
      id: "wide-input",
      direction: "input",
      width: 13,
      role: "data",
    },
    {
      id: "result",
      direction: "output",
      width: 1,
      role: "data",
    },
  ];
  const plan = planVerification(input);
  assert.equal(
    plan.steps.some(
      (step) =>
        step.actionType === "mcp-tool" && step.tool === "logisim_truth_table",
    ),
    false,
  );
  assert.ok(plan.gaps.some((gap) => gap.code === "truth-table-input-bound"));
  assert.deepEqual(
    plan.testSuggestions.map((suggestion) => suggestion.pattern),
    ["all-zero", "all-one", "walking-one", "walking-zero"],
  );
});

test("sequential verification uses vectors and covers only listed sequences", () => {
  const input = logisimInput([
    claim("sequence", "sequential-behavior", "verify", "listed-cases"),
  ]);
  input.target.vectorRef = "vectors/counter.vec";
  input.target.vectorDigest = VECTOR_DIGEST;
  input.declaredInterface.designIntent = "sequential";
  input.declaredInterface.signals = [
    {
      id: "clock",
      direction: "input",
      width: 1,
      role: "clock",
    },
    {
      id: "reset_n",
      direction: "input",
      width: 1,
      role: "reset",
      activeLevel: "low",
    },
    {
      id: "count",
      direction: "output",
      width: 4,
      role: "data",
    },
  ];
  input.evidence.push(
    evidence({
      id: "vectors",
      claimIds: ["sequence"],
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/counter.vec",
      vectorDigest: VECTOR_DIGEST,
      coverage: {
        mode: "listed-sequences",
        casesPlanned: 12,
        casesExecuted: 12,
      },
    }),
  );
  const plan = planVerification(input);
  assert.equal(plan.claims[0]?.status, "reported-covered");
  assert.equal(
    plan.steps.some(
      (step) =>
        step.actionType === "mcp-tool" && step.tool === "logisim_truth_table",
    ),
    false,
  );
  assert.ok(
    plan.testSuggestions.some(
      (suggestion) => suggestion.pattern === "reset-assert-release",
    ),
  );

  const universalInput = structuredClone(input);
  universalInput.claims[0]!.scope = "selected-circuit";
  const universalPlan = planVerification(universalInput);
  assert.equal(universalPlan.claims[0]?.status, "inconclusive");
  assert.ok(
    universalPlan.gaps.some((gap) => gap.code === "finite-sequence-boundary"),
  );
});

test("caller-reported unsafe runtime blocks every JAR subprocess step", () => {
  const input = logisimInput();
  input.evidence.push(
    evidence({
      facts: { runtimeSafe: false, unknownConstructCount: 1 },
    }),
  );
  const plan = planVerification(input);
  const tools = plan.steps.flatMap((step) =>
    step.actionType === "mcp-tool" ? [step.tool] : [],
  );
  assert.deepEqual(tools, ["logisim_analyze_design"]);
  assert.ok(plan.gaps.some((gap) => gap.code === "runtime-safety-blocked"));
});

test("partial conversions and Logisim coordinate netlists stay inconclusive", () => {
  const input = logisimInput([
    claim("convert", "conversion-readiness"),
    claim("topology", "topology-connectivity"),
  ]);
  input.evidence = [
    evidence({
      id: "conversion",
      claimIds: ["convert"],
      kind: "conversion-report",
      source: "logisim_analyze_design",
      outcome: "observed",
      facts: {
        conversionCompleteness: "partial",
        conversionLossImpacts: ["topology"],
      },
    }),
    evidence({
      id: "analysis",
      claimIds: ["topology"],
    }),
    evidence({
      id: "netlist",
      claimIds: ["topology"],
      kind: "static-netlist",
      source: "logisim_export_netlist",
      outcome: "observed",
    }),
  ];
  const plan = planVerification(input);
  assert.equal(
    plan.claims.find((item) => item.id === "convert")?.status,
    "inconclusive",
  );
  assert.equal(
    plan.claims.find((item) => item.id === "topology")?.status,
    "inconclusive",
  );
  assert.ok(plan.gaps.some((gap) => gap.code === "partial-logisim-netlist"));
});

test("reported failures take precedence over inconclusive claims", () => {
  const input = crumbInput([
    claim("erc", "static-electrical-rules"),
    claim("hardware", "physical-hardware", "verify", "physical-system"),
  ]);
  input.evidence = [
    evidence({
      id: "erc-failure",
      claimIds: ["erc"],
      kind: "static-erc",
      source: "crumb_check_design",
      outcome: "fail",
    }),
    evidence({
      id: "measurement",
      claimIds: ["hardware"],
      kind: "physical-measurement",
      source: "external",
      outcome: "pass",
      binding: {
        backendId: "crumb.file",
        compatibilityProfile: "crumb.unity/1.3.5",
        locus: "artifact",
      },
      coverage: {
        mode: "sampled",
        casesPlanned: 1,
        casesExecuted: 1,
      },
    }),
    evidence({
      id: "review",
      claimIds: ["hardware"],
      kind: "qualified-review",
      source: "external",
      outcome: "observed",
      binding: {
        backendId: "crumb.file",
        compatibilityProfile: "crumb.unity/1.3.5",
        locus: "artifact",
      },
    }),
  ];
  const plan = planVerification(input);
  assert.equal(
    plan.claims.find((item) => item.id === "erc")?.status,
    "reported-failed",
  );
  assert.equal(
    plan.claims.find((item) => item.id === "hardware")?.status,
    "inconclusive",
  );
  assert.equal(plan.overallStatus, "reported-failed");
});

test("failed supporting evidence and unsafe runtime facts fail closed", () => {
  const failedSupporting = logisimInput();
  failedSupporting.target.vectorRef = "vectors/alu.vec";
  failedSupporting.target.vectorDigest = VECTOR_DIGEST;
  failedSupporting.evidence = [
    evidence({
      id: "passing-vector",
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/alu.vec",
      vectorDigest: VECTOR_DIGEST,
      coverage: {
        mode: "exhaustive",
        casesPlanned: 16,
        casesExecuted: 16,
      },
      facts: { distinctInputAssignments: 16 },
    }),
    evidence({
      id: "failed-analysis",
      kind: "static-analysis",
      source: "logisim_analyze_design",
      outcome: "fail",
    }),
  ];
  const failedPlan = planVerification(failedSupporting);
  assert.equal(failedPlan.claims[0]?.status, "reported-failed");
  assert.equal(failedPlan.overallStatus, "reported-failed");
  assert.equal(
    failedPlan.coverageMatrix.find(
      (entry) => entry.evidenceKind === "static-analysis",
    )?.status,
    "reported-fail",
  );

  const unsafeRuntime = structuredClone(failedSupporting);
  unsafeRuntime.evidence[1]!.outcome = "observed";
  unsafeRuntime.evidence[1]!.facts = {
    runtimeSafe: false,
    unknownConstructCount: 1,
  };
  const unsafePlan = planVerification(unsafeRuntime);
  assert.equal(unsafePlan.claims[0]?.status, "reported-failed");
  assert.equal(unsafePlan.overallStatus, "reported-failed");
  const runtimeGap = unsafePlan.gaps.find(
    (gap) => gap.code === "runtime-safety-blocked",
  );
  assert.equal(runtimeGap?.severity, "error");
  assert.deepEqual(runtimeGap?.claimIds, ["behavior"]);
  assert.ok((runtimeGap?.claimIds.length ?? 0) > 0);
  assert.equal(
    unsafePlan.steps.some(
      (step) =>
        step.actionType === "mcp-tool" &&
        [
          "logisim_component_stats",
          "logisim_truth_table",
          "logisim_run_test_vector",
        ].includes(step.tool),
    ),
    false,
  );
});

test("physical evidence remains reported and never becomes approval", () => {
  const input = logisimInput([
    claim("hardware", "physical-hardware", "verify", "physical-system"),
  ]);
  input.evidence = [
    evidence({
      id: "measurement",
      claimIds: ["hardware"],
      kind: "physical-measurement",
      source: "external",
      outcome: "pass",
      coverage: {
        mode: "sampled",
        casesPlanned: 10,
        casesExecuted: 10,
      },
    }),
    evidence({
      id: "review",
      claimIds: ["hardware"],
      kind: "qualified-review",
      source: "external",
      outcome: "observed",
    }),
  ];
  const plan = planVerification(input);
  assert.equal(plan.claims[0]?.status, "inconclusive");
  assert.equal(plan.overallStatus, "inconclusive");
  assert.equal(plan.evidenceBoundary.reportedCoverageIsCertification, false);
  assert.equal(plan.evidenceBoundary.physicalApprovalProvided, false);
  assert.deepEqual(
    plan.steps.map((step) =>
      step.actionType === "external" ? step.kind : step.tool,
    ),
    ["measure-physical-hardware", "qualified-engineering-review"],
  );
  VerificationPlanDataSchema.parse(plan);
});

test("listed evidence without equal planned and executed counts is not coverage", () => {
  const input = logisimInput([
    claim("sequence", "sequential-behavior", "verify", "listed-cases"),
  ]);
  input.target.vectorRef = "vectors/counter.vec";
  input.target.vectorDigest = VECTOR_DIGEST;
  input.evidence.push(
    evidence({
      id: "vectors",
      claimIds: ["sequence"],
      kind: "test-vector",
      source: "logisim_run_test_vector",
      outcome: "pass",
      vectorRef: "vectors/counter.vec",
      vectorDigest: VECTOR_DIGEST,
      coverage: { mode: "listed-sequences" },
    }),
  );
  const plan = planVerification(input);
  assert.equal(plan.claims[0]?.status, "inconclusive");
  assert.equal(plan.coverageMatrix[0]?.status, "inconclusive");
});
