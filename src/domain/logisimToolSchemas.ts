import { z } from "zod";

export const MAX_LOGISIM_PUBLIC_STRING_CHARACTERS = 4_096;
const PublicStringSchema = z
  .string()
  .max(MAX_LOGISIM_PUBLIC_STRING_CHARACTERS);

const BoundsSchema = z.object({
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  truncated: z.boolean(),
});

const PointSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

const ArtifactSchema = z.object({
  ref: PublicStringSchema,
  format: z.literal("logisim-circ"),
  mediaType: z.literal("application/xml"),
  bytes: z.number().int().nonnegative(),
  digest: PublicStringSchema,
  sourceVersion: PublicStringSchema.nullable(),
  fileFormatVersion: PublicStringSchema.nullable(),
  mainCircuit: PublicStringSchema.nullable(),
});

const RuntimeEvidenceSchema = z.object({
  engine: z.literal("Logisim-evolution"),
  version: PublicStringSchema,
  buildId: PublicStringSchema,
  buildDate: PublicStringSchema,
  javaRuntime: PublicStringSchema,
  javaVendor: PublicStringSchema,
  invocation: z.literal("local-jar-subprocess"),
  authenticity: z.literal("self-reported-unverified"),
});

const RuntimeSafetySchema = z.object({
  assessmentVersion: z.literal("logisim.runtime-safety/0.1"),
  safe: z.boolean(),
  reasonOccurrenceCount: z.number().int().nonnegative(),
  reasons: z.array(
    z.object({
      code: z.enum([
        "source-version-not-matched",
        "external-library-descriptor",
        "vhdl-project-section",
        "unexpected-element",
        "unexpected-attribute",
        "malformed-modeled-element",
        "file-path-attribute",
        "unsafe-path-attribute",
        "forbidden-runtime-library-component",
        "forbidden-telnet-component",
      ]),
      count: z.number().int().positive(),
    }),
  ),
  reasonBounds: BoundsSchema,
});

const IrLossSchema = z.object({
  code: PublicStringSchema,
  path: PublicStringSchema,
  impact: z.enum(["metadata", "topology", "behavior", "simulation"]),
  message: PublicStringSchema,
  count: z.number().int().positive(),
});

const PinSummarySchema = z.object({
  circuitName: PublicStringSchema,
  circuitFound: z.boolean(),
  pinCount: z.number().int().nonnegative(),
  inputPinCount: z.number().int().nonnegative(),
  outputPinCount: z.number().int().nonnegative(),
  inoutPinCount: z.number().int().nonnegative(),
  unknownDirectionPinCount: z.number().int().nonnegative(),
  inputBitTotal: z.number().int().nonnegative(),
  inputBitTotalComplete: z.boolean(),
  pins: z.array(
    z.object({
      componentId: PublicStringSchema,
      label: PublicStringSchema.nullable(),
      direction: z.enum(["input", "output", "inout", "unknown"]),
      width: z.number().int().positive().nullable(),
      location: PointSchema.nullable(),
    }),
  ),
  pinBounds: BoundsSchema,
});

export const LogisimWorkspaceDataSchema = z.object({
  listingVersion: z.literal("logisim.workspace/0.1"),
  rootRef: z.literal("."),
  dirRef: PublicStringSchema,
  recursive: z.boolean(),
  scan: z.object({
    scannedEntries: z.number().int().nonnegative(),
    scanTruncated: z.boolean(),
  }),
  entries: z.array(
    z.object({
      ref: PublicStringSchema,
      bytes: z.number().int().nonnegative(),
      mtime: PublicStringSchema,
      digest: PublicStringSchema.optional(),
      digestOmittedReason: z
        .enum([
          "file-exceeds-size-limit",
          "not-requested",
          "unreadable",
          "digest-budget-exhausted",
        ])
        .optional(),
    }),
  ),
  entryBounds: BoundsSchema,
});

export const LogisimAnalysisDataSchema = z.object({
  analysisVersion: z.literal("logisim.analysis/0.1"),
  project: ArtifactSchema,
  source: z.object({
    sourceVersion: PublicStringSchema.nullable(),
    fileFormatVersion: PublicStringSchema.nullable(),
    mainCircuitName: PublicStringSchema.nullable(),
    compatibility: z.enum([
      "version-matched",
      "different-logisim-version",
      "source-version-missing",
    ]),
  }),
  counts: z.object({
    libraries: z.number().int().nonnegative(),
    circuits: z.number().int().nonnegative(),
    components: z.number().int().nonnegative(),
    wires: z.number().int().nonnegative(),
    pins: z.number().int().nonnegative(),
    clocks: z.number().int().nonnegative(),
    unknownComponents: z.number().int().nonnegative(),
    unknownConstructs: z.number().int().nonnegative(),
  }),
  circuits: z.array(
    z.object({
      id: PublicStringSchema,
      name: PublicStringSchema,
      componentCount: z.number().int().nonnegative(),
      wireCount: z.number().int().nonnegative(),
      clockCount: z.number().int().nonnegative(),
      unknownComponentCount: z.number().int().nonnegative(),
      pinSummary: PinSummarySchema,
      componentTypes: z.array(
        z.object({
          name: PublicStringSchema,
          count: z.number().int().positive(),
        }),
      ),
      componentTypeBounds: BoundsSchema,
    }),
  ),
  circuitBounds: BoundsSchema,
  libraries: z.array(
    z.object({
      id: PublicStringSchema,
      descriptor: PublicStringSchema,
      external: z.boolean(),
    }),
  ),
  libraryBounds: BoundsSchema,
  unknownConstructs: z.object({
    totalCount: z.number().int().nonnegative(),
    samples: z.array(
      z.object({
        path: PublicStringSchema,
        elementName: PublicStringSchema,
        reason: PublicStringSchema,
        count: z.number().int().positive(),
      }),
    ),
    sampleLimit: z.number().int().positive(),
    samplesTruncated: z.boolean(),
  }),
  runtimeSafety: RuntimeSafetySchema,
  neutralIr: z.object({
    irVersion: z.literal("circuitarium.project-ir/0.1"),
    completeness: z.enum(["complete", "partial"]),
    losses: z.array(IrLossSchema),
    lossBounds: BoundsSchema,
  }),
  limitations: z.array(PublicStringSchema),
});

const NetMemberSchema = z.object({
  componentId: PublicStringSchema,
  portId: PublicStringSchema,
  direction: z.enum(["input", "output", "inout", "unknown"]),
  width: z.number().int().positive().nullable(),
  confidence: z.enum(["declared", "format-inferred", "unknown"]),
});

export const LogisimNetlistDataSchema = z.object({
  netlistVersion: z.literal("circuitarium.netlist-ir/0.1"),
  project: ArtifactSchema,
  circuit: z.object({
    id: PublicStringSchema,
    name: PublicStringSchema,
  }),
  topologyMode: z.literal("coordinate-endpoints"),
  completeness: z.literal("partial"),
  nets: z.array(
    z.object({
      id: PublicStringSchema,
      nodes: z.array(PointSchema),
      nodeBounds: BoundsSchema,
      wireIds: z.array(PublicStringSchema),
      wireBounds: BoundsSchema,
      members: z.array(NetMemberSchema),
      memberBounds: BoundsSchema,
    }),
  ),
  page: z.object({
    returned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    nextCursor: PublicStringSchema.optional(),
  }),
  losses: z.array(IrLossSchema),
  lossBounds: BoundsSchema,
  limitations: z.array(PublicStringSchema),
});

export const LogisimComponentStatsDataSchema = z.object({
  statisticsVersion: z.literal("logisim.statistics/0.1"),
  project: ArtifactSchema,
  circuitName: PublicStringSchema,
  runtime: RuntimeEvidenceSchema,
  components: z.array(
    z.object({
      uniqueCount: z.number().int().nonnegative(),
      recursiveCount: z.number().int().nonnegative(),
      component: PublicStringSchema,
      library: PublicStringSchema.nullable(),
    }),
  ),
  componentBounds: BoundsSchema,
  totalWithoutSubcircuits: z.object({
    uniqueCount: z.number().int().nonnegative(),
    recursiveCount: z.number().int().nonnegative(),
  }),
  totalWithSubcircuits: z.object({
    uniqueCount: z.number().int().nonnegative(),
    recursiveCount: z.number().int().nonnegative(),
  }),
  evidence: z.object({
    kind: z.literal("logisim-project-load"),
    proves: z.array(PublicStringSchema),
    doesNotProve: z.array(PublicStringSchema),
  }),
});

export const LogisimTruthTableDataSchema = z.object({
  truthTableVersion: z.literal("logisim.truth-table/0.1"),
  project: ArtifactSchema,
  circuitName: PublicStringSchema,
  runtime: RuntimeEvidenceSchema,
  inputs: z.object({
    pinCount: z.number().int().nonnegative(),
    bitTotal: z.number().int().nonnegative(),
    bitLimit: z.number().int().positive(),
  }),
  columns: z.array(PublicStringSchema),
  rows: z.array(z.object({ values: z.array(PublicStringSchema) })),
  rowBounds: BoundsSchema,
  valueEncoding: z.literal("binary"),
  delimiter: z.literal("comma"),
  evidence: z.object({
    kind: z.literal("logisim-headless-simulation"),
    proves: z.array(PublicStringSchema),
    doesNotProve: z.array(PublicStringSchema),
  }),
});

export const LogisimTestVectorDataSchema = z.object({
  testVectorVersion: z.literal("logisim.test-vector/0.1"),
  project: ArtifactSchema,
  vector: z.object({
    ref: PublicStringSchema,
    bytes: z.number().int().nonnegative(),
    digest: PublicStringSchema,
  }),
  circuitName: PublicStringSchema,
  runtime: RuntimeEvidenceSchema,
  valid: z.boolean(),
  passedVectors: z.number().int().nonnegative(),
  failedVectors: z.number().int().nonnegative(),
  totalVectors: z.number().int().nonnegative(),
  declaredVectors: z.number().int().nonnegative().nullable(),
  failures: z.array(
    z.object({
      vectorIndex: z.number().int().positive(),
      mismatches: z.array(
        z.object({
          vectorIndex: z.number().int().positive(),
          signal: PublicStringSchema,
          observed: PublicStringSchema,
          expected: PublicStringSchema,
          oscillating: z.boolean(),
        }),
      ),
      mismatchBounds: BoundsSchema,
    }),
  ),
  failureBounds: BoundsSchema,
  evidence: z.object({
    kind: z.literal("logisim-headless-simulation"),
    proves: z.array(PublicStringSchema),
    doesNotProve: z.array(PublicStringSchema),
  }),
});
