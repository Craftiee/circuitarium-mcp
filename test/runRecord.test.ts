import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CANONICAL_JSON_PROFILE,
  canonicalJson,
  digestCanonicalJson,
  sha256Bytes,
  sha256Text,
} from "../src/domain/canonical.js";
import {
  LOGISIM_RUN_RECORD_EXTENSION_ID,
  MAX_RUN_RECORD_ARTIFACTS,
  MAX_RUN_RECORD_BYTES,
  MAX_RUN_RECORD_DEPTH,
  MAX_RUN_RECORD_PROPERTIES,
  RUN_RECORD_AUTHENTICITY,
  RUN_RECORD_VERSION,
  SealedRunRecordSchema,
  runRecordSchemaResource,
  validateAndSealRunRecord,
  validateAndSealSerializedRunRecord,
} from "../src/domain/runRecord.js";
import { parseJsonWithoutDuplicateKeys } from "../src/domain/jsonNoDuplicates.js";

const PROJECT_DIGEST =
  "sha256:120998f05029f717cb81572233258f41707c460522659fb9f2a85e294d4fd08b";
const VECTOR_DIGEST =
  "sha256:cc00e77f53c430ce80940d7404ac62271f18d7f324fd42c6fd4f162b828e5054";
const SPEC_DIGEST =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STATIC_REPORT_DIGEST =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TABLE_DIGEST =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const VECTOR_REPORT_DIGEST =
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

function fullAdderRecord(): Record<string, unknown> {
  return {
    schemaVersion: RUN_RECORD_VERSION,
    recordId: "logisim-full-adder-run",
    recordType: "run",
    recordStatus: "closed",
    metadata: {
      executionId: "execution-01",
      capturedAt: "2026-07-29T18:00:00Z",
      serverInstanceId: "server-01",
      activityTiming: [
        {
          activityId: "vector-check",
          startedAt: "2026-07-29T17:59:03Z",
          finishedAt: "2026-07-29T17:59:04Z",
          durationMilliseconds: 1_000,
        },
        {
          activityId: "static-analysis",
          startedAt: "2026-07-29T17:59:00Z",
          finishedAt: "2026-07-29T17:59:01Z",
          durationMilliseconds: 1_000,
        },
        {
          activityId: "truth-table",
          startedAt: "2026-07-29T17:59:01Z",
          finishedAt: "2026-07-29T17:59:03Z",
          durationMilliseconds: 2_000,
        },
      ],
    },
    lineage: { parents: [] },
    content: {
      intent: {
        title: "Verify the synthetic one-bit full adder",
        summary:
          "Check every declared input assignment against an independently authored expected specification.",
        requirements: [
          {
            id: "full-adder-function",
            category: "functional",
            priority: "must",
            statement:
              "Sum and carry-out must implement a one-bit full adder for all eight input combinations.",
            claimIds: ["full-adder-correct"],
          },
        ],
        interfaces: [
          {
            id: "sum-output",
            name: "Sum",
            kind: "signal",
            direction: "output",
            widthBits: 1,
            description: "One-bit arithmetic sum.",
          },
          {
            id: "input-bus",
            name: "A, B, Cin",
            kind: "bus",
            direction: "input",
            widthBits: 3,
            description: "Two operands and carry input.",
          },
        ],
        constraints: [],
        assumptions: [],
      },
      stages: [
        {
          id: "intent",
          sequence: 1,
          kind: "intent-architecture",
          title: "Define behavior",
          status: "completed",
          requirementIds: ["full-adder-function"],
        },
        {
          id: "construction",
          sequence: 2,
          kind: "circuit-construction",
          title: "Load project structure",
          status: "completed",
          dependsOnStageIds: ["intent"],
          requirementIds: ["full-adder-function"],
        },
        {
          id: "verification",
          sequence: 3,
          kind: "behavioral-verification",
          title: "Run exhaustive checks",
          status: "completed",
          dependsOnStageIds: ["construction"],
          requirementIds: ["full-adder-function"],
        },
      ],
      toolchain: [
        {
          id: "circuitarium",
          kind: "mcp-server",
          name: "circuitarium-mcp",
          version: "0.4.0-dev.0",
          authenticity: "local-computed-unsigned",
        },
        {
          id: "logisim",
          kind: "simulator",
          name: "Logisim-evolution",
          version: "4.1.0",
          authenticity: "self-reported-unverified",
        },
      ],
      artifacts: [
        {
          id: "expected-spec",
          state: "materialized",
          role: "requirements",
          label: "Independent full-adder truth specification",
          format: "json",
          reference: {
            kind: "workspace-relative",
            value: "examples/run-records/full-adder-spec.json",
          },
          digest: {
            value: SPEC_DIGEST,
            basis: "canonical-json",
            verification: "reported",
          },
        },
        {
          id: "project",
          state: "materialized",
          role: "logic-circuit",
          label: "Synthetic Logisim full adder",
          format: "logisim-circ",
          mediaType: "application/xml",
          reference: {
            kind: "workspace-relative",
            value: "examples/logisim/full-adder.circ",
          },
          digest: {
            value: PROJECT_DIGEST,
            basis: "raw-bytes",
            verification: "computed",
          },
        },
        {
          id: "vectors",
          state: "materialized",
          role: "test-vector",
          label: "Exhaustive full-adder vectors",
          format: "logisim-vec",
          reference: {
            kind: "workspace-relative",
            value: "examples/logisim/full-adder.vec",
          },
          digest: {
            value: VECTOR_DIGEST,
            basis: "raw-bytes",
            verification: "computed",
          },
        },
        {
          id: "static-report",
          state: "materialized",
          role: "other",
          label: "Static project analysis receipt",
          format: "json",
          reference: { kind: "none" },
          digest: {
            value: STATIC_REPORT_DIGEST,
            basis: "canonical-json",
            verification: "computed",
          },
          producedByActivityId: "static-analysis",
          derivedFromArtifactIds: ["project"],
        },
        {
          id: "truth-table-report",
          state: "materialized",
          role: "truth-table",
          label: "Observed eight-row truth table",
          format: "json",
          reference: { kind: "none" },
          digest: {
            value: TABLE_DIGEST,
            basis: "canonical-json",
            verification: "computed",
          },
          producedByActivityId: "truth-table",
          derivedFromArtifactIds: ["project"],
        },
        {
          id: "vector-report",
          state: "materialized",
          role: "other",
          label: "Eight-case vector result",
          format: "json",
          reference: { kind: "none" },
          digest: {
            value: VECTOR_REPORT_DIGEST,
            basis: "canonical-json",
            verification: "computed",
          },
          producedByActivityId: "vector-check",
          derivedFromArtifactIds: ["project", "vectors"],
        },
      ],
      activities: [
        {
          id: "static-analysis",
          sequence: 1,
          stageId: "construction",
          kind: "mcp-tool-call",
          operation: "logisim_analyze_design",
          executionStatus: "completed",
          outcome: "observed",
          observationBasis: "host-observed",
          toolIdentityId: "circuitarium",
          inputArtifactIds: ["project"],
          outputArtifactIds: ["static-report"],
          resultDigest: STATIC_REPORT_DIGEST,
          evidenceIds: ["static-structure"],
        },
        {
          id: "truth-table",
          sequence: 2,
          stageId: "verification",
          kind: "simulation",
          operation: "logisim_truth_table",
          executionStatus: "completed",
          outcome: "observed",
          observationBasis: "tool-reported",
          toolIdentityId: "logisim",
          dependsOnActivityIds: ["static-analysis"],
          inputArtifactIds: ["project"],
          outputArtifactIds: ["truth-table-report"],
          resultDigest: TABLE_DIGEST,
          evidenceIds: ["observed-truth-table"],
        },
        {
          id: "vector-check",
          sequence: 3,
          stageId: "verification",
          kind: "simulation",
          operation: "logisim_run_test_vector",
          executionStatus: "completed",
          outcome: "pass",
          observationBasis: "tool-reported",
          toolIdentityId: "logisim",
          dependsOnActivityIds: ["static-analysis"],
          inputArtifactIds: ["project", "vectors", "expected-spec"],
          outputArtifactIds: ["vector-report"],
          resultDigest: VECTOR_REPORT_DIGEST,
          evidenceIds: ["vector-result"],
        },
      ],
      claims: [
        {
          id: "full-adder-correct",
          class: "functional",
          statement:
            "The selected circuit matches the independent full-adder specification for all eight input assignments.",
          verdict: "pass",
          basis: "validated-evidence",
          stageIds: ["verification"],
          artifactIds: ["project", "expected-spec", "vectors"],
          evidenceIds: [
            "expected-behavior",
            "observed-truth-table",
            "vector-result",
          ],
        },
      ],
      evidence: [
        {
          id: "expected-behavior",
          kind: "expected-specification",
          source: "independently-authored-fixture",
          outcome: "observed",
          authenticity: "caller-reported-unverified",
          artifactIds: ["expected-spec"],
          resultDigest: SPEC_DIGEST,
          summary:
            "An independently authored expected table supplies the comparison oracle.",
        },
        {
          id: "static-structure",
          kind: "static-analysis",
          source: "logisim_analyze_design",
          outcome: "observed",
          authenticity: "local-computed-unsigned",
          activityId: "static-analysis",
          artifactIds: ["project", "static-report"],
          resultDigest: STATIC_REPORT_DIGEST,
          summary:
            "Static parsing recognized the declared circuit and pin interface.",
        },
        {
          id: "observed-truth-table",
          kind: "truth-table",
          source: "logisim_truth_table",
          outcome: "observed",
          authenticity: "tool-reported-unverified",
          activityId: "truth-table",
          artifactIds: ["project", "truth-table-report"],
          resultDigest: TABLE_DIGEST,
          coverage: {
            mode: "exhaustive",
            casesPlanned: 8,
            casesExecuted: 8,
            truncated: false,
          },
          summary:
            "The configured simulator reported eight distinct input rows.",
        },
        {
          id: "vector-result",
          kind: "test-vector",
          source: "logisim_run_test_vector",
          outcome: "pass",
          authenticity: "tool-reported-unverified",
          activityId: "vector-check",
          artifactIds: ["project", "vectors", "expected-spec", "vector-report"],
          resultDigest: VECTOR_REPORT_DIGEST,
          coverage: {
            mode: "exhaustive",
            casesPlanned: 8,
            casesExecuted: 8,
            truncated: false,
          },
          summary:
            "All eight exact project-and-vector-bound cases passed.",
        },
      ],
      diagnostics: [],
      risks: [],
      signoffs: [],
      provenance: [
        {
          id: "project-provenance",
          kind: "imported",
          subjectType: "artifact",
          subjectId: "project",
          sourceArtifactIds: [],
          sourceRecordDigests: [],
          authenticity: "local-computed-unsigned",
          statement:
            "The project is the independently authored package example.",
        },
      ],
      extensions: [
        {
          extensionId: LOGISIM_RUN_RECORD_EXTENSION_ID,
          schemaVersion: "0.1",
          critical: true,
          appliesTo: {
            stageIds: ["construction", "verification"],
            activityIds: [
              "static-analysis",
              "truth-table",
              "vector-check",
            ],
            artifactIds: ["project", "vectors"],
            evidenceIds: [
              "static-structure",
              "observed-truth-table",
              "vector-result",
            ],
            claimIds: ["full-adder-correct"],
          },
          payload: {
            backendId: "logisim.evolution",
            adapterVersion: "logisim.evolution/0.1",
            compatibilityProfile: "logisim-evolution/4.1.0",
            projectArtifactId: "project",
            circuit: "Main",
            vectorArtifactId: "vectors",
            runtimeStatus: "available",
            runtimeVersion: "4.1.0",
            runtimeAuthenticity: "self-reported-unverified",
            runtimeSafety: "safe",
          },
        },
      ],
      disclosure: {
        rawCommandsIncluded: false,
        environmentValuesIncluded: false,
        absolutePathsIncluded: false,
        rawPayloadsIncluded: false,
        userAuthoredTextMayContainSensitiveData: true,
        notes: [
          "Simulator version evidence is self-reported and unsigned.",
          "No JAR, Java, workspace, home, or temporary absolute path is stored.",
        ],
      },
      completeness: {
        status: "complete",
        omittedSections: [],
        reasons: [],
      },
    },
  };
}

function expectErrorCode(value: unknown, code: string): void {
  const result = validateAndSealRunRecord(value);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some((item) => item.code === code),
    `${code} should appear in ${JSON.stringify(result.diagnostics)}`,
  );
}

test("a complete Logisim-shaped record validates and receives two honest seals", () => {
  const result = validateAndSealRunRecord(fullAdderRecord());
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.ok(result.record);
  assert.equal(result.record.schemaVersion, RUN_RECORD_VERSION);
  assert.equal(result.record.seal.canonicalization, CANONICAL_JSON_PROFILE);
  assert.equal(result.record.seal.authenticity, RUN_RECORD_AUTHENTICITY);
  assert.equal(result.record.seal.evidenceDigestScope, "content");
  assert.equal(result.record.seal.recordDigestScope, "record-excluding-seal");
  assert.equal(result.record.seal.collectionBounds.activities, 3);
  assert.equal(result.record.seal.collectionBounds.artifacts, 6);
  assert.equal(result.record.seal.collectionBounds.truncated, false);
  assert.equal(SealedRunRecordSchema.safeParse(result.record).success, true);

  const repeated = validateAndSealRunRecord(result.record, {
    recordDigest: result.record.seal.recordDigest,
    evidenceDigest: result.record.seal.evidenceDigest,
  });
  assert.equal(repeated.valid, true, JSON.stringify(repeated.diagnostics));
  assert.deepEqual(repeated.record, result.record);
});

test("canonical JSON is deterministic and rejects unsafe numeric input", () => {
  assert.equal(
    canonicalJson({ z: 0, a: ["\u{1f600}", -0, true, null] }),
    canonicalJson({ a: ["\u{1f600}", 0, true, null], z: 0 }),
  );
  assert.equal(
    digestCanonicalJson({ "\uE000": 1, "\u{10000}": 2 }),
    digestCanonicalJson({ "\u{10000}": 2, "\uE000": 1 }),
  );
  assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY));
  assert.throws(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => canonicalJson(new Date(0)));
  assert.throws(() => canonicalJson(new Map()));
  assert.throws(() => canonicalJson(new Array(1)));
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic));

  const golden = canonicalJson({
    "\uE000": -0,
    "\u{10000}": 1.25e-7,
    a: ["\n", "\uD800", true, null],
    z: 123.5,
  });
  assert.equal(
    golden,
    '{"a":["\\n","\\ud800",true,null],"z":123.5,"𐀀":1.25e-7,"":0}',
  );
  assert.equal(
    sha256Text(golden),
    "sha256:6aeb3725d81085a67e39545f2442eae4063a5b4a81dae00e1deb255bd4429d83",
  );
});

test("serialized records reject duplicate keys before JSON parsing", () => {
  const serialized = JSON.stringify(fullAdderRecord());
  const ordinaryDuplicate = serialized.replace(
    '{"schemaVersion":',
    `{"schemaVersion":"${RUN_RECORD_VERSION}","schemaVersion":`,
  );
  const ordinary = validateAndSealSerializedRunRecord(ordinaryDuplicate);
  assert.equal(ordinary.valid, false);
  assert.equal(ordinary.diagnostics[0]?.code, "duplicate-json-key");
  assert.match(ordinary.diagnostics[0]?.message ?? "", /schemaVersion/u);

  const escapedDuplicate = serialized.replace(
    '{"schemaVersion":',
    `{"schemaVersion":"${RUN_RECORD_VERSION}","schema\\u0056ersion":`,
  );
  const escaped = validateAndSealSerializedRunRecord(escapedDuplicate);
  assert.equal(escaped.valid, false);
  assert.equal(escaped.diagnostics[0]?.code, "duplicate-json-key");

  const nestedDuplicate = serialized.replace(
    '"runtimeStatus":"available"',
    '"runtimeStatus":"available","runtimeStatus":"unknown"',
  );
  assert.equal(
    validateAndSealSerializedRunRecord(nestedDuplicate).diagnostics[0]?.code,
    "duplicate-json-key",
  );
  assert.equal(
    validateAndSealSerializedRunRecord(`${serialized}{}`).diagnostics[0]?.code,
    "serialized-json-invalid",
  );
  assert.equal(
    validateAndSealSerializedRunRecord(`\uFEFF${serialized}`).diagnostics[0]
      ?.code,
    "serialized-json-invalid",
  );

  assert.doesNotThrow(() =>
    parseJsonWithoutDuplicateKeys('{"key":1,"Key":2}', {
      maxCharacters: 100,
      maxDepth: 4,
    }),
  );
  const valid = validateAndSealSerializedRunRecord(serialized);
  assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));

  const unsafeInteger = serialized.replace(
    '"sequence":1',
    '"sequence":9007199254740992',
  );
  assert.equal(
    validateAndSealSerializedRunRecord(unsafeInteger).diagnostics[0]?.code,
    "record-unsafe-integer",
  );
  const overDepth = `${"[".repeat(MAX_RUN_RECORD_DEPTH + 2)}0${"]".repeat(
    MAX_RUN_RECORD_DEPTH + 2,
  )}`;
  assert.equal(
    validateAndSealSerializedRunRecord(overDepth).diagnostics[0]?.code,
    "serialized-json-invalid",
  );
  const overBytes = `{"padding":"${"x".repeat(MAX_RUN_RECORD_BYTES)}"}`;
  assert.equal(
    validateAndSealSerializedRunRecord(overBytes).diagnostics[0]?.code,
    "record-byte-bound",
  );

  const tooManyProperties = fullAdderRecord() as {
    content: {
      extensions: Array<{ payload: Record<string, unknown> }>;
    };
  };
  tooManyProperties.content.extensions[0]!.payload = Object.fromEntries(
    Array.from({ length: MAX_RUN_RECORD_PROPERTIES }, (_, index) => [
      `p${index}`,
      0,
    ]),
  );
  assert.equal(
    validateAndSealRunRecord(tooManyProperties).diagnostics[0]?.code,
    "record-property-bound",
  );
});

test("set-like collection order does not change either digest", () => {
  const first = validateAndSealRunRecord(fullAdderRecord());
  assert.ok(first.record);
  const shuffled = structuredClone(fullAdderRecord()) as {
    metadata: { activityTiming: unknown[] };
    content: {
      toolchain: unknown[];
      artifacts: unknown[];
      claims: unknown[];
      evidence: unknown[];
      provenance: unknown[];
      disclosure: { notes: string[] };
    };
  };
  shuffled.metadata.activityTiming.reverse();
  shuffled.content.toolchain.reverse();
  shuffled.content.artifacts.reverse();
  shuffled.content.claims.reverse();
  shuffled.content.evidence.reverse();
  shuffled.content.provenance.reverse();
  shuffled.content.disclosure.notes.reverse();
  const second = validateAndSealRunRecord(shuffled);
  assert.equal(second.valid, true, JSON.stringify(second.diagnostics));
  assert.ok(second.record);
  assert.equal(
    second.record.seal.evidenceDigest,
    first.record.seal.evidenceDigest,
  );
  assert.equal(second.record.seal.recordDigest, first.record.seal.recordDigest);
});

test("volatile execution identity changes recordDigest but not evidenceDigest", () => {
  const first = validateAndSealRunRecord(fullAdderRecord());
  assert.ok(first.record);
  const replay = structuredClone(fullAdderRecord()) as {
    recordId: string;
    metadata: {
      executionId: string;
      capturedAt: string;
      serverInstanceId: string;
    };
  };
  replay.recordId = "logisim-full-adder-run-02";
  replay.metadata.executionId = "execution-02";
  replay.metadata.capturedAt = "2026-07-30T18:00:00Z";
  replay.metadata.serverInstanceId = "server-02";
  const second = validateAndSealRunRecord(replay);
  assert.ok(second.record);
  assert.equal(
    second.record.seal.evidenceDigest,
    first.record.seal.evidenceDigest,
  );
  assert.notEqual(
    second.record.seal.recordDigest,
    first.record.seal.recordDigest,
  );
});

test("semantic tampering and externally expected digest conflicts fail closed", () => {
  const initial = validateAndSealRunRecord(fullAdderRecord());
  assert.ok(initial.record);
  const tampered = structuredClone(initial.record);
  tampered.content.intent.summary = "Changed after sealing.";
  expectErrorCode(tampered, "evidence-digest-conflict");
  expectErrorCode(tampered, "record-digest-conflict");

  const expectedConflict = validateAndSealRunRecord(fullAdderRecord(), {
    recordDigest:
      "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  });
  assert.equal(expectedConflict.valid, false);
  assert.ok(
    expectedConflict.diagnostics.some(
      (item) => item.code === "expected-record-digest-conflict",
    ),
  );

  const tamperedBounds = structuredClone(initial.record);
  tamperedBounds.seal.collectionBounds.activities += 1;
  expectErrorCode(tamperedBounds, "seal-collection-bounds-conflict");
});

test("strict schemas, safe refs, bounds, and immutable artifact identity reject bad records", () => {
  const unknown = fullAdderRecord();
  (unknown as Record<string, unknown>).unexpected = true;
  expectErrorCode(unknown, "run-record-schema");

  const absolute = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        reference: { kind: string; value?: string };
      }>;
    };
  };
  absolute.content.artifacts.find((item) => item.id === "project")!.reference = {
    kind: "workspace-relative",
    value: "C:/Users/private/project.circ",
  };
  expectErrorCode(absolute, "run-record-schema");

  const noDigest = fullAdderRecord() as {
    content: { artifacts: Array<{ id: string; digest?: unknown }> };
  };
  delete noDigest.content.artifacts.find((item) => item.id === "project")!
    .digest;
  expectErrorCode(noDigest, "artifact-digest-required");

  const tooMany = fullAdderRecord() as {
    content: { artifacts: unknown[] };
  };
  tooMany.content.artifacts = Array.from(
    { length: MAX_RUN_RECORD_ARTIFACTS + 1 },
    (_, index) => ({
      id: `planned-${index}`,
      state: "planned",
      role: "other",
      label: `Planned ${index}`,
      reference: { kind: "none" },
    }),
  );
  expectErrorCode(tooMany, "run-record-schema");

  const reversedRange = fullAdderRecord() as {
    content: {
      intent: {
        constraints: unknown[];
      };
    };
  };
  reversedRange.content.intent.constraints = [
    {
      id: "frequency-window",
      category: "frequency",
      statement: "The exact range must be ordered.",
      target: {
        relation: "range",
        value: "1e2",
        upperValue: "99.9",
        unit: "MHz",
      },
      claimIds: [],
    },
  ];
  expectErrorCode(reversedRange, "constraint-range-order");

  const impossibleTimestamp = fullAdderRecord() as {
    metadata: {
      capturedAt: string;
      activityTiming: Array<{
        durationMilliseconds?: number;
        finishedAt?: string;
      }>;
    };
  };
  impossibleTimestamp.metadata.capturedAt = "2026-02-31T18:00:00Z";
  expectErrorCode(impossibleTimestamp, "run-record-schema");

  const inconsistentTiming = fullAdderRecord() as {
    metadata: {
      capturedAt: string;
      activityTiming: Array<{
        durationMilliseconds?: number;
        finishedAt?: string;
      }>;
    };
  };
  inconsistentTiming.metadata.activityTiming[0]!.durationMilliseconds =
    999_999;
  inconsistentTiming.metadata.activityTiming[0]!.finishedAt =
    "2026-07-30T18:00:00Z";
  expectErrorCode(inconsistentTiming, "activity-duration");
  expectErrorCode(inconsistentTiming, "capture-timestamp-order");
});

test("sequence, dependency, lineage, and cross-reference invariants are enforced", () => {
  const badStage = fullAdderRecord() as {
    content: {
      stages: Array<{
        id: string;
        sequence: number;
        dependsOnStageIds?: string[];
      }>;
    };
  };
  badStage.content.stages[1]!.sequence = 7;
  expectErrorCode(badStage, "stage-sequence");

  const forward = fullAdderRecord() as {
    content: {
      stages: Array<{
        id: string;
        dependsOnStageIds?: string[];
      }>;
    };
  };
  forward.content.stages[0]!.dependsOnStageIds = ["verification"];
  expectErrorCode(forward, "stage-dependency-order");

  const dangling = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; inputArtifactIds: string[] }>;
    };
  };
  dangling.content.activities[0]!.inputArtifactIds.push("missing-artifact");
  expectErrorCode(dangling, "dangling-reference");

  const selfParent = fullAdderRecord() as {
    recordId: string;
    lineage: { parents: unknown[] };
  };
  selfParent.lineage.parents.push({
    recordId: selfParent.recordId,
    recordDigest:
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    relation: "continuation",
  });
  expectErrorCode(selfParent, "lineage-self-reference");

  const aggregateWithoutSourceRuns = fullAdderRecord() as {
    recordType: string;
  };
  aggregateWithoutSourceRuns.recordType = "aggregate";
  expectErrorCode(aggregateWithoutSourceRuns, "aggregate-lineage");

  const runUsingAggregateRelation = fullAdderRecord() as {
    lineage: { parents: unknown[] };
  };
  runUsingAggregateRelation.lineage.parents.push({
    recordId: "source-run",
    recordDigest:
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    relation: "aggregates",
  });
  expectErrorCode(runUsingAggregateRelation, "aggregate-lineage");

  const conflictingParentIdentity = fullAdderRecord() as {
    lineage: { parents: unknown[] };
  };
  conflictingParentIdentity.lineage.parents.push(
    {
      recordId: "same-parent",
      recordDigest:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      relation: "continuation",
    },
    {
      recordId: "same-parent",
      recordDigest:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      relation: "derived-from",
    },
  );
  expectErrorCode(conflictingParentIdentity, "duplicate-id");

  const aggregateParentDigest =
    "sha256:1111111111111111111111111111111111111111111111111111111111111111";
  const aggregate = fullAdderRecord() as {
    recordType: string;
    lineage: { parents: unknown[] };
    content: {
      provenance: Array<{ sourceRecordDigests: string[] }>;
    };
  };
  aggregate.recordType = "aggregate";
  aggregate.lineage.parents.push({
    recordId: "child-run",
    recordDigest: aggregateParentDigest,
    relation: "aggregates",
  });
  expectErrorCode(aggregate, "aggregate-evidence-lineage");
  aggregate.content.provenance[0]!.sourceRecordDigests.push(
    aggregateParentDigest,
  );
  const firstAggregate = validateAndSealRunRecord(aggregate);
  assert.equal(
    firstAggregate.valid,
    true,
    JSON.stringify(firstAggregate.diagnostics),
  );
  assert.ok(firstAggregate.record);
  const secondAggregateInput = structuredClone(aggregate);
  const replacementDigest =
    "sha256:2222222222222222222222222222222222222222222222222222222222222222";
  (
    secondAggregateInput.lineage.parents[0] as {
      recordDigest: string;
    }
  ).recordDigest = replacementDigest;
  secondAggregateInput.content.provenance[0]!.sourceRecordDigests = [
    replacementDigest,
  ];
  const secondAggregate = validateAndSealRunRecord(secondAggregateInput);
  assert.ok(secondAggregate.record);
  assert.notEqual(
    secondAggregate.record.seal.evidenceDigest,
    firstAggregate.record.seal.evidenceDigest,
  );
});

test("plans, incomplete execution, and process completion cannot manufacture evidence", () => {
  const completedWithoutReceipt = fullAdderRecord() as {
    content: {
      activities: Array<{
        id: string;
        observationBasis: string;
        resultDigest?: string;
        evidenceIds: string[];
        diagnosticIds?: string[];
        outputArtifactIds: string[];
      }>;
    };
  };
  const activity = completedWithoutReceipt.content.activities.find(
    (item) => item.id === "static-analysis",
  )!;
  activity.observationBasis = "none";
  delete activity.resultDigest;
  activity.evidenceIds = [];
  activity.diagnosticIds = [];
  activity.outputArtifactIds = [];
  expectErrorCode(completedWithoutReceipt, "completed-without-receipt");

  const plannedPass = fullAdderRecord() as {
    content: {
      activities: Array<{
        id: string;
        executionStatus: string;
        outcome: string;
      }>;
    };
  };
  const vector = plannedPass.content.activities.find(
    (item) => item.id === "vector-check",
  )!;
  vector.executionStatus = "not-attempted";
  vector.outcome = "pass";
  expectErrorCode(plannedPass, "activity-outcome");

  const inconclusiveActivityWithPassingEvidence = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; outcome: string }>;
    };
  };
  inconclusiveActivityWithPassingEvidence.content.activities.find(
    (item) => item.id === "vector-check",
  )!.outcome = "inconclusive";
  expectErrorCode(
    inconclusiveActivityWithPassingEvidence,
    "activity-evidence-outcome",
  );

  const passingActivityWithFailingEvidence = fullAdderRecord() as {
    content: {
      evidence: Array<{ id: string; outcome: string }>;
    };
  };
  passingActivityWithFailingEvidence.content.evidence.find(
    (item) => item.id === "vector-result",
  )!.outcome = "fail";
  expectErrorCode(
    passingActivityWithFailingEvidence,
    "activity-evidence-outcome",
  );

  const completedStageWithPendingWork = fullAdderRecord() as {
    content: {
      activities: Array<{
        id: string;
        executionStatus: string;
        outcome: string;
      }>;
    };
  };
  const staticAnalysis = completedStageWithPendingWork.content.activities.find(
    (item) => item.id === "static-analysis",
  )!;
  staticAnalysis.executionStatus = "not-attempted";
  staticAnalysis.outcome = "not-applicable";
  expectErrorCode(
    completedStageWithPendingWork,
    "completed-stage-without-terminal-activity",
  );

  const completedInsidePlannedStage = fullAdderRecord() as {
    content: {
      stages: Array<{ id: string; status: string }>;
    };
  };
  completedInsidePlannedStage.content.stages.find(
    (item) => item.id === "construction",
  )!.status = "planned";
  expectErrorCode(completedInsidePlannedStage, "activity-stage-status");
  expectErrorCode(completedInsidePlannedStage, "stage-dependency-status");

  const completedAfterPendingDependency = fullAdderRecord() as {
    content: {
      activities: Array<{
        id: string;
        executionStatus: string;
        outcome: string;
      }>;
    };
  };
  const pendingStatic =
    completedAfterPendingDependency.content.activities.find(
      (item) => item.id === "static-analysis",
    )!;
  pendingStatic.executionStatus = "not-attempted";
  pendingStatic.outcome = "not-applicable";
  expectErrorCode(
    completedAfterPendingDependency,
    "activity-dependency-status",
  );

  const crossLevelProcessCycle = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; stageId: string }>;
      claims: Array<{ stageIds: string[] }>;
    };
  };
  crossLevelProcessCycle.content.activities.find(
    (item) => item.id === "static-analysis",
  )!.stageId = "verification";
  crossLevelProcessCycle.content.activities.find(
    (item) => item.id === "truth-table",
  )!.stageId = "construction";
  crossLevelProcessCycle.content.claims[0]!.stageIds.push("construction");
  expectErrorCode(
    crossLevelProcessCycle,
    "activity-dependency-stage-order",
  );

  const completedWithPlannedOutput = fullAdderRecord() as {
    content: {
      artifacts: Array<{ id: string; state: string }>;
    };
  };
  completedWithPlannedOutput.content.artifacts.find(
    (item) => item.id === "static-report",
  )!.state = "planned";
  expectErrorCode(completedWithPlannedOutput, "activity-output-state");

  const materializedOutputFromPendingActivity = fullAdderRecord() as {
    content: {
      activities: Array<{
        id: string;
        executionStatus: string;
        outcome: string;
      }>;
    };
  };
  const pendingTruthTable =
    materializedOutputFromPendingActivity.content.activities.find(
      (item) => item.id === "truth-table",
    )!;
  pendingTruthTable.executionStatus = "not-attempted";
  pendingTruthTable.outcome = "not-applicable";
  expectErrorCode(
    materializedOutputFromPendingActivity,
    "artifact-producer-status",
  );

  const emptyReportedReceipt = fullAdderRecord() as {
    content: {
      activities: Array<{
        id: string;
        executionStatus: string;
        observationBasis: string;
        resultDigest?: string;
        evidenceIds: string[];
        diagnosticIds: string[];
        outputArtifactIds: string[];
      }>;
    };
  };
  const reported = emptyReportedReceipt.content.activities.find(
    (item) => item.id === "static-analysis",
  )!;
  reported.executionStatus = "reported-only";
  reported.observationBasis = "none";
  delete reported.resultDigest;
  reported.evidenceIds = [];
  reported.diagnosticIds = [];
  reported.outputArtifactIds = [];
  expectErrorCode(emptyReportedReceipt, "completed-without-receipt");

  const completedWithOnlySkippedWork = fullAdderRecord() as {
    content: {
      activities: Array<{
        stageId: string;
        executionStatus: string;
        outcome: string;
      }>;
    };
  };
  for (const item of completedWithOnlySkippedWork.content.activities.filter(
    (activity) => activity.stageId === "verification",
  )) {
    item.executionStatus = "skipped";
    item.outcome = "not-applicable";
  }
  expectErrorCode(
    completedWithOnlySkippedWork,
    "completed-stage-without-terminal-activity",
  );
});

test("receipts stay bound to their producing activity and exact artifact locus", () => {
  const outputWithoutMatchingProducer = fullAdderRecord() as {
    content: {
      artifacts: Array<{ id: string; producedByActivityId?: string }>;
    };
  };
  outputWithoutMatchingProducer.content.artifacts.find(
    (item) => item.id === "static-report",
  )!.producedByActivityId = "truth-table";
  expectErrorCode(
    outputWithoutMatchingProducer,
    "activity-output-producer-mismatch",
  );
  expectErrorCode(outputWithoutMatchingProducer, "artifact-producer-mismatch");

  const evidenceOutsideActivityLocus = fullAdderRecord() as {
    content: {
      evidence: Array<{ id: string; artifactIds: string[] }>;
    };
  };
  evidenceOutsideActivityLocus.content.evidence
    .find((item) => item.id === "static-structure")!
    .artifactIds.push("expected-spec");
  expectErrorCode(
    evidenceOutsideActivityLocus,
    "evidence-activity-artifact-mismatch",
  );

  const claimOutsideEvidenceLocus = fullAdderRecord() as {
    content: {
      claims: Array<{ artifactIds: string[] }>;
    };
  };
  claimOutsideEvidenceLocus.content.claims[0]!.artifactIds = ["project"];
  expectErrorCode(claimOutsideEvidenceLocus, "claim-evidence-locus");

  const futureProducedInput = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; inputArtifactIds: string[] }>;
    };
  };
  futureProducedInput.content.activities
    .find((item) => item.id === "static-analysis")!
    .inputArtifactIds.push("vector-report");
  expectErrorCode(futureProducedInput, "activity-input-causality");
  expectErrorCode(futureProducedInput, "activity-input-stage-order");

  const undeclaredDerivationInput = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        derivedFromArtifactIds: string[];
        digest?: {
          value: string;
          basis: string;
          verification: string;
        };
      }>;
    };
  };
  undeclaredDerivationInput.content.artifacts.find(
    (item) => item.id === "static-report",
  )!.derivedFromArtifactIds.push("expected-spec");
  expectErrorCode(
    undeclaredDerivationInput,
    "activity-output-derivation",
  );

  const mismatchedEvidenceResult = fullAdderRecord() as {
    content: {
      evidence: Array<{ id: string; resultDigest?: string }>;
    };
  };
  mismatchedEvidenceResult.content.evidence.find(
    (item) => item.id === "vector-result",
  )!.resultDigest =
    "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  expectErrorCode(mismatchedEvidenceResult, "evidence-result-linkage");

  const missingEvidenceResult = fullAdderRecord() as {
    content: {
      evidence: Array<{ id: string; resultDigest?: string; outcome: string }>;
    };
  };
  const observedTruthTable = missingEvidenceResult.content.evidence.find(
    (item) => item.id === "observed-truth-table",
  )!;
  delete observedTruthTable.resultDigest;
  expectErrorCode(missingEvidenceResult, "evidence-result-linkage");
});

test("operation authority, runtime identity, coverage, and authenticity fail closed", () => {
  const staticMasqueradingAsVector = fullAdderRecord() as {
    content: {
      evidence: Array<{
        id: string;
        kind: string;
        outcome: string;
        coverage?: {
          mode: string;
          casesPlanned: number;
          casesExecuted: number;
          truncated: boolean;
        };
      }>;
    };
  };
  const staticEvidence = staticMasqueradingAsVector.content.evidence.find(
    (item) => item.id === "static-structure",
  )!;
  staticEvidence.kind = "test-vector";
  staticEvidence.outcome = "pass";
  staticEvidence.coverage = {
    mode: "exhaustive",
    casesPlanned: 1,
    casesExecuted: 1,
    truncated: false,
  };
  expectErrorCode(staticMasqueradingAsVector, "evidence-activity-kind");
  expectErrorCode(staticMasqueradingAsVector, "evidence-operation-authority");

  const runtimeUnknown = fullAdderRecord() as {
    content: {
      extensions: Array<{
        payload: {
          runtimeStatus: string;
          runtimeSafety: string;
          runtimeVersion?: string;
          runtimeAuthenticity?: string;
        };
      }>;
    };
  };
  const unknownPayload = runtimeUnknown.content.extensions[0]!.payload;
  unknownPayload.runtimeStatus = "unknown";
  unknownPayload.runtimeSafety = "unknown";
  delete unknownPayload.runtimeVersion;
  delete unknownPayload.runtimeAuthenticity;
  expectErrorCode(runtimeUnknown, "extension-runtime-authority");

  const wrongAvailableVersion = fullAdderRecord() as {
    content: {
      extensions: Array<{
        payload: { runtimeVersion?: string };
      }>;
    };
  };
  wrongAvailableVersion.content.extensions[0]!.payload.runtimeVersion = "99.0";
  expectErrorCode(wrongAvailableVersion, "extension-schema");

  const vectorRunWithoutExactVector = fullAdderRecord() as {
    content: {
      extensions: Array<{
        appliesTo: { artifactIds: string[] };
        payload: { vectorArtifactId?: string };
      }>;
    };
  };
  delete vectorRunWithoutExactVector.content.extensions[0]!.payload
    .vectorArtifactId;
  vectorRunWithoutExactVector.content.extensions[0]!.appliesTo.artifactIds =
    vectorRunWithoutExactVector.content.extensions[0]!.appliesTo.artifactIds
      .filter((artifactId) => artifactId !== "vectors");
  expectErrorCode(
    vectorRunWithoutExactVector,
    "extension-vector-required",
  );

  const missingVectorCoverage = fullAdderRecord() as {
    content: {
      evidence: Array<{ id: string; coverage?: unknown }>;
    };
  };
  delete missingVectorCoverage.content.evidence.find(
    (item) => item.id === "vector-result",
  )!.coverage;
  expectErrorCode(missingVectorCoverage, "evidence-coverage-required");

  const emptyVectorCoverage = fullAdderRecord() as {
    content: {
      evidence: Array<{
        id: string;
        coverage?: {
          mode: string;
          casesPlanned?: number;
          casesExecuted?: number;
          truncated: boolean;
        };
      }>;
    };
  };
  emptyVectorCoverage.content.evidence.find(
    (item) => item.id === "vector-result",
  )!.coverage = {
    mode: "not-applicable",
    casesPlanned: 0,
    casesExecuted: 0,
    truncated: false,
  };
  expectErrorCode(emptyVectorCoverage, "evidence-coverage");

  const mismatchedAuthenticity = fullAdderRecord() as {
    content: {
      evidence: Array<{ id: string; authenticity: string }>;
    };
  };
  mismatchedAuthenticity.content.evidence.find(
    (item) => item.id === "vector-result",
  )!.authenticity = "caller-reported-unverified";
  expectErrorCode(
    mismatchedAuthenticity,
    "evidence-observation-authenticity",
  );

  const inventedLocalReview = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; kind: string; operation: string }>;
      evidence: Array<{
        id: string;
        kind: string;
        authenticity: string;
      }>;
    };
  };
  const reviewActivity = inventedLocalReview.content.activities.find(
    (item) => item.id === "vector-check",
  )!;
  reviewActivity.kind = "review";
  reviewActivity.operation = "independent_layout_review";
  const reviewEvidence = inventedLocalReview.content.evidence.find(
    (item) => item.id === "vector-result",
  )!;
  reviewEvidence.kind = "qualified-review";
  reviewEvidence.authenticity = "local-computed-unsigned";
  expectErrorCode(inventedLocalReview, "evidence-authenticity");

  const callerReportClaimingValidation = fullAdderRecord() as {
    content: {
      activities: Array<{
        id: string;
        executionStatus: string;
        observationBasis: string;
      }>;
      claims: Array<{
        id: string;
        basis: string;
        evidenceIds: string[];
      }>;
      evidence: Array<{ id: string; authenticity: string }>;
    };
  };
  const callerVectorActivity =
    callerReportClaimingValidation.content.activities.find(
      (item) => item.id === "vector-check",
    )!;
  callerVectorActivity.executionStatus = "reported-only";
  callerVectorActivity.observationBasis = "caller-reported";
  callerReportClaimingValidation.content.evidence.find(
    (item) => item.id === "vector-result",
  )!.authenticity = "caller-reported-unverified";
  callerReportClaimingValidation.content.claims.find(
    (item) => item.id === "full-adder-correct",
  )!.evidenceIds = ["vector-result"];
  expectErrorCode(
    callerReportClaimingValidation,
    "claim-validated-evidence",
  );

  const omittedAdapterCoverage = fullAdderRecord() as {
    content: {
      extensions: Array<{
        appliesTo: {
          activityIds: string[];
          evidenceIds: string[];
          claimIds: string[];
        };
      }>;
    };
  };
  const appliesTo = omittedAdapterCoverage.content.extensions[0]!.appliesTo;
  appliesTo.activityIds = appliesTo.activityIds.filter(
    (id) => id !== "vector-check",
  );
  appliesTo.evidenceIds = appliesTo.evidenceIds.filter(
    (id) => id !== "vector-result",
  );
  appliesTo.claimIds = [];
  expectErrorCode(omittedAdapterCoverage, "adapter-extension-coverage");

  const noncriticalAdapterEvidence = fullAdderRecord() as {
    content: { extensions: Array<{ critical: boolean }> };
  };
  noncriticalAdapterEvidence.content.extensions[0]!.critical = false;
  expectErrorCode(
    noncriticalAdapterEvidence,
    "adapter-extension-critical",
  );

  const plannedVerdictArtifact = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        state: string;
        digest?: unknown;
      }>;
    };
  };
  const plannedProject = plannedVerdictArtifact.content.artifacts.find(
    (item) => item.id === "project",
  )!;
  plannedProject.state = "planned";
  delete plannedProject.digest;
  expectErrorCode(plannedVerdictArtifact, "activity-input-identity");
  expectErrorCode(plannedVerdictArtifact, "evidence-artifact-identity");
  expectErrorCode(plannedVerdictArtifact, "claim-artifact-identity");

  const missingToolIdentity = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; toolIdentityId?: string }>;
    };
  };
  delete missingToolIdentity.content.activities.find(
    (item) => item.id === "vector-check",
  )!.toolIdentityId;
  expectErrorCode(
    missingToolIdentity,
    "activity-tool-identity-required",
  );

  const contradictoryRuntimeIdentity = fullAdderRecord() as {
    content: {
      toolchain: Array<{
        id: string;
        kind: string;
        version?: string;
        authenticity: string;
      }>;
    };
  };
  contradictoryRuntimeIdentity.content.toolchain.find(
    (item) => item.id === "logisim",
  )!.version = "99.0";
  expectErrorCode(
    contradictoryRuntimeIdentity,
    "extension-runtime-tool-identity",
  );

  const wrongRuntimeIdentityKind = fullAdderRecord() as {
    content: {
      toolchain: Array<{ id: string; kind: string }>;
    };
  };
  wrongRuntimeIdentityKind.content.toolchain.find(
    (item) => item.id === "logisim",
  )!.kind = "mcp-server";
  expectErrorCode(
    wrongRuntimeIdentityKind,
    "extension-runtime-tool-identity",
  );

  const genericOperationCannotContradictLogisimRuntime =
    fullAdderRecord() as {
      content: {
        toolchain: Array<{
          id: string;
          kind: string;
          name: string;
          version?: string;
          authenticity: string;
        }>;
        activities: Array<{
          id: string;
          operation: string;
          toolIdentityId?: string;
        }>;
      };
    };
  genericOperationCannotContradictLogisimRuntime.content.toolchain.push({
    id: "vendor",
    kind: "simulator",
    name: "Vendor simulator",
    version: "99.0",
    authenticity: "self-reported-unverified",
  });
  const genericVectorActivity =
    genericOperationCannotContradictLogisimRuntime.content.activities.find(
      (item) => item.id === "vector-check",
    )!;
  genericVectorActivity.operation = "vendor_test";
  genericVectorActivity.toolIdentityId = "vendor";
  expectErrorCode(
    genericOperationCannotContradictLogisimRuntime,
    "extension-runtime-tool-identity",
  );

  const noncanonicalKnownOperation = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; operation: string }>;
      extensions: unknown[];
    };
  };
  noncanonicalKnownOperation.content.activities.find(
    (item) => item.id === "vector-check",
  )!.operation = "Logisim_run_test_vector";
  noncanonicalKnownOperation.content.extensions = [];
  expectErrorCode(
    noncanonicalKnownOperation,
    "activity-operation-namespace",
  );
  expectErrorCode(
    noncanonicalKnownOperation,
    "evidence-operation-unknown",
  );

  const whitespaceOperation = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; operation: string }>;
    };
  };
  whitespaceOperation.content.activities.find(
    (item) => item.id === "vector-check",
  )!.operation = " logisim_run_test_vector";
  expectErrorCode(whitespaceOperation, "run-record-schema");

  const unversionedEvidenceTool = fullAdderRecord() as {
    content: {
      toolchain: Array<{
        id: string;
        version?: string;
        artifactDigest?: string;
      }>;
    };
  };
  const logisimIdentity = unversionedEvidenceTool.content.toolchain.find(
    (item) => item.id === "logisim",
  )!;
  delete logisimIdentity.version;
  delete logisimIdentity.artifactDigest;
  expectErrorCode(
    unversionedEvidenceTool,
    "activity-tool-identity-reproducibility",
  );
});

test("truth tables remain observations and cannot serve as their own oracle", () => {
  const selfOracle = fullAdderRecord() as {
    content: {
      claims: Array<{ evidenceIds: string[] }>;
      evidence: Array<{ id: string; outcome: string }>;
    };
  };
  selfOracle.content.claims[0]!.evidenceIds = ["observed-truth-table"];
  expectErrorCode(selfOracle, "claim-pass-evidence");

  const truthTableVerdict = structuredClone(selfOracle);
  truthTableVerdict.content.evidence.find(
    (item) => item.id === "observed-truth-table",
  )!.outcome = "pass";
  expectErrorCode(truthTableVerdict, "evidence-authority");

  const staticBehavior = fullAdderRecord() as {
    content: {
      claims: Array<{ evidenceIds: string[] }>;
      evidence: Array<{ id: string; outcome: string }>;
    };
  };
  staticBehavior.content.claims[0]!.evidenceIds = ["static-structure"];
  staticBehavior.content.evidence.find(
    (item) => item.id === "static-structure",
  )!.outcome = "pass";
  expectErrorCode(staticBehavior, "claim-evidence-class");

  const sameActivityOracle = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; evidenceIds: string[] }>;
      claims: Array<{ evidenceIds: string[] }>;
      evidence: Array<{
        id: string;
        activityId?: string;
      }>;
    };
  };
  sameActivityOracle.content.claims[0]!.evidenceIds = [
    "expected-behavior",
    "observed-truth-table",
  ];
  sameActivityOracle.content.evidence.find(
    (item) => item.id === "expected-behavior",
  )!.activityId = "truth-table";
  sameActivityOracle.content.activities
    .find((item) => item.id === "truth-table")!
    .evidenceIds.push("expected-behavior");
  expectErrorCode(sameActivityOracle, "claim-pass-evidence");

  const designDerivedOracle = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        derivedFromArtifactIds: string[];
      }>;
    };
  };
  designDerivedOracle.content.artifacts.find(
    (item) => item.id === "expected-spec",
  )!.derivedFromArtifactIds = ["project"];
  expectErrorCode(designDerivedOracle, "claim-oracle-independence");

  const identicalOracleAndImplementation = fullAdderRecord() as {
    content: {
      evidence: Array<{ id: string; artifactIds: string[] }>;
    };
  };
  identicalOracleAndImplementation.content.evidence.find(
    (item) => item.id === "expected-behavior",
  )!.artifactIds = ["project"];
  expectErrorCode(
    identicalOracleAndImplementation,
    "claim-oracle-independence",
  );

  const digestAliasedOracleAndImplementation = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        digest?: {
          value: string;
          basis: string;
          verification: string;
        };
      }>;
    };
  };
  const aliasedProject =
    digestAliasedOracleAndImplementation.content.artifacts.find(
      (item) => item.id === "project",
    )!;
  digestAliasedOracleAndImplementation.content.artifacts.find(
    (item) => item.id === "expected-spec",
  )!.digest = structuredClone(aliasedProject.digest!);
  expectErrorCode(
    digestAliasedOracleAndImplementation,
    "claim-oracle-independence",
  );

  const transitiveDigestAliasedVector = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        derivedFromArtifactIds: string[];
        digest?: {
          value: string;
          basis: string;
          verification: string;
        };
      }>;
    };
  };
  const projectAlias = structuredClone(
    transitiveDigestAliasedVector.content.artifacts.find(
      (item) => item.id === "project",
    )!,
  );
  projectAlias.id = "project-byte-alias";
  transitiveDigestAliasedVector.content.artifacts.push(projectAlias);
  transitiveDigestAliasedVector.content.artifacts.find(
    (item) => item.id === "vectors",
  )!.derivedFromArtifactIds = ["project-byte-alias"];
  expectErrorCode(
    transitiveDigestAliasedVector,
    "claim-oracle-independence",
  );

  const crossBasisDigestAliasedVector = structuredClone(
    transitiveDigestAliasedVector,
  );
  crossBasisDigestAliasedVector.content.artifacts.find(
    (item) => item.id === "project-byte-alias",
  )!.digest!.basis = "canonical-json";
  expectErrorCode(
    crossBasisDigestAliasedVector,
    "claim-oracle-independence",
  );

  const provenanceDerivedVector = fullAdderRecord() as {
    content: { provenance: unknown[] };
  };
  provenanceDerivedVector.content.provenance.push({
    id: "vector-derived-from-project",
    kind: "derived",
    subjectType: "artifact",
    subjectId: "vectors",
    sourceArtifactIds: ["project"],
    sourceRecordDigests: [],
    authenticity: "local-computed-unsigned",
    statement:
      "The expected vector oracle was generated from the implementation.",
  });
  expectErrorCode(
    provenanceDerivedVector,
    "claim-oracle-independence",
  );

  const provenanceDerivedExpectedSpec = fullAdderRecord() as {
    content: { provenance: unknown[] };
  };
  provenanceDerivedExpectedSpec.content.provenance.push({
    id: "spec-derived-from-project",
    kind: "derived",
    subjectType: "artifact",
    subjectId: "expected-spec",
    sourceArtifactIds: ["project"],
    sourceRecordDigests: [],
    authenticity: "local-computed-unsigned",
    statement:
      "The expected specification was generated from the implementation.",
  });
  expectErrorCode(
    provenanceDerivedExpectedSpec,
    "claim-oracle-independence",
  );

  const transitivelyDesignDerivedOracle = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        derivedFromArtifactIds: string[];
      }>;
    };
  };
  transitivelyDesignDerivedOracle.content.artifacts.find(
    (item) => item.id === "expected-spec",
  )!.derivedFromArtifactIds = ["static-report"];
  expectErrorCode(
    transitivelyDesignDerivedOracle,
    "claim-oracle-independence",
  );

  const producerDerivedOracle = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        producedByActivityId?: string;
      }>;
      activities: Array<{ id: string; outputArtifactIds: string[] }>;
    };
  };
  producerDerivedOracle.content.artifacts.find(
    (item) => item.id === "expected-spec",
  )!.producedByActivityId = "static-analysis";
  producerDerivedOracle.content.activities.find(
    (item) => item.id === "static-analysis",
  )!.outputArtifactIds.push("expected-spec");
  expectErrorCode(producerDerivedOracle, "claim-oracle-independence");

  const designDerivedVector = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        derivedFromArtifactIds: string[];
      }>;
    };
  };
  designDerivedVector.content.artifacts.find(
    (item) => item.id === "vectors",
  )!.derivedFromArtifactIds = ["project"];
  expectErrorCode(designDerivedVector, "claim-oracle-independence");

  const producerDerivedVector = fullAdderRecord() as {
    content: {
      artifacts: Array<{
        id: string;
        producedByActivityId?: string;
      }>;
      activities: Array<{ id: string; outputArtifactIds: string[] }>;
    };
  };
  producerDerivedVector.content.artifacts.find(
    (item) => item.id === "vectors",
  )!.producedByActivityId = "static-analysis";
  producerDerivedVector.content.activities.find(
    (item) => item.id === "static-analysis",
  )!.outputArtifactIds.push("vectors");
  expectErrorCode(producerDerivedVector, "claim-oracle-independence");

  const comparisonIgnoringOracle = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; inputArtifactIds: string[] }>;
    };
  };
  comparisonIgnoringOracle.content.activities.find(
    (item) => item.id === "vector-check",
  )!.inputArtifactIds = ["project", "vectors"];
  expectErrorCode(comparisonIgnoringOracle, "claim-oracle-comparison");

  const comparisonIgnoringVector = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; inputArtifactIds: string[] }>;
    };
  };
  comparisonIgnoringVector.content.activities.find(
    (item) => item.id === "vector-check",
  )!.inputArtifactIds = ["project", "expected-spec"];
  expectErrorCode(comparisonIgnoringVector, "claim-vector-comparison");
});

test("verdict evidence consumes a reproducible claim-scoped subject", () => {
  const reportOnlyFormalPass = fullAdderRecord() as {
    content: {
      toolchain: Array<{
        id: string;
        kind: string;
        name: string;
        authenticity: string;
      }>;
      artifacts: Array<{
        id: string;
        derivedFromArtifactIds: string[];
      }>;
      activities: Array<{
        id: string;
        kind: string;
        operation: string;
        toolIdentityId?: string;
        inputArtifactIds: string[];
      }>;
      claims: Array<{
        artifactIds: string[];
        evidenceIds: string[];
      }>;
      evidence: Array<{
        id: string;
        kind: string;
        artifactIds: string[];
        coverage?: unknown;
      }>;
      extensions: Array<{
        appliesTo: {
          activityIds: string[];
          evidenceIds: string[];
          claimIds: string[];
        };
      }>;
    };
  };
  reportOnlyFormalPass.content.toolchain.push({
    id: "vendor-formal",
    kind: "formal-tool",
    name: "Vendor formal tool",
    authenticity: "self-reported-unverified",
  });
  const formalActivity = reportOnlyFormalPass.content.activities.find(
    (item) => item.id === "vector-check",
  )!;
  formalActivity.kind = "formal-check";
  formalActivity.operation = "vendor_formal";
  formalActivity.toolIdentityId = "vendor-formal";
  formalActivity.inputArtifactIds = [];
  reportOnlyFormalPass.content.artifacts.find(
    (item) => item.id === "vector-report",
  )!.derivedFromArtifactIds = [];
  const formalEvidence = reportOnlyFormalPass.content.evidence.find(
    (item) => item.id === "vector-result",
  )!;
  formalEvidence.kind = "formal-proof";
  formalEvidence.artifactIds = ["vector-report"];
  delete formalEvidence.coverage;
  reportOnlyFormalPass.content.claims[0]!.artifactIds = ["vector-report"];
  reportOnlyFormalPass.content.claims[0]!.evidenceIds = ["vector-result"];
  const extensionLocus =
    reportOnlyFormalPass.content.extensions[0]!.appliesTo;
  extensionLocus.activityIds = extensionLocus.activityIds.filter(
    (id) => id !== "vector-check",
  );
  extensionLocus.evidenceIds = extensionLocus.evidenceIds.filter(
    (id) => id !== "vector-result",
  );
  extensionLocus.claimIds = [];

  expectErrorCode(reportOnlyFormalPass, "claim-subject-required");
  expectErrorCode(reportOnlyFormalPass, "claim-evidence-subject");
  expectErrorCode(
    reportOnlyFormalPass,
    "activity-tool-identity-reproducibility",
  );

  const recycledSubject = fullAdderRecord() as {
    content: {
      activities: Array<{
        id: string;
        inputArtifactIds: string[];
        outputArtifactIds: string[];
      }>;
    };
  };
  recycledSubject.content.activities.find(
    (item) => item.id === "vector-check",
  )!.outputArtifactIds.push("project");
  expectErrorCode(recycledSubject, "activity-input-output-overlap");

  const appendUnverifiedSubject = (
    record: Record<string, unknown>,
  ): void => {
    const typed = record as {
      content: {
        artifacts: unknown[];
        claims: Array<{ artifactIds: string[] }>;
      };
    };
    typed.content.artifacts.push({
      id: "unverified-project",
      state: "materialized",
      role: "logic-circuit",
      label: "A second implementation outside the evidence locus",
      format: "json",
      reference: { kind: "none" },
      digest: {
        value:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        basis: "canonical-json",
        verification: "reported",
      },
      derivedFromArtifactIds: [],
    });
    typed.content.claims[0]!.artifactIds.push("unverified-project");
  };

  const passWithUntestedSubject = fullAdderRecord();
  appendUnverifiedSubject(passWithUntestedSubject);
  expectErrorCode(
    passWithUntestedSubject,
    "claim-subject-evidence-locus",
  );

  const failWithUntestedSubject = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; outcome: string }>;
      claims: Array<{ id: string; verdict: string; artifactIds: string[] }>;
      evidence: Array<{ id: string; outcome: string }>;
      artifacts: unknown[];
    };
  };
  failWithUntestedSubject.content.activities.find(
    (item) => item.id === "vector-check",
  )!.outcome = "fail";
  failWithUntestedSubject.content.evidence.find(
    (item) => item.id === "vector-result",
  )!.outcome = "fail";
  failWithUntestedSubject.content.claims.find(
    (item) => item.id === "full-adder-correct",
  )!.verdict = "fail";
  appendUnverifiedSubject(failWithUntestedSubject);
  expectErrorCode(
    failWithUntestedSubject,
    "claim-subject-evidence-locus",
  );
});

test("artifact derivation, extension digests, and critical extension semantics fail closed", () => {
  const cycle = fullAdderRecord() as {
    content: {
      artifacts: Array<{ id: string; derivedFromArtifactIds: string[] }>;
    };
  };
  cycle.content.artifacts.find(
    (item) => item.id === "project",
  )!.derivedFromArtifactIds = ["static-report"];
  expectErrorCode(cycle, "artifact-cycle");

  const provenanceSelfCycle = fullAdderRecord() as {
    content: { provenance: unknown[] };
  };
  provenanceSelfCycle.content.provenance.push({
    id: "project-self-cycle",
    kind: "derived",
    subjectType: "artifact",
    subjectId: "project",
    sourceArtifactIds: ["project"],
    sourceRecordDigests: [],
    authenticity: "local-computed-unsigned",
    statement: "Invalid self-referential provenance.",
  });
  expectErrorCode(provenanceSelfCycle, "artifact-cycle");

  const provenanceOnlyCycle = fullAdderRecord() as {
    content: { provenance: unknown[] };
  };
  provenanceOnlyCycle.content.provenance.push(
    {
      id: "spec-from-vectors",
      kind: "derived",
      subjectType: "artifact",
      subjectId: "expected-spec",
      sourceArtifactIds: ["vectors"],
      sourceRecordDigests: [],
      authenticity: "local-computed-unsigned",
      statement: "Invalid half of a provenance cycle.",
    },
    {
      id: "vectors-from-spec",
      kind: "derived",
      subjectType: "artifact",
      subjectId: "vectors",
      sourceArtifactIds: ["expected-spec"],
      sourceRecordDigests: [],
      authenticity: "local-computed-unsigned",
      statement: "Invalid other half of a provenance cycle.",
    },
  );
  expectErrorCode(provenanceOnlyCycle, "artifact-cycle");

  const mixedProvenanceCycle = fullAdderRecord() as {
    content: { provenance: unknown[] };
  };
  mixedProvenanceCycle.content.provenance.push({
    id: "project-from-static-report",
    kind: "derived",
    subjectType: "artifact",
    subjectId: "project",
    sourceArtifactIds: ["static-report"],
    sourceRecordDigests: [],
    authenticity: "local-computed-unsigned",
    statement:
      "Invalid provenance edge opposite an explicit artifact derivation.",
  });
  expectErrorCode(mixedProvenanceCycle, "artifact-cycle");

  const digestConflict = fullAdderRecord() as {
    content: { extensions: Array<{ payloadDigest?: string }> };
  };
  digestConflict.content.extensions[0]!.payloadDigest =
    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  expectErrorCode(digestConflict, "extension-digest-conflict");

  const unknownCritical = fullAdderRecord() as {
    content: {
      extensions: Array<{
        extensionId: string;
        schemaVersion: string;
        critical: boolean;
        appliesTo: Record<string, unknown>;
        payload: Record<string, unknown>;
      }>;
    };
  };
  unknownCritical.content.extensions.push({
    extensionId: "org.example.future/new-backend/0.1",
    schemaVersion: "0.1",
    critical: true,
    appliesTo: {
      stageIds: [],
      activityIds: [],
      artifactIds: [],
      evidenceIds: [],
      claimIds: [],
    },
    payload: { future: true },
  });
  expectErrorCode(unknownCritical, "unknown-critical-extension");

  unknownCritical.content.extensions[1]!.critical = false;
  const preserved = validateAndSealRunRecord(unknownCritical);
  assert.equal(preserved.valid, true, JSON.stringify(preserved.diagnostics));
  assert.ok(
    preserved.diagnostics.some(
      (item) => item.code === "unknown-extension-preserved",
    ),
  );
  assert.deepEqual(
    preserved.record?.content.extensions.find(
      (item) =>
        item.extensionId === "org.example.future/new-backend/0.1",
    )?.payload,
    { future: true },
  );

  const availableWithoutRuntimeIdentity = fullAdderRecord() as {
    content: {
      extensions: Array<{
        payload: {
          runtimeVersion?: string;
          runtimeAuthenticity?: string;
        };
      }>;
    };
  };
  delete availableWithoutRuntimeIdentity.content.extensions[0]!.payload
    .runtimeVersion;
  expectErrorCode(availableWithoutRuntimeIdentity, "extension-schema");

  const unavailableWithExecutedIdentity = fullAdderRecord() as {
    content: {
      extensions: Array<{
        payload: {
          runtimeStatus: string;
          runtimeVersion?: string;
          runtimeAuthenticity?: string;
        };
      }>;
    };
  };
  unavailableWithExecutedIdentity.content.extensions[0]!.payload.runtimeStatus =
    "unavailable";
  expectErrorCode(unavailableWithExecutedIdentity, "extension-schema");

  const falseVersionMismatch = fullAdderRecord() as {
    content: {
      extensions: Array<{
        payload: {
          runtimeStatus: string;
          runtimeVersion?: string;
        };
      }>;
    };
  };
  falseVersionMismatch.content.extensions[0]!.payload.runtimeStatus =
    "version-mismatch";
  falseVersionMismatch.content.extensions[0]!.payload.runtimeVersion = "4.1.0";
  expectErrorCode(falseVersionMismatch, "extension-schema");
});

test("signoff remains scoped, conditional, risk-aware, and caller-reported", () => {
  const record = fullAdderRecord() as {
    content: {
      risks: unknown[];
      signoffs: unknown[];
    };
  };
  record.content.risks = [
    {
      id: "open-critical-risk",
      severity: "critical",
      statement: "A critical physical risk remains unresolved.",
      status: "open",
      evidenceIds: [],
    },
  ];
  record.content.signoffs = [
    {
      id: "layout-signoff",
      status: "accepted-with-conditions",
      authorityKind: "external-human",
      authenticity: "caller-reported-unverified",
      claimIds: ["full-adder-correct"],
      artifactIds: ["project"],
      evidenceIds: ["vector-result"],
      acceptedRiskIds: [],
      conditions: [],
      scopeStatement: "Accept only the exact synthetic project digest.",
    },
  ];
  expectErrorCode(record, "signoff-conditions");
  expectErrorCode(record, "signoff-open-risk");
  expectErrorCode(record, "signoff-stage-required");

  const disjointScope = fullAdderRecord() as {
    content: { signoffs: unknown[] };
  };
  disjointScope.content.signoffs = [
    {
      id: "disjoint-signoff",
      status: "accepted",
      authorityKind: "external-human",
      authenticity: "caller-reported-unverified",
      claimIds: [],
      artifactIds: ["static-report"],
      evidenceIds: ["vector-result"],
      acceptedRiskIds: [],
      conditions: [],
      scopeStatement:
        "This deliberately mismatched scope must not validate.",
    },
  ];
  expectErrorCode(disjointScope, "signoff-evidence-locus");
});

test("a structurally valid record may honestly carry a failing engineering verdict", () => {
  const failed = fullAdderRecord() as {
    content: {
      activities: Array<{ id: string; outcome: string }>;
      claims: Array<{ id: string; verdict: string }>;
      evidence: Array<{ id: string; outcome: string }>;
    };
  };
  failed.content.activities.find(
    (item) => item.id === "vector-check",
  )!.outcome = "fail";
  failed.content.evidence.find(
    (item) => item.id === "vector-result",
  )!.outcome = "fail";
  failed.content.claims.find(
    (item) => item.id === "full-adder-correct",
  )!.verdict = "fail";
  const result = validateAndSealRunRecord(failed);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(
    result.record?.content.claims.find(
      (item) => item.id === "full-adder-correct",
    )?.verdict,
    "fail",
  );
});

test("the schema Resource documents bounds, parser limits, and trust boundaries", () => {
  const resource = runRecordSchemaResource() as {
    recordVersion: string;
    jsonSchema: { type?: string };
    compatibility: {
      claimEvidenceKinds: Record<string, string[]>;
      evidenceActivityKinds: Record<string, string[]>;
      knownOperationEvidenceKinds: Record<string, string[]>;
      observationAuthenticity: Record<string, string>;
      oracleIndependence: Record<string, string>;
      verdictSubjectArtifactRoles: string[];
    };
    bounds: {
      intentItemsPerCollection: number;
      lineageParents: number;
    };
    digestScopes: Record<string, string>;
    parserBoundary: string;
    trustBoundary: string;
  };
  assert.equal(resource.recordVersion, RUN_RECORD_VERSION);
  assert.equal(resource.jsonSchema.type, "object");
  assert.match(resource.digestScopes.evidenceDigest!, /content only/u);
  assert.match(resource.parserBoundary, /duplicate keys/iu);
  assert.match(resource.trustBoundary, /unsigned-unverified/u);
  assert.match(resource.trustBoundary, /do not prove authorship/u);
  assert.deepEqual(
    resource.compatibility.knownOperationEvidenceKinds[
      "logisim_analyze_design"
    ],
    ["static-analysis"],
  );
  assert.deepEqual(
    resource.compatibility.knownOperationEvidenceKinds[
      "logisim_run_test_vector"
    ],
    ["test-vector"],
  );
  assert.ok(
    resource.compatibility.evidenceActivityKinds["test-vector"]?.includes(
      "simulation",
    ),
  );
  assert.ok(
    resource.compatibility.claimEvidenceKinds.functional?.includes(
      "test-vector",
    ),
  );
  assert.equal(
    resource.compatibility.observationAuthenticity["caller-reported"],
    "caller-reported-unverified",
  );
  assert.equal(
    Object.keys(
      resource.compatibility.knownOperationEvidenceKinds,
    ).length,
    23,
  );
  assert.ok(
    resource.compatibility.verdictSubjectArtifactRoles.includes(
      "logic-circuit",
    ),
  );
  assert.match(
    resource.compatibility.oracleIndependence.expectedSpecification!,
    /distinct artifact identity and SHA-256 value/u,
  );
  assert.equal(resource.bounds.lineageParents, 32);
  assert.equal(resource.bounds.intentItemsPerCollection, 128);
});

test("the packaged examples preserve plans and an honest reported failure", async () => {
  for (const path of [
    "examples/run-records/logisim-full-adder-plan.json",
    "examples/run-records/asic-flow-template.json",
  ]) {
    const result = validateAndSealSerializedRunRecord(
      await readFile(path, "utf8"),
    );
    assert.equal(result.valid, true, `${path}: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.record);
    assert.ok(
      result.record.content.activities.every(
        (activity) => activity.executionStatus === "not-attempted",
      ),
    );
    assert.ok(
      result.record.content.claims.every(
        (claim) =>
          claim.verdict === "not-assessed" && claim.evidenceIds.length === 0,
      ),
    );
  }

  const reportedFailure = validateAndSealSerializedRunRecord(
    await readFile(
      "examples/run-records/logisim-full-adder-reported-failure.json",
      "utf8",
    ),
  );
  assert.equal(
    reportedFailure.valid,
    true,
    JSON.stringify(reportedFailure.diagnostics),
  );
  assert.equal(reportedFailure.record?.recordStatus, "closed");
  assert.equal(
    reportedFailure.record?.content.activities[0]?.executionStatus,
    "reported-only",
  );
  assert.equal(
    reportedFailure.record?.content.claims[0]?.verdict,
    "fail",
  );
  assert.equal(
    reportedFailure.record?.content.claims[0]?.basis,
    "reported-evidence",
  );

  assert.equal(
    sha256Bytes(await readFile("examples/logisim/full-adder.circ")),
    PROJECT_DIGEST,
  );
  assert.equal(
    sha256Bytes(await readFile("examples/logisim/full-adder.vec")),
    VECTOR_DIGEST,
  );
});
