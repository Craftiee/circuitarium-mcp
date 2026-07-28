import { z } from "zod";

import {
  CRUMB_COMPONENT_CHANGE_FIELDS,
  CRUMB_ROOT_CHANGE_FIELDS,
} from "../adapters/crumb/compare.js";
import { CRUMB_EVIDENCE_CONFIDENCE_VALUES } from "../adapters/crumb/evidence.js";
import { CRUMB_FIXTURE_KINDS } from "../adapters/crumb/fixtures.js";
import {
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
  MAX_DIAGNOSTIC_SAMPLES_RETURNED,
  MAX_KIND_COUNTS_RETURNED,
  MAX_PARAMETER_COLLECTION_ITEMS_RETURNED,
  MAX_RESULT_DIAGNOSTICS_RETURNED,
} from "./bounds.js";

const BoundedCollectionInfoSchema = z.object({
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  truncated: z.boolean(),
});

const BoundedTextInfoSchema = z.object({
  characters: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  trust: z.literal("untrusted-user-authored"),
  preview: z.string().max(MAX_DESIGN_NAME_PREVIEW_CHARACTERS),
  previewCharacters: z.number().int().nonnegative(),
  previewTruncated: z.boolean(),
  fullContentIncluded: z.boolean(),
  blank: z.boolean(),
});

export const BackendOperationsSchema = z.object({
  inspect: z.boolean(),
  validate: z.boolean(),
  build: z.boolean(),
  convert: z.boolean(),
  liveSessions: z.boolean(),
  observeSignals: z.boolean(),
  stimulateInputs: z.boolean(),
});

export const CompatibilityProfileDescriptorSchema = z.object({
  compatibilityProfile: z.string(),
  status: z.enum(["tested", "experimental", "planned"]),
  product: z.string(),
  productVersion: z.string(),
  distribution: z.object({
    channel: z.string(),
    buildId: z.string().optional(),
  }),
  engine: z.object({
    family: z.string(),
    version: z.string().optional(),
  }),
  evidence: z.object({
    basis: z.enum([
      "controlled-installed-build-observation",
      "official-documentation",
      "inferred",
    ]),
    automaticFileFormatDetection: z.boolean(),
    limitation: z.string(),
  }),
});

export const IntegrationFamilyDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  expansion: z.string(),
  targetProduct: z.string(),
  scope: z.string(),
  status: z.enum(["available", "experimental", "planned"]),
});

export const BackendRuntimeDescriptorSchema = z.object({
  status: z.enum([
    "available",
    "unconfigured",
    "unavailable",
    "version-mismatch",
  ]),
  requiredForTools: z.array(z.string()),
  configuration: z.object({
    jarEnvironment: z.string(),
    javaEnvironment: z.string(),
    javaRequirement: z.string(),
  }),
  detected: z
    .object({
      simulatorVersion: z.string(),
      javaRuntime: z.string().optional(),
      javaVendor: z.string().optional(),
    })
    .optional(),
});

export const BackendDescriptorSchema = z.object({
  backendId: z.string(),
  label: z.string(),
  availability: z.enum(["callable", "external-companion", "planned"]),
  locality: z.enum(["local", "cloud", "hybrid"]),
  sessionScope: z.enum(["none", "process", "remote-service"]),
  dataLeavesMachine: z.union([z.boolean(), z.literal("depends")]),
  formats: z.array(z.string()),
  operations: BackendOperationsSchema,
  limitations: z.array(z.string()),
  runtime: BackendRuntimeDescriptorSchema.optional(),
  integrationFamily: IntegrationFamilyDescriptorSchema.optional(),
  compatibilityProfiles: z
    .array(CompatibilityProfileDescriptorSchema)
    .optional(),
});

export const CallableBackendDescriptorSchema = BackendDescriptorSchema.extend({
  availability: z.literal("callable"),
  integrationFamily: IntegrationFamilyDescriptorSchema,
});

export const WorkflowDescriptorSchema = z.object({
  id: z.string(),
  goal: z.string(),
  steps: z.array(
    z.object({
      tool: z.string(),
      reason: z.string(),
      exampleArguments: z.record(z.string(), z.json()),
    }),
  ),
});

export const CapabilitiesDataSchema = z.object({
  server: z.object({
    name: z.string(),
    version: z.string(),
    transport: z.literal("stdio"),
    contractVersion: z.string(),
    crossModelHandoff: z.literal("artifact-ref-and-digest"),
    sharedSessionsAcrossHosts: z.literal(false),
  }),
  filesystem: z.object({
    rootRef: z.literal("."),
    pathStyle: z.literal("workspace-relative-posix"),
    maxCruBytes: z.number().int().positive(),
    maxCruComparisonBytes: z.number().int().positive(),
    writesOverwriteExistingFiles: z.literal(false),
  }),
  portableExperiment: z.object({
    schemaVersion: z.literal("0.1"),
    concerns: z.array(z.string()),
    fidelityLevels: z.array(z.string()),
    validationTool: z.literal("electronics_validate_experiment"),
  }),
  callableBackends: z.array(CallableBackendDescriptorSchema),
  roadmapBackends: z.array(BackendDescriptorSchema),
  workflows: z.array(WorkflowDescriptorSchema),
  vocabulary: z.array(
    z.object({
      term: z.string(),
      meaning: z.string(),
    }),
  ),
  knowledgeSurfaces: z.object({
    resources: z.array(z.string()),
    prompts: z.array(z.string()),
    resourcesAreStatic: z.literal(true),
    liveAvailabilityTool: z.literal("electronics_capabilities"),
  }),
  toolConventions: z.object({
    validationFailureIsToolError: z.literal(false),
    paginationCursorIsOpaque: z.literal(true),
    embeddedSourceReturnedByDefault: z.literal(false),
    embeddedBinaryReturnedByDefault: z.literal(false),
    rawCruXmlReturnedByDefault: z.literal(false),
    callCapabilitiesWhenUnsure: z.literal(true),
  }),
});

export const ExperimentValidationDataSchema = z.object({
  valid: z.boolean(),
  schemaVersion: z.string().optional(),
  projectDigest: z.string().optional(),
  counts: z
    .object({
      components: z.number().int().nonnegative(),
      nets: z.number().int().nonnegative(),
      firmware: z.number().int().nonnegative(),
      probes: z.number().int().nonnegative(),
      assertions: z.number().int().nonnegative(),
    })
    .optional(),
});

const KnowledgeConfidenceSchema = z.enum([
  "controlled",
  "installed-build",
  "official-example",
  "inferred",
  "unknown",
]);

const ElectricalRoleSchema = z.enum([
  "structure",
  "interconnect",
  "passive",
  "semiconductor",
  "programmable",
  "source",
  "annotation",
  "unknown",
]);

export const CrumbCatalogDefinitionSchema = z.object({
  toolId: z.number().int().nonnegative(),
  kind: z.string(),
  label: z.string(),
  role: ElectricalRoleSchema,
  confidence: KnowledgeConfidenceSchema,
  expectedDataTypes: z.array(z.string()),
  alternateDataTypes: z.array(z.array(z.string())).optional(),
  readSupport: z.enum(["full", "partial"]),
  writeSupport: z.enum(["verified-fixture", "none"]),
  terminalNames: z.array(z.string()).optional(),
  parameterFields: z.array(
    z.object({
      valueIndex: z.number().int().nonnegative(),
      name: z.string(),
      unit: z.string().optional(),
      confidence: KnowledgeConfidenceSchema,
      description: z.string().optional(),
    }),
  ),
  notes: z.array(z.string()),
});

export const CrumbEvidenceVocabularyEntrySchema = z.object({
  confidence: z.enum(CRUMB_EVIDENCE_CONFIDENCE_VALUES),
  label: z.string().min(1),
  meaning: z.string().min(1),
  sourceAndRedistributionBoundary: z.string().min(1),
  limitation: z.string().min(1),
});

export const CrumbIcVariantSchema = z.object({
  prefabId: z.number().int().nonnegative(),
  label: z.string(),
  packageName: z.string(),
  packagePinCount: z.number().int().positive(),
  pins: z.array(
    z.object({
      packagePin: z.number().int().positive(),
      name: z.string().nullable(),
      sourceName: z.string(),
    }),
  ),
  pinNameCoverage: z.object({
    status: z.enum(["complete", "partial", "unresolved"]),
    resolved: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  }),
  confidence: z.enum([
    "installed-build-extracted",
    "installed-build-partial",
  ]),
  sourceNote: z.string(),
});

export const CrumbCatalogDataSchema = z.object({
  catalogVersion: z.literal("crumb.catalog/0.2"),
  backendId: z.literal("crumb.file"),
  testedCompatibility: z.array(z.string()),
  evidenceVocabulary: z.array(CrumbEvidenceVocabularyEntrySchema),
  requestedToolId: z.number().int().nonnegative().optional(),
  matched: z.boolean(),
  definitionCount: z.number().int().nonnegative(),
  definitions: z.array(CrumbCatalogDefinitionSchema),
  icVariants: z.array(CrumbIcVariantSchema).optional(),
});

export const CrumbIcReferenceDataSchema = z.object({
  referenceVersion: z.literal("crumb.ic-reference/0.1"),
  backendId: z.literal("crumb.file"),
  catalogTarget: z.object({
    gameVersion: z.string(),
    steamBuildId: z.string(),
    engineVersion: z.string(),
    il2CppMetadataVersion: z.string(),
    toolId: z.number().int().nonnegative(),
  }),
  requestedPrefabId: z.number().int().nonnegative().optional(),
  query: z.string().optional(),
  matched: z.boolean(),
  variantCount: z.number().int().nonnegative(),
  variants: z.array(CrumbIcVariantSchema),
});

export const CompactInspectionSchema = z.object({
  format: z.literal("crumb-cru"),
  name: z.string().max(MAX_DESIGN_NAME_PREVIEW_CHARACTERS),
  nameInfo: BoundedTextInfoSchema,
  componentCount: z.number().int().nonnegative(),
  toolCounts: z.record(z.string(), z.number().int().nonnegative()),
  toolCountBounds: BoundedCollectionInfoSchema,
  imageDataBytes: z.number().int().nonnegative(),
  imageDataFormat: z.enum(["none", "png", "unknown"]),
  settings: z.object({
    frequency: z.number().optional(),
    timeStep: z.number().optional(),
    throttling: z.boolean().optional(),
  }),
});

export const CrumbArtifactSchema = z.object({
  ref: z.string().optional(),
  format: z.literal("crumb-cru"),
  mediaType: z.literal("application/vnd.crumb.cru+xml"),
  bytes: z.number().int().nonnegative(),
  digest: z.string(),
  adapterTestedCompatibility: z.array(z.string()),
});

export const CrumbInspectionDataSchema = z.object({
  project: CrumbArtifactSchema.extend({ ref: z.string() }),
  inspection: CompactInspectionSchema,
});

export const CrumbValidationDataSchema = z.object({
  project: CrumbArtifactSchema.extend({ ref: z.string() }),
  valid: z.boolean(),
  inspection: CompactInspectionSchema.optional(),
});

const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const QuaternionSchema = z.object({
  w: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const CrumbAnalyzedParameterSchema = z.object({
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.boolean()).max(MAX_PARAMETER_COLLECTION_ITEMS_RETURNED),
  ]),
  confidence: KnowledgeConfidenceSchema,
  unit: z.string().optional(),
  description: z.string().optional(),
  encoding: z.object({
    payloadIndex: z.number().int().nonnegative(),
    xsiType: z.string(),
    lexical: z.string(),
  }),
  collectionBounds: BoundedCollectionInfoSchema.optional(),
});

export const CrumbAnalyzedComponentSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  toolId: z.number().int().nonnegative(),
  recognized: z.boolean(),
  recognitionStatus: z.enum(["recognized", "schema-mismatch", "unknown"]),
  kind: z.string(),
  label: z.string(),
  role: z.string(),
  confidence: KnowledgeConfidenceSchema,
  readSupport: z.enum(["full", "partial"]),
  writeSupport: z.enum(["verified-fixture", "none"]),
  payloadMatchesCatalog: z.boolean(),
  rawDataTypes: z
    .array(z.string())
    .max(MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED),
  rawDataTypeBounds: BoundedCollectionInfoSchema,
  parameters: z.record(z.string(), CrumbAnalyzedParameterSchema),
  terminals: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        name: z.string(),
        attachment: z.object({
          parentComponentId: z.string(),
          tiePointId: z.number().int(),
          attachmentKey: z.string(),
        }),
      }),
    )
    .max(MAX_COMPONENT_TERMINALS_RETURNED),
  terminalBounds: BoundedCollectionInfoSchema,
  position: Vector3Schema.optional(),
  rotation: QuaternionSchema.optional(),
  geometry: z
    .array(Vector3Schema)
    .max(MAX_COMPONENT_GEOMETRY_POINTS_RETURNED)
    .optional(),
  geometryBounds: BoundedCollectionInfoSchema.optional(),
  sourceCode: z
    .object({
      present: z.boolean(),
      characters: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      lines: z.number().int().nonnegative(),
      sha256: z.string(),
      languageHint: z.literal("c-cpp-or-arduino"),
      included: z.boolean(),
      content: z.string().optional(),
      returnedCharacters: z.number().int().nonnegative(),
      contentTruncated: z.boolean(),
      secondaryStringLength: z.number().int().nonnegative(),
    })
    .optional(),
  embeddedData: z
    .object({
      role: z.literal("eeprom-image"),
      present: z.literal(true),
      encoding: z.literal("xsd:base64Binary"),
      valid: z.boolean(),
      expectedBytes: z.literal(2048),
      bytes: z.number().int().nonnegative().optional(),
      sha256: z.string().optional(),
      contentIncluded: z.literal(false),
    })
    .optional(),
  annotation: z
    .object({
      present: z.boolean(),
      characters: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string(),
      trust: z.literal("untrusted-user-authored"),
      preview: z.string(),
      previewCharacters: z.number().int().nonnegative(),
      previewTruncated: z.boolean(),
      contentIncluded: z.literal(false),
    })
    .optional(),
  unknownPayloads: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        type: z.string(),
        keys: z
          .array(z.string())
          .max(MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED),
        keyBounds: BoundedCollectionInfoSchema,
      }),
    )
    .max(MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED),
  unknownPayloadBounds: BoundedCollectionInfoSchema,
  notes: z.array(z.string()),
  variant: z
    .object({
      prefabId: z.number().int().nonnegative(),
      label: z.string(),
      packageName: z.string(),
      packagePinCount: z.number().int().positive(),
      pinNameCoverage: z.enum(["complete", "partial", "unresolved"]),
    })
    .optional(),
});

export const CrumbConnectionGroupSchema = z.object({
  id: z.string(),
  physicalAttachments: z
    .array(
      z.object({
        attachmentKey: z.string(),
        parentComponentId: z.string(),
        tiePointId: z.number().int(),
      }),
    )
    .max(MAX_CONNECTION_GROUP_MEMBERS_RETURNED),
  componentTerminals: z
    .array(
      z.object({
        componentId: z.string(),
        componentKind: z.string(),
        terminal: z.string(),
      }),
    )
    .max(MAX_CONNECTION_GROUP_MEMBERS_RETURNED),
  explicitWireIds: z
    .array(z.string())
    .max(MAX_CONNECTION_GROUP_MEMBERS_RETURNED),
  membershipBounds: z.object({
    physicalAttachments: BoundedCollectionInfoSchema,
    componentTerminals: BoundedCollectionInfoSchema,
    explicitWireIds: BoundedCollectionInfoSchema,
    nonWireComponentTerminals: z.number().int().nonnegative(),
  }),
});

const AnalysisSummarySchema = z.object({
  componentCount: z.number().int().nonnegative(),
  recognizedComponentCount: z.number().int().nonnegative(),
  schemaMismatchComponentCount: z.number().int().nonnegative(),
  unknownComponentCount: z.number().int().nonnegative(),
  sourceCodeComponentCount: z.number().int().nonnegative(),
  embeddedDataComponentCount: z.number().int().nonnegative(),
  annotationComponentCount: z.number().int().nonnegative(),
  kindCounts: z
    .array(
      z.object({
        kind: z.string(),
        label: z.string(),
        toolId: z.number().int().nonnegative(),
        recognized: z.boolean(),
        recognitionStatus: z.enum(["recognized", "schema-mismatch", "unknown"]),
        count: z.number().int().positive(),
      }),
    )
    .max(MAX_KIND_COUNTS_RETURNED),
  kindCountBounds: BoundedCollectionInfoSchema,
});

const ConversionSummarySchema = z.object({
  portableDraftStatus: z.enum(["exact", "partial"]),
  safeForAutomaticConversion: z.boolean(),
  losses: z.array(
    z.object({
      category: z.enum([
        "unknown-component",
        "partial-component",
        "unresolved-topology",
      ]),
      message: z.string(),
      componentCount: z.number().int().nonnegative(),
      componentIdSample: z.array(z.string()),
      sampleTruncated: z.boolean(),
    }),
  ),
});

const PageSchema = z.object({
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});

export const CrumbAnalysisDataSchema = z.object({
  analysisVersion: z.literal("crumb.analysis/0.2"),
  view: z.enum(["summary", "components", "connections"]),
  project: CrumbArtifactSchema.extend({ ref: z.string() }),
  designName: z.string().max(MAX_DESIGN_NAME_PREVIEW_CHARACTERS),
  designNameInfo: BoundedTextInfoSchema,
  summary: AnalysisSummarySchema,
  connectivity: z.object({
    scope: z.enum([
      "physical-attachments-and-explicit-wires",
      "crumb-1.3.5-board-topology-and-explicit-wires",
    ]),
    confidence: z.enum(["partial", "version-pinned"]),
    topologyMode: z.enum(["direct-only", "known-board-v1.3.5"]),
    topologyLinksApplied: z.number().int().nonnegative(),
    groupCount: z.number().int().nonnegative(),
    isolatedAttachmentGroupCount: z.number().int().nonnegative(),
    limitations: z.array(z.string()),
  }),
  conversion: ConversionSummarySchema,
  page: PageSchema.optional(),
  components: z.array(CrumbAnalyzedComponentSchema).optional(),
  connections: z.array(CrumbConnectionGroupSchema).optional(),
  disclosure: z.object({
    geometryIncluded: z.boolean(),
    sourceCodeIncluded: z.boolean(),
    embeddedBinaryIncluded: z.literal(false),
    annotationTextMode: z.literal("untrusted-bounded-preview"),
    rawXmlIncluded: z.literal(false),
    limits: z.object({
      designNamePreviewCharacters: z.literal(
        MAX_DESIGN_NAME_PREVIEW_CHARACTERS,
      ),
      componentGeometryPoints: z.literal(
        MAX_COMPONENT_GEOMETRY_POINTS_RETURNED,
      ),
      componentTerminals: z.literal(MAX_COMPONENT_TERMINALS_RETURNED),
      componentPayloadEntries: z.literal(
        MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
      ),
      parameterCollectionItems: z.literal(
        MAX_PARAMETER_COLLECTION_ITEMS_RETURNED,
      ),
      connectionGroupMembersPerField: z.literal(
        MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
      ),
      kindCounts: z.literal(MAX_KIND_COUNTS_RETURNED),
      diagnostics: z.literal(MAX_RESULT_DIAGNOSTICS_RETURNED),
      diagnosticCodeCharacters: z.literal(
        MAX_DIAGNOSTIC_CODE_CHARACTERS,
      ),
      diagnosticPathCharacters: z.literal(
        MAX_DIAGNOSTIC_PATH_CHARACTERS,
      ),
      diagnosticMessageCharacters: z.literal(
        MAX_DIAGNOSTIC_MESSAGE_CHARACTERS,
      ),
      cruXsiTypeCharacters: z.literal(MAX_CRU_XSI_TYPE_CHARACTERS),
      cruNumericLexicalCharacters: z.literal(
        MAX_CRU_NUMERIC_LEXICAL_CHARACTERS,
      ),
      cruGuidTokenCharacters: z.literal(
        MAX_CRU_GUID_TOKEN_CHARACTERS,
      ),
      cruXmlNameCharacters: z.literal(MAX_CRU_XML_NAME_CHARACTERS),
      cruXmlElements: z.literal(MAX_CRU_XML_ELEMENTS),
      cruXmlDepth: z.literal(MAX_CRU_XML_DEPTH),
      cruComponents: z.literal(MAX_CRU_COMPONENTS),
      cruDataValuesPerComponent: z.literal(
        MAX_CRU_DATA_VALUES_PER_COMPONENT,
      ),
    }),
  }),
});

const StrictBoundedCollectionInfoSchema =
  BoundedCollectionInfoSchema.strict();
const StrictBoundedTextInfoSchema = BoundedTextInfoSchema.strict();
const StrictVector3Schema = Vector3Schema.strict();
const StrictQuaternionSchema = QuaternionSchema.strict();
const CrumbComparisonArtifactSchema = CrumbArtifactSchema.extend({
  ref: z.string(),
}).strict();
const CrumbComparisonParameterSchema = CrumbAnalyzedParameterSchema.extend({
  encoding: z
    .object({
      payloadIndex: z.number().int().nonnegative(),
      xsiType: z.string(),
      lexical: z.string(),
    })
    .strict(),
  collectionBounds: StrictBoundedCollectionInfoSchema.optional(),
}).strict();
const CrumbComparisonComponentSchema = CrumbAnalyzedComponentSchema.extend({
  rawDataTypeBounds: StrictBoundedCollectionInfoSchema,
  parameters: z.record(z.string(), CrumbComparisonParameterSchema),
  terminals: z
    .array(
      z
        .object({
          index: z.number().int().nonnegative(),
          name: z.string(),
          attachment: z
            .object({
              parentComponentId: z.string(),
              tiePointId: z.number().int(),
              attachmentKey: z.string(),
            })
            .strict(),
        })
        .strict(),
    )
    .max(MAX_COMPONENT_TERMINALS_RETURNED),
  terminalBounds: StrictBoundedCollectionInfoSchema,
  position: StrictVector3Schema.optional(),
  rotation: StrictQuaternionSchema.optional(),
  geometry: z
    .array(StrictVector3Schema)
    .max(MAX_COMPONENT_GEOMETRY_POINTS_RETURNED)
    .optional(),
  geometryBounds: StrictBoundedCollectionInfoSchema.optional(),
  sourceCode: z
    .object({
      present: z.boolean(),
      characters: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      lines: z.number().int().nonnegative(),
      sha256: z.string(),
      languageHint: z.literal("c-cpp-or-arduino"),
      included: z.literal(false),
      returnedCharacters: z.literal(0),
      contentTruncated: z.literal(false),
      secondaryStringLength: z.number().int().nonnegative(),
    })
    .strict()
    .optional(),
  embeddedData: z
    .object({
      role: z.literal("eeprom-image"),
      present: z.literal(true),
      encoding: z.literal("xsd:base64Binary"),
      valid: z.boolean(),
      expectedBytes: z.literal(2048),
      bytes: z.number().int().nonnegative().optional(),
      sha256: z.string().optional(),
      contentIncluded: z.literal(false),
    })
    .strict()
    .optional(),
  annotation: z
    .object({
      present: z.boolean(),
      characters: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string(),
      trust: z.literal("untrusted-user-authored"),
      preview: z.string().max(MAX_DESIGN_NAME_PREVIEW_CHARACTERS),
      previewCharacters: z
        .number()
        .int()
        .min(0)
        .max(MAX_DESIGN_NAME_PREVIEW_CHARACTERS),
      previewTruncated: z.boolean(),
      contentIncluded: z.literal(false),
    })
    .strict()
    .optional(),
  unknownPayloads: z
    .array(
      z
        .object({
          index: z.number().int().nonnegative(),
          type: z.string(),
          keys: z
            .array(z.string())
            .max(MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED),
          keyBounds: StrictBoundedCollectionInfoSchema,
        })
        .strict(),
    )
    .max(MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED),
  unknownPayloadBounds: StrictBoundedCollectionInfoSchema,
  variant: z
    .object({
      prefabId: z.number().int().nonnegative(),
      label: z.string(),
      packageName: z.string(),
      packagePinCount: z.number().int().positive(),
      pinNameCoverage: z.enum(["complete", "partial", "unresolved"]),
    })
    .strict()
    .optional(),
}).strict();

const CrumbProfileAssessmentSchema = z
  .object({
    status: z.enum(["consistent-with-observed-profile", "inconclusive"]),
    componentCount: z.number().int().nonnegative(),
    recognizedComponentCount: z.number().int().nonnegative(),
    schemaMismatchComponentCount: z.number().int().nonnegative(),
    unknownComponentCount: z.number().int().nonnegative(),
  })
  .strict();

const CrumbRootObservationSchema = z
  .object({
    name: StrictBoundedTextInfoSchema,
    componentCount: z.number().int().nonnegative(),
    thumbnail: z
      .object({
        bytes: z.number().int().nonnegative(),
        format: z.enum(["none", "png", "unknown"]),
        digest: z.string().optional(),
        contentIncluded: z.literal(false),
      })
      .strict(),
    pivotPosition: StrictVector3Schema.optional(),
    pivotRotation: StrictVector3Schema.optional(),
    cameraPosition: StrictVector3Schema.optional(),
    frequency: z.number().optional(),
    timeStep: z.number().optional(),
    throttling: z.boolean().optional(),
  })
  .strict();

const CrumbComponentChangeSchema = z
  .object({
    componentId: z.string(),
    matchMethod: z.literal("guid"),
    change: z.enum(["added", "removed", "modified"]),
    changedFields: z
      .array(z.enum(CRUMB_COMPONENT_CHANGE_FIELDS))
      .max(CRUMB_COMPONENT_CHANGE_FIELDS.length),
    baselinePayloadDigest: z.string().optional(),
    candidatePayloadDigest: z.string().optional(),
    baseline: CrumbComparisonComponentSchema.optional(),
    candidate: CrumbComparisonComponentSchema.optional(),
  })
  .strict();

export const CrumbComparisonDataSchema = z
  .object({
    comparisonVersion: z.literal("crumb.compare/0.1"),
    view: z.enum(["summary", "root", "components"]),
    compatibilityProfile: z.literal("crumb.unity/1.3.5"),
    topologyMode: z.enum(["direct-only", "known-board-v1.3.5"]),
    baseline: CrumbComparisonArtifactSchema,
    candidate: CrumbComparisonArtifactSchema,
    equivalence: z
      .object({
        byteEquivalent: z.boolean(),
        modeledContentEquivalent: z.boolean(),
        modeledRepresentationEquivalent: z.boolean(),
        coverage: z.enum(["complete", "partial"]),
        assessment: z.enum(["exact", "modeled-only", "changed", "inconclusive"]),
      })
      .strict(),
    profileAssessment: z
      .object({
        automaticOriginDetection: z.literal(false),
        baseline: CrumbProfileAssessmentSchema,
        candidate: CrumbProfileAssessmentSchema,
      })
      .strict(),
    summary: z
      .object({
        rootFieldChangeCount: z.number().int().nonnegative(),
        addedComponentCount: z.number().int().nonnegative(),
        removedComponentCount: z.number().int().nonnegative(),
        modifiedComponentCount: z.number().int().nonnegative(),
        unchangedComponentCount: z.number().int().nonnegative(),
        parameterChangeCount: z.number().int().nonnegative(),
        attachmentChangeCount: z.number().int().nonnegative(),
        geometryChangeCount: z.number().int().nonnegative(),
        newToolIdCount: z.number().int().nonnegative(),
        newPayloadSignatureCount: z.number().int().nonnegative(),
        baselineConnectionGroupCount: z.number().int().nonnegative(),
        candidateConnectionGroupCount: z.number().int().nonnegative(),
      })
      .strict(),
    root: z
      .object({
        changedFields: z
          .array(z.enum(CRUMB_ROOT_CHANGE_FIELDS))
          .max(CRUMB_ROOT_CHANGE_FIELDS.length),
        baseline: CrumbRootObservationSchema,
        candidate: CrumbRootObservationSchema,
      })
      .strict()
      .optional(),
    page: PageSchema.strict().optional(),
    componentChanges: z.array(CrumbComponentChangeSchema).max(200).optional(),
    schemaCandidates: z
      .array(
        z
          .object({
            toolId: z.number().int().nonnegative(),
            payloadTypes: z
              .array(z.string())
              .max(MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED),
            payloadTypeBounds: StrictBoundedCollectionInfoSchema,
            occurrenceCount: z.number().int().positive(),
            status: z.literal("unverified-observation"),
          })
          .strict(),
      )
      .max(MAX_KIND_COUNTS_RETURNED),
    schemaCandidateBounds: StrictBoundedCollectionInfoSchema,
    disclosure: z
      .object({
        rawXmlIncluded: z.literal(false),
        sourceCodeIncluded: z.literal(false),
        embeddedBinaryIncluded: z.literal(false),
        thumbnailIncluded: z.literal(false),
        opaquePayloadContentIncluded: z.literal(false),
        userTextMode: z.literal("untrusted-bounded-preview-and-digest"),
        geometryIncluded: z.boolean(),
      })
      .strict(),
    limitations: z.array(z.string()).max(16),
  })
  .strict();

export const CrumbFixtureDataSchema = z.object({
  kind: z.enum(CRUMB_FIXTURE_KINDS),
  project: CrumbArtifactSchema,
  valid: z.boolean(),
  xml: z.string().optional(),
});

export const CrumbWorkspaceDataSchema = z.object({
  listingVersion: z.literal("crumb.workspace/0.1"),
  rootRef: z.literal("."),
  dirRef: z.string(),
  recursive: z.boolean(),
  scan: z.object({
    scannedEntries: z.number().int().nonnegative(),
    scanTruncated: z.boolean(),
  }),
  entries: z.array(
    z.object({
      ref: z.string(),
      bytes: z.number().int().nonnegative(),
      mtime: z.string(),
      digest: z.string().optional(),
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
  entryBounds: BoundedCollectionInfoSchema,
});

export const CrumbBomDataSchema = z.object({
  bomVersion: z.literal("crumb.bom/0.1"),
  project: CrumbArtifactSchema.extend({ ref: z.string() }),
  designName: z.string().max(MAX_DESIGN_NAME_PREVIEW_CHARACTERS),
  designNameInfo: BoundedTextInfoSchema,
  totals: z.object({
    components: z.number().int().nonnegative(),
    distinctLines: z.number().int().nonnegative(),
    recognized: z.number().int().nonnegative(),
    schemaMismatch: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  lines: z.array(
    z.object({
      toolId: z.number().int().nonnegative(),
      kind: z.string(),
      label: z.string(),
      recognitionStatus: z.enum(["recognized", "schema-mismatch", "unknown"]),
      variantLabel: z.string().optional(),
      identity: z.record(
        z.string(),
        z.object({
          value: z.union([z.string(), z.number(), z.boolean()]),
          unit: z.string().optional(),
        }),
      ),
      quantity: z.number().int().positive(),
      componentIdSample: z.array(z.string()).max(5),
      sampleTruncated: z.boolean(),
    }),
  ),
  lineBounds: BoundedCollectionInfoSchema,
});

export const CrumbComponentDetailDataSchema = z.object({
  detailVersion: z.literal("crumb.component/0.1"),
  project: CrumbArtifactSchema.extend({ ref: z.string() }),
  topologyMode: z.enum(["direct-only", "known-board-v1.3.5"]),
  component: CrumbAnalyzedComponentSchema,
  connections: z.array(CrumbConnectionGroupSchema).max(32),
  connectionBounds: BoundedCollectionInfoSchema,
  sourceWindow: z
    .object({
      offset: z.number().int().nonnegative(),
      totalCharacters: z.number().int().nonnegative(),
      returnedCharacters: z.number().int().nonnegative(),
      content: z.string(),
      truncated: z.boolean(),
      nextOffset: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const CrumbNetMemberSchema = z.object({
  componentId: z.string(),
  componentKind: z.string(),
  componentLabel: z.string(),
  componentRole: z.string(),
  terminal: z.string(),
});

const CrumbNetSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  nameSource: z.literal("dc-power-supply-terminal").optional(),
  connectionGroupIds: z
    .array(z.string())
    .max(MAX_CONNECTION_GROUP_MEMBERS_RETURNED),
  connectionGroupIdBounds: BoundedCollectionInfoSchema,
  members: z
    .array(CrumbNetMemberSchema)
    .max(MAX_CONNECTION_GROUP_MEMBERS_RETURNED),
  memberBounds: BoundedCollectionInfoSchema,
  wireIds: z.array(z.string()).max(MAX_CONNECTION_GROUP_MEMBERS_RETURNED),
  wireBounds: BoundedCollectionInfoSchema,
  mergedBySwitches: z
    .array(
      z.object({
        componentId: z.string(),
        componentKind: z.string(),
        closedPath: z.string(),
      }),
    )
    .max(MAX_CONNECTION_GROUP_MEMBERS_RETURNED),
  switchMergeBounds: BoundedCollectionInfoSchema,
});

export const CrumbNetlistDataSchema = z.object({
  netlistVersion: z.literal("crumb.netlist/0.1"),
  project: CrumbArtifactSchema.extend({ ref: z.string() }),
  topologyMode: z.enum(["direct-only", "known-board-v1.3.5"]),
  scope: z.enum([
    "physical-attachments-and-explicit-wires",
    "crumb-1.3.5-board-topology-and-explicit-wires",
  ]),
  provenance: z.object({
    topologyConfidence: z.enum(["partial", "version-pinned"]),
    switchSemanticsApplied: z.boolean(),
    switchSemanticsConfidence: z.literal("installed-build").optional(),
  }),
  stats: z.object({
    netCount: z.number().int().nonnegative(),
    namedNetCount: z.number().int().nonnegative(),
    wireCount: z.number().int().nonnegative(),
    floatingTerminalCount: z.number().int().nonnegative(),
    supplyCount: z.number().int().nonnegative(),
    switchMergesApplied: z.number().int().nonnegative(),
  }),
  page: PageSchema,
  nets: z.array(CrumbNetSchema),
  floatingTerminals: z
    .array(CrumbNetMemberSchema)
    .max(MAX_DIAGNOSTIC_SAMPLES_RETURNED),
  floatingTerminalBounds: BoundedCollectionInfoSchema,
});

export const CrumbErcDataSchema = z.object({
  ercVersion: z.literal("crumb.erc/0.1"),
  project: CrumbArtifactSchema.extend({ ref: z.string() }),
  valid: z.boolean(),
  topologyMode: z.enum(["direct-only", "known-board-v1.3.5"]),
  applySwitchStates: z.boolean(),
  ruleSet: z.array(z.string()),
  totals: z.object({
    findings: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
  }),
  findings: z.array(
    z.object({
      ruleId: z.string(),
      severity: z.enum(["error", "warning", "info"]),
      confidence: KnowledgeConfidenceSchema,
      basis: z.enum([
        "public-electronics-knowledge",
        "version-pinned-crumb-observation",
        "both",
      ]),
      message: z.string().max(MAX_DIAGNOSTIC_MESSAGE_CHARACTERS),
      netIds: z.array(z.string()).max(16),
      componentIds: z.array(z.string()).max(16),
    }),
  ),
  findingBounds: BoundedCollectionInfoSchema,
  limitations: z.array(z.string()),
});
