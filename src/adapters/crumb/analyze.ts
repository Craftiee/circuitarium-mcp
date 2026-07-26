import { createHash } from "node:crypto";

import {
  boundCollection,
  boundDiagnostics,
  describeUntrustedText,
  MAX_COMPONENT_GEOMETRY_POINTS_RETURNED,
  MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
  MAX_COMPONENT_TERMINALS_RETURNED,
  MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
  MAX_DIAGNOSTIC_SAMPLES_RETURNED,
  MAX_KIND_COUNTS_RETURNED,
  MAX_PARAMETER_COLLECTION_ITEMS_RETURNED,
  MAX_UNKNOWN_PAYLOAD_KEYS_RETURNED_PER_COMPONENT,
  type BoundedCollectionInfo,
  type BoundedTextInfo,
} from "../../domain/bounds.js";
import type { Diagnostic } from "../../domain/experiment.js";
import {
  getCrumbComponentDefinition,
  type CrumbComponentDefinition,
  type CrumbKnowledgeConfidence,
} from "./catalog.js";
import {
  decodeCru,
  type CruDecodedComponent,
  type CruDecodedDataValue,
  type CruDecodedDocument,
  type CruTiePoint,
  type Quaternion,
  type Vector3,
} from "./format.js";
import { getCrumbIcByPrefabId } from "./icCatalog.js";

export interface CrumbAnalysisOptions {
  includeGeometry?: boolean;
  includeSourceCode?: boolean;
  topologyMode?: "direct-only" | "known-board-v1.3.5";
}

export interface CrumbAnalyzedParameter {
  value: string | number | boolean | boolean[];
  confidence: CrumbKnowledgeConfidence;
  unit?: string;
  description?: string;
  encoding: {
    payloadIndex: number;
    xsiType: string;
    lexical: string;
  };
  collectionBounds?: BoundedCollectionInfo;
}

export interface CrumbTerminalAttachment {
  parentComponentId: string;
  tiePointId: number;
  attachmentKey: string;
}

export interface CrumbAnalyzedTerminal {
  index: number;
  name: string;
  attachment: CrumbTerminalAttachment;
}

export interface CrumbSourceCodeInfo {
  present: boolean;
  characters: number;
  bytes: number;
  lines: number;
  sha256: string;
  languageHint: "c-cpp-or-arduino";
  included: boolean;
  content?: string;
  returnedCharacters: number;
  contentTruncated: boolean;
  secondaryStringLength: number;
}

export interface CrumbEmbeddedDataInfo {
  role: "eeprom-image";
  present: true;
  encoding: "xsd:base64Binary";
  valid: boolean;
  expectedBytes: 2048;
  bytes?: number;
  sha256?: string;
  contentIncluded: false;
}

export interface CrumbAnnotationInfo {
  present: boolean;
  characters: number;
  bytes: number;
  sha256: string;
  trust: "untrusted-user-authored";
  preview: string;
  previewCharacters: number;
  previewTruncated: boolean;
  contentIncluded: false;
}

export interface CrumbAnalyzedComponent {
  id: string;
  index: number;
  toolId: number;
  recognized: boolean;
  recognitionStatus: "recognized" | "schema-mismatch" | "unknown";
  kind: string;
  label: string;
  role: string;
  confidence: CrumbKnowledgeConfidence;
  readSupport: "full" | "partial";
  writeSupport: "verified-fixture" | "none";
  payloadMatchesCatalog: boolean;
  rawDataTypes: string[];
  rawDataTypeBounds: BoundedCollectionInfo;
  parameters: Record<string, CrumbAnalyzedParameter>;
  terminals: CrumbAnalyzedTerminal[];
  terminalBounds: BoundedCollectionInfo;
  position?: Vector3;
  rotation?: Quaternion;
  geometry?: Vector3[];
  geometryBounds?: BoundedCollectionInfo;
  sourceCode?: CrumbSourceCodeInfo;
  embeddedData?: CrumbEmbeddedDataInfo;
  annotation?: CrumbAnnotationInfo;
  unknownPayloads: Array<{
    index: number;
    type: string;
    keys: string[];
    keyBounds: BoundedCollectionInfo;
  }>;
  unknownPayloadBounds: BoundedCollectionInfo;
  notes: string[];
  variant?: {
    prefabId: number;
    label: string;
    packageName: string;
    packagePinCount: number;
    pinNameCoverage: "complete" | "partial" | "unresolved";
  };
}

export interface CrumbConnectionGroup {
  id: string;
  physicalAttachments: Array<{
    attachmentKey: string;
    parentComponentId: string;
    tiePointId: number;
  }>;
  componentTerminals: Array<{
    componentId: string;
    componentKind: string;
    terminal: string;
  }>;
  explicitWireIds: string[];
  membershipBounds: {
    physicalAttachments: BoundedCollectionInfo;
    componentTerminals: BoundedCollectionInfo;
    explicitWireIds: BoundedCollectionInfo;
    nonWireComponentTerminals: number;
  };
}

export interface CrumbDesignAnalysis {
  analysisVersion: "crumb.analysis/0.2";
  format: "crumb-cru";
  designName: string;
  designNameInfo: BoundedTextInfo;
  projectDigest: string;
  adapterTestedCompatibility: string[];
  summary: {
    componentCount: number;
    recognizedComponentCount: number;
    schemaMismatchComponentCount: number;
    unknownComponentCount: number;
    sourceCodeComponentCount: number;
    embeddedDataComponentCount: number;
    annotationComponentCount: number;
    kindCounts: Array<{
      kind: string;
      label: string;
      toolId: number;
      recognized: boolean;
      recognitionStatus: "recognized" | "schema-mismatch" | "unknown";
      count: number;
    }>;
    kindCountBounds: BoundedCollectionInfo;
  };
  components: CrumbAnalyzedComponent[];
  connectivity: {
    scope:
      | "physical-attachments-and-explicit-wires"
      | "crumb-1.3.5-board-topology-and-explicit-wires";
    confidence: "partial" | "version-pinned";
    topologyMode: "direct-only" | "known-board-v1.3.5";
    topologyLinksApplied: number;
    groupCount: number;
    groups: CrumbConnectionGroup[];
    isolatedAttachmentGroupCount: number;
    limitations: string[];
  };
  conversion: {
    portableDraftStatus: "exact" | "partial";
    safeForAutomaticConversion: boolean;
    losses: Array<{
      category: "unknown-component" | "partial-component" | "unresolved-topology";
      message: string;
      componentIds: string[];
    }>;
  };
  diagnostics: Diagnostic[];
}

function sha256(value: string | Buffer): string {
  const hash = createHash("sha256");
  if (typeof value === "string") {
    hash.update(value, "utf8");
  } else {
    hash.update(value);
  }
  return `sha256:${hash.digest("hex")}`;
}

function normalizedType(type: string): string {
  return !type.startsWith("unresolved:") && /^[^:]+:guid$/.test(type)
    ? "guid"
    : type;
}

function matchesSignature(rawTypes: string[], signature: string[]): boolean {
  return (
    rawTypes.length === signature.length &&
    rawTypes.every(
      (type, index) => normalizedType(type) === signature[index],
    )
  );
}

function scalarValue(
  value: CruDecodedDataValue | undefined,
): string | number | boolean | undefined {
  if (
    value?.kind === "number" ||
    value?.kind === "boolean" ||
    value?.kind === "string"
  ) {
    return value.value;
  }
  return undefined;
}

function parameterValue(
  value: CruDecodedDataValue | undefined,
): string | number | boolean | boolean[] | undefined {
  const scalar = scalarValue(value);
  if (scalar !== undefined) {
    return scalar;
  }
  return value?.kind === "boolean-array" ? value.value : undefined;
}

function tiePointsOf(component: CruDecodedComponent): CruTiePoint[] {
  const value = component.values.find((entry) => entry.kind === "tie-point-array");
  return value?.kind === "tie-point-array" ? value.value : [];
}

function attachmentKey(tiePoint: CruTiePoint): string {
  return `${tiePoint.parentIdentifier.toLowerCase()}:${tiePoint.id}`;
}

function makeParameters(
  component: CruDecodedComponent,
  definition: CrumbComponentDefinition | undefined,
): Record<string, CrumbAnalyzedParameter> {
  if (!definition) {
    return {};
  }
  const parameters: Record<string, CrumbAnalyzedParameter> = {};
  for (const field of definition.parameterFields) {
    const dataValue = component.values[field.valueIndex];
    const decodedValue = parameterValue(dataValue);
    if (decodedValue === undefined) {
      continue;
    }
    const boundedCollection = Array.isArray(decodedValue)
      ? boundCollection(decodedValue, MAX_PARAMETER_COLLECTION_ITEMS_RETURNED)
      : undefined;
    const value = boundedCollection?.items ?? decodedValue;
    parameters[field.name] = {
      value,
      confidence: field.confidence,
      ...(field.unit === undefined ? {} : { unit: field.unit }),
      ...(field.description === undefined ? {} : { description: field.description }),
      encoding: {
        payloadIndex: field.valueIndex,
        xsiType: dataValue!.type,
        lexical:
          dataValue?.kind === "number" ||
          dataValue?.kind === "boolean" ||
          dataValue?.kind === "string"
            ? dataValue.lexical
            : JSON.stringify(value),
      },
      ...(boundedCollection === undefined
        ? {}
        : { collectionBounds: boundedCollection.bounds }),
    };
  }
  return parameters;
}

function makeTerminals(
  component: CruDecodedComponent,
  definition: CrumbComponentDefinition | undefined,
  terminalNames?: Array<string | null>,
): CrumbAnalyzedTerminal[] {
  return tiePointsOf(component).map((tiePoint, index) => ({
    index,
    name:
      terminalNames?.[index] ??
      definition?.terminalNames?.[index] ??
      `terminal-${index + 1}`,
    attachment: {
      parentComponentId: tiePoint.parentIdentifier,
      tiePointId: tiePoint.id,
      attachmentKey: attachmentKey(tiePoint),
    },
  }));
}

function sourceCodeInfo(
  component: CruDecodedComponent,
  includeSourceCode: boolean,
): CrumbSourceCodeInfo | undefined {
  if (component.toolId !== 20) {
    return undefined;
  }
  const strings = component.values.filter(
    (value): value is Extract<CruDecodedDataValue, { kind: "string" }> =>
      value.kind === "string",
  );
  const source = strings[0]?.value ?? "";
  const secondary = strings[1]?.value ?? "";
  const returnedSource = includeSourceCode ? source.slice(0, 65_536) : "";
  let lineCount = source.length === 0 ? 0 : 1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charCodeAt(index);
    if (character === 13) {
      lineCount += 1;
      if (source.charCodeAt(index + 1) === 10) {
        index += 1;
      }
    } else if (character === 10) {
      lineCount += 1;
    }
  }
  return {
    present: source.length > 0,
    characters: source.length,
    bytes: Buffer.byteLength(source, "utf8"),
    lines: lineCount,
    sha256: sha256(source),
    languageHint: "c-cpp-or-arduino",
    included: includeSourceCode,
    ...(includeSourceCode ? { content: returnedSource } : {}),
    returnedCharacters: returnedSource.length,
    contentTruncated: includeSourceCode && returnedSource.length < source.length,
    secondaryStringLength: secondary.length,
  };
}

function eepromDataInfo(
  value: CruDecodedDataValue | undefined,
): CrumbEmbeddedDataInfo | undefined {
  if (
    value?.kind !== "unknown" ||
    value.type !== "xsd:base64Binary" ||
    value.text === undefined
  ) {
    return undefined;
  }
  const encoded = value.text.replaceAll(/\s/g, "");
  const validEncoding =
    encoded.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    );
  if (!validEncoding) {
    return {
      role: "eeprom-image",
      present: true,
      encoding: "xsd:base64Binary",
      valid: false,
      expectedBytes: 2048,
      contentIncluded: false,
    };
  }
  const bytes = Buffer.from(encoded, "base64");
  return {
    role: "eeprom-image",
    present: true,
    encoding: "xsd:base64Binary",
    valid: bytes.length === 2048,
    expectedBytes: 2048,
    bytes: bytes.length,
    sha256: sha256(bytes),
    contentIncluded: false,
  };
}

function annotationInfo(
  component: CruDecodedComponent,
): CrumbAnnotationInfo | undefined {
  if (component.toolId !== 11) {
    return undefined;
  }
  const textValue = component.values[3];
  if (textValue?.kind !== "string") {
    return undefined;
  }
  const preview = textValue.value.slice(0, 160);
  return {
    present: textValue.value.length > 0,
    characters: textValue.value.length,
    bytes: Buffer.byteLength(textValue.value, "utf8"),
    sha256: sha256(textValue.value),
    trust: "untrusted-user-authored",
    preview,
    previewCharacters: preview.length,
    previewTruncated: preview.length < textValue.value.length,
    contentIncluded: false,
  };
}

interface AnalyzedComponentInternal {
  component: CrumbAnalyzedComponent;
  allTerminals: CrumbAnalyzedTerminal[];
}

function analyzeComponent(
  component: CruDecodedComponent,
  options: Required<CrumbAnalysisOptions>,
): AnalyzedComponentInternal {
  const definition = getCrumbComponentDefinition(component.toolId);
  const allRawDataTypes = component.values.map((value) => value.type);
  const signatures =
    definition === undefined
      ? []
      : [
          definition.expectedDataTypes,
          ...(definition.alternateDataTypes ?? []),
        ];
  const matchedSignatureIndex = signatures.findIndex((signature) =>
    matchesSignature(allRawDataTypes, signature),
  );
  const isNormalIcSignature =
    component.toolId === 5 && matchedSignatureIndex === 0;
  const isEepromIcSignature =
    component.toolId === 5 && matchedSignatureIndex === 1;
  const prefabValue =
    component.toolId === 5
      ? component.values[isEepromIcSignature ? 5 : 4]
      : undefined;
  const prefabIdValue = scalarValue(prefabValue);
  const prefabId =
    typeof prefabIdValue === "number" && Number.isInteger(prefabIdValue)
      ? prefabIdValue
      : undefined;
  const embeddedData = isEepromIcSignature
    ? eepromDataInfo(component.values[4])
    : undefined;
  const decodedPayloadMatchesSignature = component.values.every(
    (value, index) =>
      (isEepromIcSignature &&
        index === 4 &&
        embeddedData?.valid === true) ||
      (value.kind !== "unknown" && value.modeledStructureComplete),
  );
  const subtypeMatchesSignature =
    component.toolId !== 5 ||
    (isNormalIcSignature && prefabId !== 13) ||
    (isEepromIcSignature &&
      prefabId === 13 &&
      embeddedData?.valid === true);
  const payloadMatchesCatalog =
    definition !== undefined &&
    matchedSignatureIndex >= 0 &&
    subtypeMatchesSignature &&
    decodedPayloadMatchesSignature &&
    component.structuralDigest === undefined;
  const effectiveDefinition = payloadMatchesCatalog ? definition : undefined;
  const icDefinition =
    payloadMatchesCatalog && component.toolId === 5 && prefabId !== undefined
      ? getCrumbIcByPrefabId(prefabId)
      : undefined;
  const icTerminalNames = icDefinition?.pins.map(
    (pin) => pin.name ?? `pin-${pin.packagePin}`,
  );
  const position = component.values.find((value) => value.kind === "vector3");
  const rotation = component.values.find((value) => value.kind === "quaternion");
  const geometry = component.values.find((value) => value.kind === "vector3-array");
  const sourceCode = payloadMatchesCatalog
    ? sourceCodeInfo(component, options.includeSourceCode)
    : undefined;
  const annotation = payloadMatchesCatalog
    ? annotationInfo(component)
    : undefined;
  const parameters = makeParameters(component, effectiveDefinition);
  if (
    component.toolId === 5 &&
    effectiveDefinition !== undefined &&
    prefabId !== undefined &&
    prefabValue?.kind === "number"
  ) {
    parameters.prefabId = {
      value: prefabId,
      confidence: "installed-build",
      description: isEepromIcSignature
        ? "Selects the prefab-13 EEPROM package after its embedded memory image."
        : "Selects a version-pinned IC package and ordered pin registry.",
      encoding: {
        payloadIndex: isEepromIcSignature ? 5 : 4,
        xsiType: prefabValue.type,
        lexical: prefabValue.lexical,
      },
    };
  }

  const allTerminals = makeTerminals(
    component,
    effectiveDefinition,
    icTerminalNames,
  );
  const boundedTerminals = boundCollection(
    allTerminals,
    MAX_COMPONENT_TERMINALS_RETURNED,
  );
  const boundedRawDataTypes = boundCollection(
    allRawDataTypes,
    MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
  );
  let remainingUnknownKeyBudget =
    MAX_UNKNOWN_PAYLOAD_KEYS_RETURNED_PER_COMPONENT;
  const allUnknownPayloads = component.values.flatMap((value, index) => {
    if (
      value.kind !== "unknown" ||
      (embeddedData !== undefined && index === 4)
    ) {
      return [];
    }
    const boundedKeys = boundCollection(
      value.keys,
      remainingUnknownKeyBudget,
    );
    remainingUnknownKeyBudget -= boundedKeys.items.length;
    return [
      {
        index,
        type: value.type,
        keys: boundedKeys.items,
        keyBounds: {
          ...boundedKeys.bounds,
          limit: MAX_UNKNOWN_PAYLOAD_KEYS_RETURNED_PER_COMPONENT,
        },
      },
    ];
  });
  const boundedUnknownPayloads = boundCollection(
    allUnknownPayloads,
    MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
  );
  const boundedGeometry =
    options.includeGeometry && geometry?.kind === "vector3-array"
      ? boundCollection(
          geometry.value,
          MAX_COMPONENT_GEOMETRY_POINTS_RETURNED,
        )
      : undefined;

  const result: CrumbAnalyzedComponent = {
    id: component.guid ?? `component-${component.index}`,
    index: component.index,
    toolId: component.toolId,
    recognized: definition !== undefined,
    recognitionStatus:
      definition === undefined
        ? "unknown"
        : payloadMatchesCatalog
          ? "recognized"
          : "schema-mismatch",
    kind: definition?.kind ?? `unknown-tool-${component.toolId}`,
    label: icDefinition?.label ?? definition?.label ?? `Unknown CRUMB tool ${component.toolId}`,
    role: definition?.role ?? "unknown",
    confidence: definition?.confidence ?? "unknown",
    readSupport:
      icDefinition !== undefined &&
      icDefinition.pinNameCoverage.status === "complete" &&
      allTerminals.length === icDefinition.packagePinCount &&
      embeddedData === undefined
        ? "full"
        : effectiveDefinition?.readSupport ?? "partial",
    writeSupport: definition?.writeSupport ?? "none",
    payloadMatchesCatalog,
    rawDataTypes: boundedRawDataTypes.items,
    rawDataTypeBounds: boundedRawDataTypes.bounds,
    parameters,
    terminals: boundedTerminals.items,
    terminalBounds: boundedTerminals.bounds,
    ...(position?.kind === "vector3" ? { position: position.value } : {}),
    ...(rotation?.kind === "quaternion" ? { rotation: rotation.value } : {}),
    ...(boundedGeometry === undefined
      ? {}
      : {
          geometry: boundedGeometry.items,
          geometryBounds: boundedGeometry.bounds,
        }),
    ...(sourceCode === undefined ? {} : { sourceCode }),
    ...(embeddedData === undefined ? {} : { embeddedData }),
    ...(annotation === undefined ? {} : { annotation }),
    unknownPayloads: boundedUnknownPayloads.items,
    unknownPayloadBounds: boundedUnknownPayloads.bounds,
    notes:
      definition === undefined
        ? [
            "This tool ID is preserved but not semantically identified by the current adapter.",
          ]
        : [
            ...definition.notes,
            ...(icDefinition === undefined ? [] : [icDefinition.sourceNote]),
          ],
    ...(icDefinition === undefined
      ? {}
      : {
          variant: {
            prefabId: icDefinition.prefabId,
            label: icDefinition.label,
            packageName: icDefinition.packageName,
            packagePinCount: icDefinition.packagePinCount,
            pinNameCoverage: icDefinition.pinNameCoverage.status,
          },
        }),
  };

  return {
    component: result,
    allTerminals,
  };
}

class UnionFind {
  readonly #parents = new Map<string, string>();

  add(value: string): void {
    if (!this.#parents.has(value)) {
      this.#parents.set(value, value);
    }
  }

  find(value: string): string {
    this.add(value);
    const parent = this.#parents.get(value)!;
    if (parent === value) {
      return value;
    }
    const root = this.find(parent);
    this.#parents.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      const [first, second] = [leftRoot, rightRoot].sort();
      this.#parents.set(second!, first!);
    }
  }
}

function boardNodeKey(
  parent: CrumbAnalyzedComponent | undefined,
  tiePointId: number,
): string | undefined {
  if (!parent) {
    return undefined;
  }
  if (parent.kind === "breadboard" && tiePointId >= 0 && tiePointId <= 629) {
    return `${parent.id.toLowerCase()}:breadboard-node:${Math.floor(tiePointId / 5)}`;
  }
  if (parent.kind === "power-rail" && tiePointId >= 0 && tiePointId <= 99) {
    return `${parent.id.toLowerCase()}:power-rail-node:${tiePointId % 2}`;
  }
  return undefined;
}

function connectionGroups(
  analyzedComponents: AnalyzedComponentInternal[],
  topologyMode: Required<CrumbAnalysisOptions>["topologyMode"],
): {
  groups: CrumbConnectionGroup[];
  topologyLinksApplied: number;
  outOfRangeAttachments: CrumbAnalyzedTerminal[];
  outOfRangeAttachmentBounds: BoundedCollectionInfo;
} {
  const unionFind = new UnionFind();
  const componentsById = new Map(
    analyzedComponents.map(({ component }) => [
      component.id.toLowerCase(),
      component,
    ]),
  );
  const topologyRepresentatives = new Map<string, string>();
  const outOfRangeAttachments: CrumbAnalyzedTerminal[] = [];
  let topologyLinksApplied = 0;
  for (const { component, allTerminals } of analyzedComponents) {
    for (const terminal of allTerminals) {
      unionFind.add(terminal.attachment.attachmentKey);
      if (topologyMode === "known-board-v1.3.5") {
        const parent = componentsById.get(
          terminal.attachment.parentComponentId.toLowerCase(),
        );
        const nodeKey = boardNodeKey(parent, terminal.attachment.tiePointId);
        if (nodeKey) {
          const representative = topologyRepresentatives.get(nodeKey);
          if (representative) {
            unionFind.union(representative, terminal.attachment.attachmentKey);
            topologyLinksApplied += 1;
          } else {
            topologyRepresentatives.set(nodeKey, terminal.attachment.attachmentKey);
          }
        } else if (parent?.kind === "breadboard" || parent?.kind === "power-rail") {
          outOfRangeAttachments.push(terminal);
        }
      }
    }
    if (component.kind === "jumper-wire" && allTerminals.length === 2) {
      unionFind.union(
        allTerminals[0]!.attachment.attachmentKey,
        allTerminals[1]!.attachment.attachmentKey,
      );
    }
  }

  const physicalByRoot = new Map<string, Map<string, CrumbTerminalAttachment>>();
  const terminalsByRoot = new Map<
    string,
    Array<{ componentId: string; componentKind: string; terminal: string }>
  >();
  const wiresByRoot = new Map<string, Set<string>>();
  for (const { component, allTerminals } of analyzedComponents) {
    for (const terminal of allTerminals) {
      const root = unionFind.find(terminal.attachment.attachmentKey);
      const physical = physicalByRoot.get(root) ?? new Map();
      physical.set(terminal.attachment.attachmentKey, terminal.attachment);
      physicalByRoot.set(root, physical);

      const terminals = terminalsByRoot.get(root) ?? [];
      terminals.push({
        componentId: component.id,
        componentKind: component.kind,
        terminal: terminal.name,
      });
      terminalsByRoot.set(root, terminals);

      if (component.kind === "jumper-wire") {
        const wires = wiresByRoot.get(root) ?? new Set();
        wires.add(component.id);
        wiresByRoot.set(root, wires);
      }
    }
  }

  const groups = [...physicalByRoot.keys()]
    .sort()
    .map((root, index) => {
      const allPhysicalAttachments = [...physicalByRoot.get(root)!.values()]
        .sort((left, right) => left.attachmentKey.localeCompare(right.attachmentKey))
        .map((attachment) => ({
          attachmentKey: attachment.attachmentKey,
          parentComponentId: attachment.parentComponentId,
          tiePointId: attachment.tiePointId,
        }));
      const allComponentTerminals = (terminalsByRoot.get(root) ?? []).sort(
        (left, right) =>
        `${left.componentId}:${left.terminal}`.localeCompare(
          `${right.componentId}:${right.terminal}`,
        ),
      );
      const allExplicitWireIds = [
        ...(wiresByRoot.get(root) ?? new Set<string>()),
      ].sort();
      const physicalAttachments = boundCollection(
        allPhysicalAttachments,
        MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
      );
      const componentTerminals = boundCollection(
        allComponentTerminals,
        MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
      );
      const explicitWireIds = boundCollection(
        allExplicitWireIds,
        MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
      );

      return {
        id: `connection-${index + 1}`,
        physicalAttachments: physicalAttachments.items,
        componentTerminals: componentTerminals.items,
        explicitWireIds: explicitWireIds.items,
        membershipBounds: {
          physicalAttachments: physicalAttachments.bounds,
          componentTerminals: componentTerminals.bounds,
          explicitWireIds: explicitWireIds.bounds,
          nonWireComponentTerminals: allComponentTerminals.filter(
            (terminal) => terminal.componentKind !== "jumper-wire",
          ).length,
        },
      };
    });
  const boundedOutOfRangeAttachments = boundCollection(
    outOfRangeAttachments,
    MAX_DIAGNOSTIC_SAMPLES_RETURNED,
  );
  return {
    groups,
    topologyLinksApplied,
    outOfRangeAttachments: boundedOutOfRangeAttachments.items,
    outOfRangeAttachmentBounds: boundedOutOfRangeAttachments.bounds,
  };
}

export function analyzeCru(
  xml: string,
  options: CrumbAnalysisOptions = {},
): CrumbDesignAnalysis {
  return analyzeDecodedCru(decodeCru(xml), sha256(xml), options);
}

export function analyzeDecodedCru(
  decoded: CruDecodedDocument,
  projectDigest: string,
  options: CrumbAnalysisOptions = {},
): CrumbDesignAnalysis {
  const resolvedOptions: Required<CrumbAnalysisOptions> = {
    includeGeometry: options.includeGeometry ?? false,
    includeSourceCode: options.includeSourceCode ?? false,
    topologyMode: options.topologyMode ?? "known-board-v1.3.5",
  };
  const analyzedComponents = decoded.components.map((component) =>
    analyzeComponent(component, resolvedOptions),
  );
  const components = analyzedComponents.map(({ component }) => component);
  const connectionResult = connectionGroups(
    analyzedComponents,
    resolvedOptions.topologyMode,
  );
  const groups = connectionResult.groups;
  const diagnostics: Diagnostic[] = [];
  const designNameInfo = describeUntrustedText(decoded.name);

  if (designNameInfo.previewTruncated) {
    diagnostics.push({
      severity: "warning",
      code: "design-name-truncated",
      path: "designName",
      message:
        `The untrusted design name is ${designNameInfo.characters} characters; ` +
        `responses include only its ${designNameInfo.previewCharacters}-character preview and SHA-256 digest.`,
    });
  }

  for (const component of components) {
    if (!component.recognized) {
      diagnostics.push({
        severity: "warning",
        code: "unknown-crumb-tool",
        path: `components.${component.index}.toolId`,
        message: `Tool ID ${component.toolId} is preserved but not identified`,
      });
    } else if (!component.payloadMatchesCatalog) {
      diagnostics.push({
        severity: "warning",
        code: "payload-schema-mismatch",
        path: `components.${component.index}.rawDataTypes`,
        message: `${component.label} payload differs from the observed catalog schema`,
      });
    } else if (component.toolId === 5 && component.variant === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "unknown-ic-prefab",
        path: `components.${component.index}.parameters.prefabId`,
        message:
          "The tool-5 payload is recognized, but its prefabId is outside the version-pinned IC registry",
      });
    } else if (
      component.variant !== undefined &&
      component.variant.packagePinCount !== component.terminalBounds.total
    ) {
      diagnostics.push({
        severity: "warning",
        code: "ic-pin-count-mismatch",
        path: `components.${component.index}.terminals`,
        message: `${component.variant.label} expects ${component.variant.packagePinCount} pins but the save contains ${component.terminalBounds.total} attachments`,
      });
    } else if (
      component.variant !== undefined &&
      component.variant.pinNameCoverage !== "complete"
    ) {
      diagnostics.push({
        severity: "info",
        code: "partial-ic-pin-names",
        path: `components.${component.index}.terminals`,
        message: `${component.variant.label} has ${component.variant.pinNameCoverage} semantic pin-name coverage`,
      });
    }
    if (component.embeddedData !== undefined) {
      diagnostics.push({
        severity: component.embeddedData.valid ? "info" : "warning",
        code: component.embeddedData.valid
          ? "embedded-eeprom-redacted"
          : "invalid-eeprom-image",
        path: `components.${component.index}.embeddedData`,
        message: component.embeddedData.valid
          ? "The 28C16 EEPROM image is represented by size and SHA-256; its bytes are not included"
          : "The 28C16 EEPROM image is not valid base64 or is not exactly 2,048 bytes",
      });
    }
  }

  const componentsWithBoundedNestedOutput = components.filter(
    (component) =>
      component.terminalBounds.truncated ||
      component.rawDataTypeBounds.truncated ||
      component.unknownPayloadBounds.truncated ||
      component.unknownPayloads.some(
        (payload) => payload.keyBounds.truncated,
      ) ||
      component.geometryBounds?.truncated === true ||
      Object.values(component.parameters).some(
        (parameter) => parameter.collectionBounds?.truncated === true,
      ),
  );
  if (componentsWithBoundedNestedOutput.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "component-details-truncated",
      path: "components",
      message:
        `${componentsWithBoundedNestedOutput.length} component(s) exceeded a nested-output limit. ` +
        `Each component returns at most ${MAX_COMPONENT_TERMINALS_RETURNED} terminals, ` +
        `${MAX_COMPONENT_GEOMETRY_POINTS_RETURNED} geometry points, ` +
        `${MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED} payload descriptors, and ` +
        `${MAX_PARAMETER_COLLECTION_ITEMS_RETURNED} collection-valued parameter items; ` +
        `per-field bounds retain totals and truncation state.`,
    });
  }

  const componentsWithTerminals = components.filter(
    (component) => component.terminalBounds.total > 0,
  );
  if (componentsWithTerminals.length > 0) {
    diagnostics.push({
      severity: "info",
      code:
        resolvedOptions.topologyMode === "known-board-v1.3.5"
          ? "version-pinned-connectivity"
          : "partial-connectivity",
      path: "connectivity",
      message:
        resolvedOptions.topologyMode === "known-board-v1.3.5"
          ? "Connections apply CRUMB 1.3.5 breadboard/rail topology and explicit jumper wires"
          : "Connections include exact physical attachments and jumper wires; internal breadboard bus topology is not applied",
    });
  }
  if (connectionResult.outOfRangeAttachmentBounds.total > 0) {
    const sample = connectionResult.outOfRangeAttachments
      .map((terminal) => terminal.attachment.attachmentKey)
      .join(", ");
    diagnostics.push({
      severity: "warning",
      code: "tie-point-outside-known-range",
      path: "connectivity",
      message:
        `${connectionResult.outOfRangeAttachmentBounds.total} attachment(s) are outside the known ` +
        `CRUMB 1.3.5 board range. Sample (${connectionResult.outOfRangeAttachmentBounds.returned}): ${sample}`,
    });
  }
  const groupsWithBoundedMembership = groups.filter(
    (group) =>
      group.membershipBounds.physicalAttachments.truncated ||
      group.membershipBounds.componentTerminals.truncated ||
      group.membershipBounds.explicitWireIds.truncated,
  );
  if (groupsWithBoundedMembership.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "connection-membership-truncated",
      path: "connectivity.groups",
      message:
        `${groupsWithBoundedMembership.length} connection group(s) exceeded the ` +
        `${MAX_CONNECTION_GROUP_MEMBERS_RETURNED}-item per-membership-field response limit; ` +
        `membershipBounds retains complete counts and truncation state.`,
    });
  }

  const kindCountMap = new Map<
    string,
    {
      kind: string;
      label: string;
      toolId: number;
      recognized: boolean;
      recognitionStatus: "recognized" | "schema-mismatch" | "unknown";
      count: number;
    }
  >();
  for (const component of components) {
    const key = `${component.toolId}:${component.kind}:${component.label}:${component.recognitionStatus}`;
    const existing = kindCountMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      kindCountMap.set(key, {
        kind: component.kind,
        label: component.label,
        toolId: component.toolId,
        recognized: component.recognized,
        recognitionStatus: component.recognitionStatus,
        count: 1,
      });
    }
  }
  const boundedKindCounts = boundCollection(
    [...kindCountMap.values()].sort(
      (left, right) =>
        left.toolId - right.toolId || left.kind.localeCompare(right.kind),
    ),
    MAX_KIND_COUNTS_RETURNED,
  );
  if (boundedKindCounts.bounds.truncated) {
    diagnostics.push({
      severity: "warning",
      code: "kind-counts-truncated",
      path: "summary.kindCounts",
      message:
        `Returned ${boundedKindCounts.bounds.returned} of ` +
        `${boundedKindCounts.bounds.total} component-kind counts; ` +
        `kindCountBounds records the ${MAX_KIND_COUNTS_RETURNED}-item response limit.`,
    });
  }

  const losses: CrumbDesignAnalysis["conversion"]["losses"] = [];
  const unknownIds = components
    .filter((component) => !component.recognized)
    .map((component) => component.id);
  if (unknownIds.length > 0) {
    losses.push({
      category: "unknown-component",
      message: "Unknown CRUMB tool IDs cannot be converted semantically",
      componentIds: unknownIds,
    });
  }
  const partialIds = components
    .filter((component) => component.readSupport === "partial")
    .map((component) => component.id);
  if (partialIds.length > 0) {
    losses.push({
      category: "partial-component",
      message: "Some known components have unresolved parameters or pin names",
      componentIds: partialIds,
    });
  }
  const structureIds = components
    .filter((component) => component.role === "structure")
    .map((component) => component.id);
  if (
    resolvedOptions.topologyMode === "direct-only" &&
    structureIds.length > 0 &&
    componentsWithTerminals.length > 0
  ) {
    losses.push({
      category: "unresolved-topology",
      message: "Internal breadboard and power-rail conductive groups are not mapped yet",
      componentIds: structureIds,
    });
  }

  const isolatedAttachmentGroupCount = groups.filter(
    (group) => group.membershipBounds.nonWireComponentTerminals <= 1,
  ).length;

  return {
    analysisVersion: "crumb.analysis/0.2",
    format: "crumb-cru",
    designName: designNameInfo.preview,
    designNameInfo,
    projectDigest,
    adapterTestedCompatibility: ["CRUMB 1.3.5"],
    summary: {
      componentCount: components.length,
      recognizedComponentCount: components.filter(
        (component) => component.recognitionStatus === "recognized",
      ).length,
      schemaMismatchComponentCount: components.filter(
        (component) => component.recognitionStatus === "schema-mismatch",
      ).length,
      unknownComponentCount: components.filter(
        (component) => component.recognitionStatus === "unknown",
      ).length,
      sourceCodeComponentCount: components.filter(
        (component) => component.sourceCode?.present,
      ).length,
      embeddedDataComponentCount: components.filter(
        (component) => component.embeddedData?.present,
      ).length,
      annotationComponentCount: components.filter(
        (component) => component.annotation?.present,
      ).length,
      kindCounts: boundedKindCounts.items,
      kindCountBounds: boundedKindCounts.bounds,
    },
    components,
    connectivity: {
      scope:
        resolvedOptions.topologyMode === "known-board-v1.3.5"
          ? "crumb-1.3.5-board-topology-and-explicit-wires"
          : "physical-attachments-and-explicit-wires",
      confidence:
        resolvedOptions.topologyMode === "known-board-v1.3.5"
          ? "version-pinned"
          : "partial",
      topologyMode: resolvedOptions.topologyMode,
      topologyLinksApplied: connectionResult.topologyLinksApplied,
      groupCount: groups.length,
      groups,
      isolatedAttachmentGroupCount,
      limitations: [
        "Exact component-to-hole attachments are decoded.",
        "Jumper wires explicitly merge their two attachment groups.",
        ...(resolvedOptions.topologyMode === "known-board-v1.3.5"
          ? [
              "Main breadboard IDs 0-629 use five-hole conductive groups.",
              "Power-rail IDs 0-99 use separate even/odd conductive rails.",
              "The topology mapping is version-pinned to CRUMB 1.3.5.",
            ]
          : [
              "Internal conductive rows and rails inside board structures are not merged.",
              "A connection group is not a complete electrical net until structure topology is applied.",
            ]),
      ],
    },
    conversion: {
      portableDraftStatus: losses.length === 0 ? "exact" : "partial",
      safeForAutomaticConversion: losses.length === 0,
      losses,
    },
    diagnostics: boundDiagnostics(diagnostics),
  };
}
