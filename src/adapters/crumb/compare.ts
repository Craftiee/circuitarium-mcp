import { createHash } from "node:crypto";

import {
  boundCollection,
  describeUntrustedText,
  MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
  MAX_KIND_COUNTS_RETURNED,
  type BoundedCollectionInfo,
  type BoundedTextInfo,
} from "../../domain/bounds.js";
import type { Diagnostic } from "../../domain/experiment.js";
import {
  analyzeDecodedCru,
  type CrumbAnalyzedComponent,
  type CrumbDesignAnalysis,
} from "./analyze.js";
import { getCrumbComponentDefinition } from "./catalog.js";
import { CRUMB_COMPATIBILITY_PROFILE } from "./compatibility.js";
import {
  decodeCanonicalBase64,
  decodeCru,
  type CruDecodedComponent,
  type CruDecodedDataValue,
  type CruDecodedDocument,
  type Quaternion,
  type Vector3,
} from "./format.js";

export const CRUMB_COMPARISON_VERSION = "crumb.compare/0.1" as const;

export const CRUMB_ROOT_CHANGE_FIELDS = [
  "name",
  "thumbnail",
  "pivot-position",
  "pivot-rotation",
  "camera-position",
  "frequency",
  "time-step",
  "throttling",
  "modeled-encoding",
] as const;
export type CrumbRootChangeField = (typeof CRUMB_ROOT_CHANGE_FIELDS)[number];

export const CRUMB_COMPONENT_CHANGE_FIELDS = [
  "presence",
  "order",
  "tool-id",
  "payload-signature",
  "parameters",
  "parameter-encoding",
  "attachments",
  "position",
  "rotation",
  "geometry",
  "variant",
  "modeled-encoding",
  "source-code",
  "embedded-data",
  "annotation",
  "opaque-payload",
] as const;
export type CrumbComponentChangeField =
  (typeof CRUMB_COMPONENT_CHANGE_FIELDS)[number];

export interface CrumbComparisonOptions {
  includeGeometry?: boolean;
  topologyMode?: "direct-only" | "known-board-v1.3.5";
  baselineByteDigest?: string;
  candidateByteDigest?: string;
}

export interface CrumbThumbnailObservation {
  bytes: number;
  format: "none" | "png" | "unknown";
  digest?: string;
  contentIncluded: false;
}

export interface CrumbRootObservation {
  name: BoundedTextInfo;
  componentCount: number;
  thumbnail: CrumbThumbnailObservation;
  pivotPosition?: Vector3;
  pivotRotation?: Vector3;
  cameraPosition?: Vector3;
  frequency?: number;
  timeStep?: number;
  throttling?: boolean;
}

export interface CrumbProfileAssessment {
  status: "consistent-with-observed-profile" | "inconclusive";
  componentCount: number;
  recognizedComponentCount: number;
  schemaMismatchComponentCount: number;
  unknownComponentCount: number;
}

export interface CrumbSchemaCandidate {
  toolId: number;
  payloadTypes: string[];
  payloadTypeBounds: BoundedCollectionInfo;
  occurrenceCount: number;
  status: "unverified-observation";
}

export interface CrumbComponentChange {
  componentId: string;
  matchMethod: "guid";
  change: "added" | "removed" | "modified";
  changedFields: CrumbComponentChangeField[];
  baselinePayloadDigest?: string;
  candidatePayloadDigest?: string;
  baseline?: CrumbAnalyzedComponent;
  candidate?: CrumbAnalyzedComponent;
}

export interface CrumbDesignComparison {
  comparisonVersion: typeof CRUMB_COMPARISON_VERSION;
  compatibilityProfile: typeof CRUMB_COMPATIBILITY_PROFILE;
  topologyMode: "direct-only" | "known-board-v1.3.5";
  equivalence: {
    byteEquivalent: boolean;
    modeledContentEquivalent: boolean;
    modeledRepresentationEquivalent: boolean;
    coverage: "complete" | "partial";
    assessment: "exact" | "modeled-only" | "changed" | "inconclusive";
  };
  profileAssessment: {
    automaticOriginDetection: false;
    baseline: CrumbProfileAssessment;
    candidate: CrumbProfileAssessment;
  };
  summary: {
    rootFieldChangeCount: number;
    addedComponentCount: number;
    removedComponentCount: number;
    modifiedComponentCount: number;
    unchangedComponentCount: number;
    parameterChangeCount: number;
    attachmentChangeCount: number;
    geometryChangeCount: number;
    newToolIdCount: number;
    newPayloadSignatureCount: number;
    baselineConnectionGroupCount: number;
    candidateConnectionGroupCount: number;
  };
  root: {
    changedFields: CrumbRootChangeField[];
    baseline: CrumbRootObservation;
    candidate: CrumbRootObservation;
  };
  componentChanges: CrumbComponentChange[];
  schemaCandidates: CrumbSchemaCandidate[];
  schemaCandidateBounds: BoundedCollectionInfo;
  diagnostics: Diagnostic[];
  disclosure: {
    rawXmlIncluded: false;
    sourceCodeIncluded: false;
    embeddedBinaryIncluded: false;
    thumbnailIncluded: false;
    opaquePayloadContentIncluded: false;
    userTextMode: "untrusted-bounded-preview-and-digest";
    geometryIncluded: boolean;
  };
  limitations: string[];
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(null);
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function digestValue(value: unknown): string {
  return sha256(canonicalJson(value));
}

function normalizedPayloadType(type: string): string {
  return !type.startsWith("unresolved:") && /^[^:]+:guid$/.test(type)
    ? "guid"
    : type;
}

function payloadTypes(component: CruDecodedComponent): string[] {
  return component.values.map((value) => normalizedPayloadType(value.type));
}

function safeTextIdentity(value: string): {
  characters: number;
  bytes: number;
  digest: string;
} {
  return {
    characters: value.length,
    bytes: Buffer.byteLength(value, "utf8"),
    digest: sha256(value),
  };
}

function semanticDataValue(
  value: CruDecodedDataValue,
  includeUnmodeledStructure = true,
): unknown {
  const type = normalizedPayloadType(value.type);
  const unmodeledStructure =
    !includeUnmodeledStructure || value.structuralDigest === undefined
      ? {}
      : { unmodeledStructureDigest: value.structuralDigest };
  switch (value.kind) {
    case "guid":
      return {
        type,
        kind: value.kind,
        value: value.value.toLowerCase(),
        ...unmodeledStructure,
      };
    case "number":
    case "boolean":
      return {
        type,
        kind: value.kind,
        value: value.value,
        ...unmodeledStructure,
      };
    case "string":
      return {
        type,
        kind: value.kind,
        value: safeTextIdentity(value.value),
        ...unmodeledStructure,
      };
    case "vector3":
    case "quaternion":
    case "vector3-array":
    case "boolean-array":
      return {
        type,
        kind: value.kind,
        value: value.value,
        ...unmodeledStructure,
      };
    case "tie-point-array":
      return {
        type,
        kind: value.kind,
        value: value.value.map((tiePoint) => ({
          id: tiePoint.id,
          parentIdentifier: tiePoint.parentIdentifier.toLowerCase(),
        })),
        ...unmodeledStructure,
      };
    case "unknown":
      return {
        type,
        kind: value.kind,
        keys: [...value.keys].sort(),
        ...(value.text === undefined
          ? {}
          : { text: safeTextIdentity(value.text) }),
        ...unmodeledStructure,
      };
  }
}

function representationDataValue(
  value: CruDecodedDataValue,
  includeUnmodeledStructure = true,
): unknown {
  const semantic = semanticDataValue(
    value,
    includeUnmodeledStructure,
  ) as Record<string, unknown>;
  switch (value.kind) {
    case "guid":
      return {
        ...semantic,
        lexical: value.lexical.toLowerCase(),
      };
    case "number":
    case "boolean":
      return { ...semantic, lexical: value.lexical };
    case "string":
      return {
        ...semantic,
        lexical: safeTextIdentity(value.lexical),
      };
    case "vector3":
    case "quaternion":
    case "vector3-array":
    case "boolean-array":
      return { ...semantic, lexical: value.lexical };
    case "tie-point-array":
      return {
        ...semantic,
        lexical: value.value.map((tiePoint) => ({
          id: tiePoint.lexical.id,
          parentIdentifier:
            tiePoint.lexical.parentIdentifier.toLowerCase(),
        })),
      };
    case "unknown":
      return semantic;
  }
}

function componentSemantic(component: CruDecodedComponent): unknown {
  return {
    guid: component.guid?.toLowerCase(),
    toolId: component.toolId,
    values: component.values.map((value) => semanticDataValue(value)),
    ...(component.structuralDigest === undefined
      ? {}
      : { unmodeledComponentDigest: component.structuralDigest }),
  };
}

function componentRepresentation(component: CruDecodedComponent): unknown {
  return {
    guid: component.guid?.toLowerCase(),
    toolId: component.toolId,
    values: component.values.map((value) =>
      representationDataValue(value),
    ),
    ...(component.structuralDigest === undefined
      ? {}
      : { unmodeledComponentDigest: component.structuralDigest }),
  };
}

function componentPayloadDigest(component: CruDecodedComponent): string {
  return digestValue(componentRepresentation(component));
}

function firstValue<TKind extends CruDecodedDataValue["kind"]>(
  component: CruDecodedComponent,
  kind: TKind,
): Extract<CruDecodedDataValue, { kind: TKind }> | undefined {
  return component.values.find(
    (value): value is Extract<CruDecodedDataValue, { kind: TKind }> =>
      value.kind === kind,
  );
}

function parameterPayloadIndex(
  component: CruDecodedComponent,
  configuredIndex: number,
): number {
  return component.toolId === 5 &&
    configuredIndex === 4 &&
    component.values[4]?.type === "xsd:base64Binary"
    ? 5
    : configuredIndex;
}

function decodedParameterProjections(
  component: CruDecodedComponent,
): Record<
  string,
  {
    payloadIndex: number;
    semantic: unknown;
    representation: unknown;
  }
> {
  const definition = getCrumbComponentDefinition(component.toolId);
  if (definition === undefined) {
    return {};
  }
  return Object.fromEntries(
    definition.parameterFields
      .map((field) => {
        const payloadIndex = parameterPayloadIndex(
          component,
          field.valueIndex,
        );
        const value = component.values[payloadIndex];
        return [
          field.name,
          {
            payloadIndex,
            ...(value === undefined
              ? {
                  semantic: { missing: true },
                  representation: { missing: true },
                }
              : {
                  semantic: semanticDataValue(value, false),
                  representation: representationDataValue(value, false),
                }),
          },
        ] as const;
      })
      .sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
  );
}

function parameterChangeKinds(
  baseline: CruDecodedComponent,
  candidate: CruDecodedComponent,
): { semantic: boolean; encoding: boolean } {
  const baselineParameters = decodedParameterProjections(baseline);
  const candidateParameters = decodedParameterProjections(candidate);
  const names = new Set([
    ...Object.keys(baselineParameters),
    ...Object.keys(candidateParameters),
  ]);
  let semantic = false;
  let encoding = false;
  for (const name of names) {
    const baselineParameter = baselineParameters[name];
    const candidateParameter = candidateParameters[name];
    if (
      !equal(
        baselineParameter?.semantic ?? { missing: true },
        candidateParameter?.semantic ?? { missing: true },
      )
    ) {
      semantic = true;
    } else if (
      !equal(
        baselineParameter?.representation ?? { missing: true },
        candidateParameter?.representation ?? { missing: true },
      )
    ) {
      encoding = true;
    }
  }
  return { semantic, encoding };
}

function parameterPayloadIndexes(component: CruDecodedComponent): Set<number> {
  return new Set(
    Object.values(decodedParameterProjections(component)).map(
      (parameter) => parameter.payloadIndex,
    ),
  );
}

function attachmentShape(component: CruDecodedComponent): unknown {
  return component.values.flatMap((value, payloadIndex) =>
    value.kind === "tie-point-array"
      ? value.value.map((tiePoint, terminalIndex) => ({
          payloadIndex,
          terminalIndex,
          parentComponentId: tiePoint.parentIdentifier.toLowerCase(),
          tiePointId: tiePoint.id,
        }))
      : [],
  );
}

function unknownValues(component: CruDecodedComponent): unknown {
  return component.values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value.kind === "unknown")
    .map(({ value, index }) => ({
      index,
      value: representationDataValue(value),
    }));
}

function isEmbeddedDataValue(
  component: CruDecodedComponent,
  index: number,
): boolean {
  return (
    component.toolId === 5 &&
    index === 4 &&
    component.values[index]?.type === "xsd:base64Binary"
  );
}

function unmodeledStructureProjection(
  component: CruDecodedComponent,
): unknown {
  return {
    ...(component.structuralDigest === undefined
      ? {}
      : { envelope: component.structuralDigest }),
    values: component.values.flatMap((value, index) =>
      value.structuralDigest === undefined ||
      isEmbeddedDataValue(component, index)
        ? []
        : [{ index, digest: value.structuralDigest }],
    ),
  };
}

function classifiedPayloadIndexes(
  component: CruDecodedComponent,
): Set<number> {
  const indexes = parameterPayloadIndexes(component);
  for (const kind of [
    "guid",
    "tie-point-array",
    "unknown",
  ] satisfies CruDecodedDataValue["kind"][]) {
    component.values.forEach((value, index) => {
      if (value.kind === kind) {
        indexes.add(index);
      }
    });
  }
  for (const kind of [
    "vector3",
    "quaternion",
    "vector3-array",
  ] satisfies CruDecodedDataValue["kind"][]) {
    const index = component.values.findIndex((value) => value.kind === kind);
    if (index >= 0) {
      indexes.add(index);
    }
  }
  if (component.toolId === 20) {
    const sourceIndex = component.values.findIndex(
      (value) => value.kind === "string",
    );
    if (sourceIndex >= 0) {
      indexes.add(sourceIndex);
    }
  }
  if (component.toolId === 11 && component.values[3]?.kind === "string") {
    indexes.add(3);
  }
  component.values.forEach((_value, index) => {
    if (isEmbeddedDataValue(component, index)) {
      indexes.add(index);
    }
  });
  return indexes;
}

function unclassifiedPayloadProjection(
  component: CruDecodedComponent,
): unknown {
  const classified = classifiedPayloadIndexes(component);
  return component.values.flatMap((value, index) =>
    classified.has(index)
      ? []
      : [{ index, value: semanticDataValue(value, false) }],
  );
}

function hasNonParameterModeledEncodingChange(
  baseline: CruDecodedComponent,
  candidate: CruDecodedComponent,
): boolean {
  const parameterIndexes = new Set([
    ...parameterPayloadIndexes(baseline),
    ...parameterPayloadIndexes(candidate),
  ]);
  const maximum = Math.max(
    baseline.values.length,
    candidate.values.length,
  );
  for (let index = 0; index < maximum; index += 1) {
    if (parameterIndexes.has(index)) {
      continue;
    }
    const baselineValue = baseline.values[index];
    const candidateValue = candidate.values[index];
    if (
      baselineValue !== undefined &&
      candidateValue !== undefined &&
      equal(
        semanticDataValue(baselineValue, false),
        semanticDataValue(candidateValue, false),
      ) &&
      !equal(
        representationDataValue(baselineValue, false),
        representationDataValue(candidateValue, false),
      )
    ) {
      return true;
    }
  }
  return false;
}

function componentChangedFields(
  baselineDecoded: CruDecodedComponent,
  candidateDecoded: CruDecodedComponent,
  baseline: CrumbAnalyzedComponent,
  candidate: CrumbAnalyzedComponent,
): CrumbComponentChangeField[] {
  const changed = new Set<CrumbComponentChangeField>();
  if (baseline.index !== candidate.index) {
    changed.add("order");
  }
  if (baseline.toolId !== candidate.toolId) {
    changed.add("tool-id");
  }
  if (
    !equal(
      payloadTypes(baselineDecoded),
      payloadTypes(candidateDecoded),
    )
  ) {
    changed.add("payload-signature");
  }
  const parameterChanges = parameterChangeKinds(
    baselineDecoded,
    candidateDecoded,
  );
  if (parameterChanges.semantic) {
    changed.add("parameters");
  }
  if (parameterChanges.encoding) {
    changed.add("parameter-encoding");
  }
  if (
    !equal(
      attachmentShape(baselineDecoded),
      attachmentShape(candidateDecoded),
    )
  ) {
    changed.add("attachments");
  }
  if (
    !equal(
      firstValue(baselineDecoded, "vector3")?.value,
      firstValue(candidateDecoded, "vector3")?.value,
    )
  ) {
    changed.add("position");
  }
  if (
    !equal(
      firstValue(baselineDecoded, "quaternion")?.value,
      firstValue(candidateDecoded, "quaternion")?.value,
    )
  ) {
    changed.add("rotation");
  }
  if (
    !equal(
      firstValue(baselineDecoded, "vector3-array")?.value,
      firstValue(candidateDecoded, "vector3-array")?.value,
    )
  ) {
    changed.add("geometry");
  }
  if (!equal(baseline.variant, candidate.variant)) {
    changed.add("variant");
  }
  if (!equal(baseline.sourceCode, candidate.sourceCode)) {
    changed.add("source-code");
  }
  if (!equal(baseline.embeddedData, candidate.embeddedData)) {
    changed.add("embedded-data");
  }
  if (!equal(baseline.annotation, candidate.annotation)) {
    changed.add("annotation");
  }
  if (
    hasNonParameterModeledEncodingChange(
      baselineDecoded,
      candidateDecoded,
    )
  ) {
    changed.add("modeled-encoding");
  }
  if (!equal(unknownValues(baselineDecoded), unknownValues(candidateDecoded))) {
    if (!changed.has("embedded-data")) {
      changed.add("opaque-payload");
    }
  }
  if (
    !equal(
      unmodeledStructureProjection(baselineDecoded),
      unmodeledStructureProjection(candidateDecoded),
    ) ||
    !equal(
      unclassifiedPayloadProjection(baselineDecoded),
      unclassifiedPayloadProjection(candidateDecoded),
    )
  ) {
    changed.add("opaque-payload");
  }

  const baselinePayloadDigest = componentPayloadDigest(baselineDecoded);
  const candidatePayloadDigest = componentPayloadDigest(candidateDecoded);
  if (
    baselinePayloadDigest !== candidatePayloadDigest &&
    [...changed].every((field) => field === "order")
  ) {
    const semanticPayloadEquivalent = equal(
      componentSemantic(baselineDecoded),
      componentSemantic(candidateDecoded),
    );
    changed.add(
      baselineDecoded.modeledStructureComplete &&
        candidateDecoded.modeledStructureComplete &&
        semanticPayloadEquivalent
        ? "modeled-encoding"
        : "opaque-payload",
    );
  }
  return CRUMB_COMPONENT_CHANGE_FIELDS.filter((field) => changed.has(field));
}

function thumbnailObservation(
  imageData: string,
  bytes: number,
  format: "none" | "png" | "unknown",
): CrumbThumbnailObservation {
  return {
    bytes,
    format,
    ...(imageData.length === 0 ? {} : { digest: sha256(imageData) }),
    contentIncluded: false,
  };
}

function rootObservation(decoded: CruDecodedDocument): CrumbRootObservation {
  const name = describeUntrustedText(decoded.name);
  const imageBuffer =
    decoded.imageData.length === 0
      ? undefined
      : decodeCanonicalBase64(decoded.imageData);
  const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
  const imageFormat =
    decoded.imageData.length === 0
      ? "none"
      : imageBuffer !== undefined &&
          imageBuffer
            .subarray(0, pngSignature.byteLength)
            .equals(pngSignature)
        ? "png"
        : "unknown";
  return {
    name,
    componentCount: decoded.components.length,
    thumbnail: thumbnailObservation(
      decoded.imageData,
      imageBuffer?.byteLength ?? 0,
      imageFormat,
    ),
    ...(decoded.pivotPosition === undefined
      ? {}
      : { pivotPosition: decoded.pivotPosition }),
    ...(decoded.pivotRotation === undefined
      ? {}
      : { pivotRotation: decoded.pivotRotation }),
    ...(decoded.cameraPosition === undefined
      ? {}
      : { cameraPosition: decoded.cameraPosition }),
    ...(decoded.frequency === undefined ? {} : { frequency: decoded.frequency }),
    ...(decoded.timeStep === undefined ? {} : { timeStep: decoded.timeStep }),
    ...(decoded.throttling === undefined
      ? {}
      : { throttling: decoded.throttling }),
  };
}

function rootChangedFields(
  baseline: CrumbRootObservation,
  candidate: CrumbRootObservation,
  baselineDecoded: CruDecodedDocument,
  candidateDecoded: CruDecodedDocument,
): CrumbRootChangeField[] {
  const fields = new Set<CrumbRootChangeField>();
  if (baseline.name.sha256 !== candidate.name.sha256) {
    fields.add("name");
  }
  if (!equal(baseline.thumbnail, candidate.thumbnail)) {
    fields.add("thumbnail");
  }
  if (!equal(baseline.pivotPosition, candidate.pivotPosition)) {
    fields.add("pivot-position");
  }
  if (!equal(baseline.pivotRotation, candidate.pivotRotation)) {
    fields.add("pivot-rotation");
  }
  if (!equal(baseline.cameraPosition, candidate.cameraPosition)) {
    fields.add("camera-position");
  }
  if (!equal(baseline.frequency, candidate.frequency)) {
    fields.add("frequency");
  }
  if (!equal(baseline.timeStep, candidate.timeStep)) {
    fields.add("time-step");
  }
  if (!equal(baseline.throttling, candidate.throttling)) {
    fields.add("throttling");
  }
  const lexicalOnlyChange =
    (equal(baseline.pivotPosition, candidate.pivotPosition) &&
      !equal(
        baselineDecoded.lexical.pivotPosition,
        candidateDecoded.lexical.pivotPosition,
      )) ||
    (equal(baseline.pivotRotation, candidate.pivotRotation) &&
      !equal(
        baselineDecoded.lexical.pivotRotation,
        candidateDecoded.lexical.pivotRotation,
      )) ||
    (equal(baseline.cameraPosition, candidate.cameraPosition) &&
      !equal(
        baselineDecoded.lexical.cameraPosition,
        candidateDecoded.lexical.cameraPosition,
      )) ||
    (equal(baseline.frequency, candidate.frequency) &&
      !equal(
        baselineDecoded.lexical.frequency,
        candidateDecoded.lexical.frequency,
      )) ||
    (equal(baseline.timeStep, candidate.timeStep) &&
      !equal(
        baselineDecoded.lexical.timeStep,
        candidateDecoded.lexical.timeStep,
      )) ||
    (equal(baseline.throttling, candidate.throttling) &&
      !equal(
        baselineDecoded.lexical.throttling,
        candidateDecoded.lexical.throttling,
      ));
  if (lexicalOnlyChange) {
    fields.add("modeled-encoding");
  }
  return CRUMB_ROOT_CHANGE_FIELDS.filter((field) => fields.has(field));
}

function componentProfileShapeComplete(
  decoded: CruDecodedComponent,
  analyzed: CrumbAnalyzedComponent,
): boolean {
  if (!decoded.modeledStructureComplete) {
    return false;
  }
  const definition = getCrumbComponentDefinition(decoded.toolId);
  if (definition === undefined) {
    return false;
  }
  if (decoded.toolId === 5 && analyzed.variant === undefined) {
    return false;
  }
  const tiePointCount = decoded.values
    .filter((value) => value.kind === "tie-point-array")
    .reduce((total, value) => total + value.value.length, 0);
  const expectedTerminalCount =
    analyzed.variant?.packagePinCount ?? definition.terminalNames?.length;
  if (
    expectedTerminalCount !== undefined &&
    tiePointCount !== expectedTerminalCount
  ) {
    return false;
  }
  const expectsConnectedGeometry = [
    definition.expectedDataTypes,
    ...(definition.alternateDataTypes ?? []),
  ].some((signature) => signature.includes("ArrayOfVector3S"));
  if (expectsConnectedGeometry) {
    const geometry = decoded.values.find(
      (value) => value.kind === "vector3-array",
    );
    if (
      geometry?.kind !== "vector3-array" ||
      geometry.value.length < 2
    ) {
      return false;
    }
  }
  const positionsField = definition.parameterFields.find(
    (field) => field.name === "positions",
  );
  if (
    positionsField !== undefined &&
    expectedTerminalCount !== undefined
  ) {
    const positionValue =
      decoded.values[
        parameterPayloadIndex(decoded, positionsField.valueIndex)
      ];
    if (
      positionValue?.kind !== "boolean-array" ||
      positionValue.value.length !== expectedTerminalCount / 2
    ) {
      return false;
    }
  }
  return true;
}

function shapeMismatchCount(
  analysis: CrumbDesignAnalysis,
  decoded: CruDecodedDocument,
): number {
  const decodedById = new Map(
    decoded.components.map((component) => [
      component.guid?.toLowerCase(),
      component,
    ]),
  );
  return analysis.components.filter((component) => {
    if (component.recognitionStatus !== "recognized") {
      return false;
    }
    const raw = decodedById.get(component.id.toLowerCase());
    return (
      raw === undefined ||
      !componentProfileShapeComplete(raw, component)
    );
  }).length;
}

function hasOutOfRangeKnownBoardAttachment(
  analysis: CrumbDesignAnalysis,
): boolean {
  const componentsById = new Map(
    analysis.components.map((component) => [
      component.id.toLowerCase(),
      component,
    ]),
  );
  return analysis.components.some((component) =>
    component.terminals.some((terminal) => {
      const parent = componentsById.get(
        terminal.attachment.parentComponentId.toLowerCase(),
      );
      return (
        (parent?.kind === "breadboard" &&
          (terminal.attachment.tiePointId < 0 ||
            terminal.attachment.tiePointId > 629)) ||
        (parent?.kind === "power-rail" &&
          (terminal.attachment.tiePointId < 0 ||
            terminal.attachment.tiePointId > 99))
      );
    }),
  );
}

function documentProfileShapeComplete(
  decoded: CruDecodedDocument,
): boolean {
  const thumbnail = decodeCanonicalBase64(decoded.imageData);
  const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
  return (
    decoded.name.trim().length > 0 &&
    thumbnail !== undefined &&
    thumbnail
      .subarray(0, pngSignature.byteLength)
      .equals(pngSignature) &&
    decoded.pivotPosition !== undefined &&
    decoded.pivotRotation !== undefined &&
    decoded.cameraPosition !== undefined &&
    decoded.frequency !== undefined &&
    decoded.timeStep !== undefined &&
    decoded.throttling !== undefined
  );
}

function profileAssessment(
  analysis: CrumbDesignAnalysis,
  decoded: CruDecodedDocument,
): CrumbProfileAssessment {
  const modeledShapeMismatchCount = shapeMismatchCount(analysis, decoded);
  const hasOutOfRangeAttachment =
    hasOutOfRangeKnownBoardAttachment(analysis);
  return {
    status:
      analysis.summary.schemaMismatchComponentCount === 0 &&
      analysis.summary.unknownComponentCount === 0 &&
      modeledShapeMismatchCount === 0 &&
      !hasOutOfRangeAttachment &&
      documentProfileShapeComplete(decoded) &&
      decoded.modeledStructureComplete
        ? "consistent-with-observed-profile"
        : "inconclusive",
    componentCount: analysis.summary.componentCount,
    recognizedComponentCount:
      analysis.summary.recognizedComponentCount -
      modeledShapeMismatchCount,
    schemaMismatchComponentCount:
      analysis.summary.schemaMismatchComponentCount +
      modeledShapeMismatchCount,
    unknownComponentCount: analysis.summary.unknownComponentCount,
  };
}

function hasCompleteModeledCoverage(
  analysis: CrumbDesignAnalysis,
  decoded: CruDecodedDocument,
): boolean {
  if (!decoded.modeledStructureComplete) {
    return false;
  }
  const decodedById = new Map(
    decoded.components.map((component) => [
      component.guid?.toLowerCase(),
      component,
    ]),
  );
  return analysis.components.every((component) => {
    const raw = decodedById.get(component.id.toLowerCase());
    return (
      raw !== undefined &&
      component.recognitionStatus === "recognized" &&
      component.payloadMatchesCatalog &&
      component.readSupport === "full" &&
      component.unknownPayloadBounds.total === 0 &&
      componentProfileShapeComplete(raw, component)
    );
  });
}

function schemaCandidates(
  analysis: CrumbDesignAnalysis,
  decodedComponents: CruDecodedComponent[],
): {
  items: CrumbSchemaCandidate[];
  bounds: BoundedCollectionInfo;
} {
  const candidates = new Map<
    string,
    { signatureKey: string; item: CrumbSchemaCandidate }
  >();
  const decodedById = new Map(
    decodedComponents.map((component) => [
      (component.guid ?? `component-${component.index}`).toLowerCase(),
      component,
    ]),
  );
  for (const component of analysis.components) {
    if (component.recognitionStatus === "recognized") {
      continue;
    }
    const decoded = decodedById.get(component.id.toLowerCase());
    const normalizedTypes =
      decoded === undefined
        ? component.rawDataTypes.map(normalizedPayloadType)
        : payloadTypes(decoded);
    const boundedTypes = boundCollection(
      normalizedTypes,
      MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED,
    );
    const key = `${component.toolId}:${canonicalJson(normalizedTypes)}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.item.occurrenceCount += 1;
    } else {
      candidates.set(key, {
        signatureKey: key,
        item: {
          toolId: component.toolId,
          payloadTypes: boundedTypes.items,
          payloadTypeBounds: boundedTypes.bounds,
          occurrenceCount: 1,
          status: "unverified-observation",
        },
      });
    }
  }
  const ordered = [...candidates.values()]
    .sort(
    (left, right) =>
      left.item.toolId - right.item.toolId ||
      (left.signatureKey < right.signatureKey
        ? -1
        : left.signatureKey > right.signatureKey
          ? 1
          : 0),
    )
    .map(({ item }) => item);
  return boundCollection(ordered, MAX_KIND_COUNTS_RETURNED);
}

function comparisonDiagnostics(
  side: "baseline" | "candidate",
  diagnostics: Diagnostic[],
): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    path: diagnostic.path.length === 0 ? side : `${side}.${diagnostic.path}`,
  }));
}

function structuralCoverageDiagnostics(
  side: "baseline" | "candidate",
  decoded: CruDecodedDocument,
): Diagnostic[] {
  return decoded.modeledStructureComplete
    ? []
    : [
        {
          severity: "warning",
          code: "unmodeled-xml-structure",
          path: side,
          message:
            `The ${side} save contains XML structure outside the loss-aware Unity profile; ` +
            "equivalence is therefore inconclusive and opaque content is represented only by digests.",
        },
      ];
}

function requireComparableComponentIds(
  decoded: CruDecodedDocument,
  side: "baseline" | "candidate",
): void {
  const seen = new Set<string>();
  for (const component of decoded.components) {
    if (component.guid === undefined) {
      throw new Error(
        `The ${side} CRUMB save has a component without a GUID and cannot be compared.`,
      );
    }
    const normalized = component.guid.toLowerCase();
    if (seen.has(normalized)) {
      throw new Error(
        `The ${side} CRUMB save has duplicate component GUIDs and cannot be compared.`,
      );
    }
    seen.add(normalized);
  }
}

function comparisonByteDigests(
  baselineXml: string,
  candidateXml: string,
  options: CrumbComparisonOptions,
): { baseline: string; candidate: string } {
  const baseline = options.baselineByteDigest;
  const candidate = options.candidateByteDigest;
  if ((baseline === undefined) !== (candidate === undefined)) {
    throw new Error(
      "Comparison byte digests must be supplied for both artifacts or neither artifact.",
    );
  }
  if (baseline === undefined || candidate === undefined) {
    return {
      baseline: sha256(baselineXml),
      candidate: sha256(candidateXml),
    };
  }
  const digestPattern = /^sha256:[0-9a-f]{64}$/;
  if (!digestPattern.test(baseline) || !digestPattern.test(candidate)) {
    throw new Error(
      "Comparison byte digests must be lowercase SHA-256 values prefixed with sha256:.",
    );
  }
  if (baseline === candidate && baselineXml !== candidateXml) {
    throw new Error(
      "Equal comparison byte digests cannot describe different decoded XML inputs.",
    );
  }
  return { baseline, candidate };
}

function modeledContent(
  decoded: CruDecodedDocument,
): unknown {
  return {
    name: safeTextIdentity(decoded.name),
    pivotPosition: decoded.pivotPosition,
    pivotRotation: decoded.pivotRotation,
    cameraPosition: decoded.cameraPosition,
    frequency: decoded.frequency,
    timeStep: decoded.timeStep,
    throttling: decoded.throttling,
    components: decoded.components
      .map(componentSemantic)
      .sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      ),
    ...(decoded.structuralDigest === undefined
      ? {}
      : { unmodeledDocumentDigest: decoded.structuralDigest }),
  };
}

function modeledRepresentation(decoded: CruDecodedDocument): unknown {
  return {
    name: safeTextIdentity(decoded.name),
    imageData:
      decoded.imageData.length === 0
        ? undefined
        : safeTextIdentity(decoded.imageData),
    pivotPosition: decoded.pivotPosition,
    pivotRotation: decoded.pivotRotation,
    cameraPosition: decoded.cameraPosition,
    frequency: decoded.frequency,
    timeStep: decoded.timeStep,
    throttling: decoded.throttling,
    lexical: decoded.lexical,
    components: decoded.components.map(componentRepresentation),
    ...(decoded.structuralDigest === undefined
      ? {}
      : { unmodeledDocumentDigest: decoded.structuralDigest }),
  };
}

function newCandidateCounts(
  baseline: CruDecodedComponent[],
  candidate: CruDecodedComponent[],
): { newToolIdCount: number; newPayloadSignatureCount: number } {
  const baselineToolIds = new Set(
    baseline.map((component) => component.toolId),
  );
  const baselineSignatures = new Set(
    baseline.map(
      (component) =>
        `${component.toolId}:${canonicalJson(payloadTypes(component))}`,
    ),
  );
  const candidateToolIds = new Set(
    candidate.map((component) => component.toolId),
  );
  const candidateSignatures = new Set(
    candidate.map(
      (component) =>
        `${component.toolId}:${canonicalJson(payloadTypes(component))}`,
    ),
  );
  return {
    newToolIdCount: [...candidateToolIds].filter(
      (toolId) => !baselineToolIds.has(toolId),
    ).length,
    newPayloadSignatureCount: [...candidateSignatures].filter(
      (signature) => !baselineSignatures.has(signature),
    ).length,
  };
}

export function compareCru(
  baselineXml: string,
  candidateXml: string,
  options: CrumbComparisonOptions = {},
): CrumbDesignComparison {
  const topologyMode = options.topologyMode ?? "known-board-v1.3.5";
  const analysisOptions = {
    includeGeometry: options.includeGeometry ?? false,
    includeSourceCode: false,
    topologyMode,
  } as const;
  const baselineDecoded = decodeCru(baselineXml);
  const candidateDecoded = decodeCru(candidateXml);
  const baselineAnalysis = analyzeDecodedCru(
    baselineDecoded,
    sha256(baselineXml),
    analysisOptions,
  );
  const candidateAnalysis = analyzeDecodedCru(
    candidateDecoded,
    sha256(candidateXml),
    analysisOptions,
  );
  requireComparableComponentIds(baselineDecoded, "baseline");
  requireComparableComponentIds(candidateDecoded, "candidate");
  const baselineRoot = rootObservation(baselineDecoded);
  const candidateRoot = rootObservation(candidateDecoded);
  const changedRootFields = rootChangedFields(
    baselineRoot,
    candidateRoot,
    baselineDecoded,
    candidateDecoded,
  );

  const baselineDecodedById = new Map(
    baselineDecoded.components.map((component) => [
      (component.guid ?? `component-${component.index}`).toLowerCase(),
      component,
    ]),
  );
  const candidateDecodedById = new Map(
    candidateDecoded.components.map((component) => [
      (component.guid ?? `component-${component.index}`).toLowerCase(),
      component,
    ]),
  );
  const baselineById = new Map(
    baselineAnalysis.components.map((component) => [
      component.id.toLowerCase(),
      component,
    ]),
  );
  const candidateById = new Map(
    candidateAnalysis.components.map((component) => [
      component.id.toLowerCase(),
      component,
    ]),
  );
  const componentIds = new Set([
    ...baselineById.keys(),
    ...candidateById.keys(),
  ]);
  const componentChanges: CrumbComponentChange[] = [];
  let unchangedComponentCount = 0;

  for (const componentId of [...componentIds].sort()) {
    const baseline = baselineById.get(componentId);
    const candidate = candidateById.get(componentId);
    const baselineRaw = baselineDecodedById.get(componentId);
    const candidateRaw = candidateDecodedById.get(componentId);
    if (baseline === undefined || baselineRaw === undefined) {
      componentChanges.push({
        componentId: candidate!.id,
        matchMethod: "guid",
        change: "added",
        changedFields: ["presence"],
        candidatePayloadDigest: componentPayloadDigest(candidateRaw!),
        candidate: candidate!,
      });
      continue;
    }
    if (candidate === undefined || candidateRaw === undefined) {
      componentChanges.push({
        componentId: baseline.id,
        matchMethod: "guid",
        change: "removed",
        changedFields: ["presence"],
        baselinePayloadDigest: componentPayloadDigest(baselineRaw),
        baseline,
      });
      continue;
    }
    const changedFields = componentChangedFields(
      baselineRaw,
      candidateRaw,
      baseline,
      candidate,
    );
    if (changedFields.length === 0) {
      unchangedComponentCount += 1;
      continue;
    }
    componentChanges.push({
      componentId: candidate.id,
      matchMethod: "guid",
      change: "modified",
      changedFields,
      baselinePayloadDigest: componentPayloadDigest(baselineRaw),
      candidatePayloadDigest: componentPayloadDigest(candidateRaw),
      baseline,
      candidate,
    });
  }

  componentChanges.sort((left, right) => {
    const leftIndex = left.baseline?.index ?? left.candidate?.index ?? 0;
    const rightIndex = right.baseline?.index ?? right.candidate?.index ?? 0;
    return leftIndex - rightIndex || left.componentId.localeCompare(right.componentId);
  });

  const baselineAssessment = profileAssessment(
    baselineAnalysis,
    baselineDecoded,
  );
  const candidateAssessment = profileAssessment(
    candidateAnalysis,
    candidateDecoded,
  );
  const coverage =
    hasCompleteModeledCoverage(baselineAnalysis, baselineDecoded) &&
    hasCompleteModeledCoverage(candidateAnalysis, candidateDecoded)
      ? "complete"
      : "partial";
  const byteDigests = comparisonByteDigests(
    baselineXml,
    candidateXml,
    options,
  );
  const byteEquivalent = byteDigests.baseline === byteDigests.candidate;
  const modeledContentEquivalent = equal(
    modeledContent(baselineDecoded),
    modeledContent(candidateDecoded),
  );
  const modeledRepresentationEquivalent = equal(
    modeledRepresentation(baselineDecoded),
    modeledRepresentation(candidateDecoded),
  );
  const assessment = byteEquivalent
    ? "exact"
    : coverage === "partial"
      ? "inconclusive"
      : modeledContentEquivalent
        ? "modeled-only"
        : "changed";
  const candidates = schemaCandidates(
    candidateAnalysis,
    candidateDecoded.components,
  );
  const counts = newCandidateCounts(
    baselineDecoded.components,
    candidateDecoded.components,
  );

  return {
    comparisonVersion: CRUMB_COMPARISON_VERSION,
    compatibilityProfile: CRUMB_COMPATIBILITY_PROFILE,
    topologyMode,
    equivalence: {
      byteEquivalent,
      modeledContentEquivalent,
      modeledRepresentationEquivalent,
      coverage,
      assessment,
    },
    profileAssessment: {
      automaticOriginDetection: false,
      baseline: baselineAssessment,
      candidate: candidateAssessment,
    },
    summary: {
      rootFieldChangeCount: changedRootFields.length,
      addedComponentCount: componentChanges.filter(
        (change) => change.change === "added",
      ).length,
      removedComponentCount: componentChanges.filter(
        (change) => change.change === "removed",
      ).length,
      modifiedComponentCount: componentChanges.filter(
        (change) => change.change === "modified",
      ).length,
      unchangedComponentCount,
      parameterChangeCount: componentChanges.filter((change) =>
        change.changedFields.some(
          (field) =>
            field === "parameters" || field === "parameter-encoding",
        ),
      ).length,
      attachmentChangeCount: componentChanges.filter((change) =>
        change.changedFields.includes("attachments"),
      ).length,
      geometryChangeCount: componentChanges.filter((change) =>
        change.changedFields.includes("geometry"),
      ).length,
      ...counts,
      baselineConnectionGroupCount:
        baselineAnalysis.connectivity.groupCount,
      candidateConnectionGroupCount:
        candidateAnalysis.connectivity.groupCount,
    },
    root: {
      changedFields: changedRootFields,
      baseline: baselineRoot,
      candidate: candidateRoot,
    },
    componentChanges,
    schemaCandidates: candidates.items,
    schemaCandidateBounds: candidates.bounds,
    diagnostics: [
      ...comparisonDiagnostics("baseline", baselineAnalysis.diagnostics),
      ...comparisonDiagnostics("candidate", candidateAnalysis.diagnostics),
      ...structuralCoverageDiagnostics("baseline", baselineDecoded),
      ...structuralCoverageDiagnostics("candidate", candidateDecoded),
    ],
    disclosure: {
      rawXmlIncluded: false,
      sourceCodeIncluded: false,
      embeddedBinaryIncluded: false,
      thumbnailIncluded: false,
      opaquePayloadContentIncluded: false,
      userTextMode: "untrusted-bounded-preview-and-digest",
      geometryIncluded: options.includeGeometry ?? false,
    },
    limitations: [
      "Components are matched only by case-insensitive GUID; independently created equivalents are not paired heuristically.",
      "Modeled equivalence covers fields decoded by crumb.unity/1.3.5 and is not a lossless XML round-trip guarantee.",
      "A consistent profile assessment does not detect or prove which CRUMB build authored either file.",
      "No circuit behavior, voltage, current, timing, firmware, or live application state is simulated.",
    ],
  };
}
