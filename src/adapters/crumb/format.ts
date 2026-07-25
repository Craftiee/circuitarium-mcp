import { XMLParser, XMLValidator } from "fast-xml-parser";
import { deflateSync } from "node:zlib";

import {
  boundDiagnostics,
  describeUntrustedText,
  MAX_CRU_GUID_TOKEN_CHARACTERS,
  MAX_CRU_NUMERIC_LEXICAL_CHARACTERS,
  MAX_CRU_XML_NAME_CHARACTERS,
  MAX_CRU_XSI_TYPE_CHARACTERS,
  type BoundedTextInfo,
} from "../../domain/bounds.js";
import type { Diagnostic } from "../../domain/experiment.js";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface CruSpatialComponent {
  toolId: number;
  guid: string;
  position: Vector3;
  rotation: Quaternion;
}

export interface CruTiePoint {
  id: number;
  parentIdentifier: string;
}

export interface CruTypedScalar {
  type: "xsd:float" | "xsd:double" | "xsd:int" | "xsd:boolean" | "xsd:string";
  value: string | number | boolean;
}

export interface CruConnectedComponent {
  toolId: number;
  guid: string;
  geometry: Vector3[];
  tiePoints: CruTiePoint[];
  settings: CruTypedScalar[];
}

export type CruComponent = CruSpatialComponent | CruConnectedComponent;

export interface CruDocument {
  name: string;
  components: CruComponent[];
  imageData?: string;
  pivotPosition?: Vector3;
  pivotRotation?: Vector3;
  cameraPosition?: Vector3;
  frequency?: number;
  timeStep?: number;
  throttling?: boolean;
}

export interface CruComponentInspection {
  index: number;
  toolId: number;
  guid?: string;
  dataTypes: string[];
  tiePointIds: number[];
  tiePointParents: string[];
}

export interface CruInspection {
  format: "crumb-cru";
  name: string;
  nameInfo: BoundedTextInfo;
  componentCount: number;
  toolCounts: Record<string, number>;
  components: CruComponentInspection[];
  imageDataBytes: number;
  imageDataFormat: "none" | "png" | "unknown";
  settings: {
    frequency?: number;
    timeStep?: number;
    throttling?: boolean;
  };
}

export type CruDecodedDataValue =
  | { type: string; kind: "guid"; value: string }
  | { type: string; kind: "number"; value: number; lexical: string }
  | { type: string; kind: "boolean"; value: boolean; lexical: string }
  | { type: string; kind: "string"; value: string; lexical: string }
  | { type: string; kind: "vector3"; value: Vector3 }
  | { type: string; kind: "quaternion"; value: Quaternion }
  | { type: string; kind: "vector3-array"; value: Vector3[] }
  | { type: string; kind: "tie-point-array"; value: CruTiePoint[] }
  | { type: string; kind: "boolean-array"; value: boolean[] }
  | { type: string; kind: "unknown"; keys: string[]; text?: string };

export interface CruDecodedComponent {
  index: number;
  toolId: number;
  guid?: string;
  values: CruDecodedDataValue[];
}

export interface CruDecodedDocument {
  name: string;
  components: CruDecodedComponent[];
  imageData: string;
  pivotPosition?: Vector3;
  pivotRotation?: Vector3;
  cameraPosition?: Vector3;
  frequency?: number;
  timeStep?: number;
  throttling?: boolean;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function createPlaceholderThumbnail(width = 560, height = 480): string {
  const bytesPerRow = width * 4 + 1;
  const pixels = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * bytesPerRow;
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      pixels[pixel] = 24;
      pixels[pixel + 1] = 26;
      pixels[pixel + 2] = 31;
      pixels[pixel + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

const DEFAULT_THUMBNAIL = createPlaceholderThumbnail();

export interface CruValidation {
  valid: boolean;
  diagnostics: Diagnostic[];
  inspection?: CruInspection;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
});

class CruStructuralLimitError extends Error {
  constructor(
    readonly diagnosticPath: string,
    label: string,
    limit: number,
  ) {
    super(`A CRUMB ${label} exceeds the ${limit}-character structural limit.`);
  }
}

function requireStructuralToken(
  value: string,
  limit: number,
  label: string,
  diagnosticPath: string,
): void {
  if (value.length > limit) {
    throw new CruStructuralLimitError(diagnosticPath, label, limit);
  }
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object" && "#text" in value) {
    return textOf((value as Record<string, unknown>)["#text"]);
  }
  return undefined;
}

function numberOf(value: unknown): number | undefined {
  const text = textOf(value);
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  requireStructuralToken(
    text,
    MAX_CRU_NUMERIC_LEXICAL_CHARACTERS,
    "numeric lexical token",
    "SaveData",
  );
  const parsedNumber = Number(text);
  return Number.isFinite(parsedNumber) ? parsedNumber : undefined;
}

function booleanOf(value: unknown): boolean | undefined {
  const text = textOf(value)?.toLowerCase();
  if (text === "true" || text === "1") {
    return true;
  }
  if (text === "false" || text === "0") {
    return false;
  }
  return undefined;
}

function vectorOf(value: unknown): Vector3 | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = numberOf(record.x);
  const y = numberOf(record.y);
  const z = numberOf(record.z);
  return x === undefined || y === undefined || z === undefined ? undefined : { x, y, z };
}

function quaternionOf(value: unknown): Quaternion | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const w = numberOf(record.w);
  const x = numberOf(record.x);
  const y = numberOf(record.y);
  const z = numberOf(record.z);
  return w === undefined || x === undefined || y === undefined || z === undefined
    ? undefined
    : { w, x, y, z };
}

function decodeDataValue(value: unknown): CruDecodedDataValue {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const type = textOf(record?.["@_xsi:type"]) ?? "untyped";
  const text = textOf(value);
  requireStructuralToken(
    type,
    MAX_CRU_XSI_TYPE_CHARACTERS,
    "xsi:type token",
    "SaveData.components.SaveComponent.data.anyType.@xsi:type",
  );

  if (type.endsWith(":guid") && text !== undefined) {
    requireStructuralToken(
      text,
      MAX_CRU_GUID_TOKEN_CHARACTERS,
      "GUID token",
      "SaveData.components.SaveComponent.data.anyType",
    );
    return { type, kind: "guid", value: text };
  }
  if (type === "Vector3S") {
    const vector = vectorOf(record);
    if (vector) {
      return { type, kind: "vector3", value: vector };
    }
  }
  if (type === "QuaternionS") {
    const quaternion = quaternionOf(record);
    if (quaternion) {
      return { type, kind: "quaternion", value: quaternion };
    }
  }
  if (type === "ArrayOfVector3S") {
    const vectors = asArray(record?.Vector3S)
      .map(vectorOf)
      .filter((vector): vector is Vector3 => vector !== undefined);
    return { type, kind: "vector3-array", value: vectors };
  }
  if (type === "ArrayOfTiePointID") {
    const tiePoints = asArray(record?.TiePointID)
      .map((rawTiePoint) => {
        if (!rawTiePoint || typeof rawTiePoint !== "object") {
          return undefined;
        }
        const tiePoint = rawTiePoint as Record<string, unknown>;
        const id = numberOf(tiePoint.id);
        const parentIdentifier = textOf(tiePoint.parentIdentifier);
        if (parentIdentifier !== undefined) {
          requireStructuralToken(
            parentIdentifier,
            MAX_CRU_GUID_TOKEN_CHARACTERS,
            "tie-point parent GUID token",
            "SaveData.components.SaveComponent.data.ArrayOfTiePointID.parentIdentifier",
          );
        }
        return id === undefined || parentIdentifier === undefined
          ? undefined
          : { id, parentIdentifier };
      })
      .filter((tiePoint): tiePoint is CruTiePoint => tiePoint !== undefined);
    return { type, kind: "tie-point-array", value: tiePoints };
  }
  if (type === "ArrayOfBoolean") {
    const booleans = asArray(record?.boolean ?? record?.Boolean)
      .map(booleanOf)
      .filter((entry): entry is boolean => entry !== undefined);
    return { type, kind: "boolean-array", value: booleans };
  }
  if (type === "xsd:boolean") {
    const parsedBoolean = booleanOf(value);
    if (parsedBoolean !== undefined) {
      return { type, kind: "boolean", value: parsedBoolean, lexical: text ?? "" };
    }
  }
  if (type === "xsd:int" || type === "xsd:float" || type === "xsd:double") {
    const parsedNumber = numberOf(value);
    if (parsedNumber !== undefined) {
      return { type, kind: "number", value: parsedNumber, lexical: text ?? "" };
    }
  }
  if (type === "xsd:string") {
    return { type, kind: "string", value: text ?? "", lexical: text ?? "" };
  }

  const keys = record
    ? Object.keys(record).filter((key) => key !== "#text" && !key.startsWith("@_"))
    : [];
  for (const key of keys) {
    requireStructuralToken(
      key,
      MAX_CRU_XML_NAME_CHARACTERS,
      "XML element-name token",
      "SaveData.components.SaveComponent.data.anyType",
    );
  }
  return {
    type,
    kind: "unknown",
    keys,
    ...(text === undefined ? {} : { text }),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function scalar(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`CRUMB coordinates must be finite; received ${value}`);
  }
  return Object.is(value, -0) ? "0" : String(value);
}

function vectorXml(tag: string, value: Vector3, indent: string): string[] {
  return [
    `${indent}<${tag}>`,
    `${indent}  <x>${scalar(value.x)}</x>`,
    `${indent}  <y>${scalar(value.y)}</y>`,
    `${indent}  <z>${scalar(value.z)}</z>`,
    `${indent}</${tag}>`,
  ];
}

function requireComponentIdentity(component: CruComponent): void {
  if (!Number.isInteger(component.toolId) || component.toolId < 0) {
    throw new Error(`CRUMB toolId must be a non-negative integer; received ${component.toolId}`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(component.guid)) {
    throw new Error(`Invalid component GUID: ${component.guid}`);
  }
}

function spatialComponentXml(component: CruSpatialComponent): string[] {
  return [
    "    <SaveComponent>",
    `      <toolID>${component.toolId}</toolID>`,
    "      <data>",
    `        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${component.guid}</anyType>`,
    '        <anyType xsi:type="Vector3S">',
    `          <x>${scalar(component.position.x)}</x>`,
    `          <y>${scalar(component.position.y)}</y>`,
    `          <z>${scalar(component.position.z)}</z>`,
    "        </anyType>",
    '        <anyType xsi:type="QuaternionS">',
    `          <w>${scalar(component.rotation.w)}</w>`,
    `          <x>${scalar(component.rotation.x)}</x>`,
    `          <y>${scalar(component.rotation.y)}</y>`,
    `          <z>${scalar(component.rotation.z)}</z>`,
    "        </anyType>",
    "      </data>",
    "    </SaveComponent>",
  ];
}

function connectedComponentXml(component: CruConnectedComponent): string[] {
  if (component.geometry.length < 2) {
    throw new Error(`Connected CRUMB component ${component.guid} needs at least 2 geometry points`);
  }
  if (component.tiePoints.length !== 2) {
    throw new Error(`Connected CRUMB component ${component.guid} needs exactly 2 tie points`);
  }
  const lines = [
    "    <SaveComponent>",
    `      <toolID>${component.toolId}</toolID>`,
    "      <data>",
    `        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${component.guid}</anyType>`,
    '        <anyType xsi:type="ArrayOfVector3S">',
  ];
  for (const point of component.geometry) {
    lines.push("          <Vector3S>");
    lines.push(`            <x>${scalar(point.x)}</x>`);
    lines.push(`            <y>${scalar(point.y)}</y>`);
    lines.push(`            <z>${scalar(point.z)}</z>`);
    lines.push("          </Vector3S>");
  }
  lines.push("        </anyType>");
  lines.push('        <anyType xsi:type="ArrayOfTiePointID">');
  for (const tiePoint of component.tiePoints) {
    if (!Number.isInteger(tiePoint.id) || tiePoint.id < 0) {
      throw new Error(`Invalid CRUMB tie-point ID: ${tiePoint.id}`);
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        tiePoint.parentIdentifier,
      )
    ) {
      throw new Error(`Invalid tie-point parent GUID: ${tiePoint.parentIdentifier}`);
    }
    lines.push("          <TiePointID>");
    lines.push(`            <id>${tiePoint.id}</id>`);
    lines.push(`            <parentIdentifier>${tiePoint.parentIdentifier}</parentIdentifier>`);
    lines.push("          </TiePointID>");
  }
  lines.push("        </anyType>");
  for (const setting of component.settings) {
    const value =
      typeof setting.value === "number"
        ? scalar(setting.value)
        : typeof setting.value === "boolean"
          ? String(setting.value)
          : escapeXml(setting.value);
    lines.push(`        <anyType xsi:type="${setting.type}">${value}</anyType>`);
  }
  lines.push("      </data>");
  lines.push("    </SaveComponent>");
  return lines;
}

function componentXml(component: CruComponent): string[] {
  requireComponentIdentity(component);
  return "position" in component
    ? spatialComponentXml(component)
    : connectedComponentXml(component);
}

export function serializeCru(document: CruDocument): string {
  if (document.name.trim().length === 0) {
    throw new Error("CRUMB save name cannot be empty");
  }
  const frequency = document.frequency ?? 200;
  const timeStep = document.timeStep ?? 0.005;
  if (!(frequency > 0) || !(timeStep > 0)) {
    throw new Error("CRUMB frequency and timeStep must be positive");
  }
  const pivotPosition = document.pivotPosition ?? { x: 0, y: 0, z: 0 };
  const pivotRotation = document.pivotRotation ?? { x: 45.0000038, y: 315, z: 0 };
  const cameraPosition = document.cameraPosition ?? { x: 0, y: 0, z: -200 };

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<SaveData xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <name>${escapeXml(document.name)}</name>`,
  ];

  if (document.components.length === 0) {
    lines.push("  <components />");
  } else {
    lines.push("  <components>");
    for (const component of document.components) {
      lines.push(...componentXml(component));
    }
    lines.push("  </components>");
  }

  const imageData = document.imageData ?? DEFAULT_THUMBNAIL;
  if (imageData) {
    lines.push(`  <imageData>${imageData.replaceAll(/\s/g, "")}</imageData>`);
  } else {
    lines.push("  <imageData />");
  }
  lines.push(...vectorXml("pivotPos", pivotPosition, "  "));
  lines.push(...vectorXml("pivotRot", pivotRotation, "  "));
  lines.push(...vectorXml("camPos", cameraPosition, "  "));
  lines.push(`  <frequency>${scalar(frequency)}</frequency>`);
  lines.push(`  <timeStep>${scalar(timeStep)}</timeStep>`);
  lines.push(`  <throttling>${document.throttling ?? true}</throttling>`);
  lines.push("</SaveData>");
  return `${lines.join("\n")}\n`;
}

export function decodeCru(xml: string): CruDecodedDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("DOCTYPE and ENTITY declarations are not allowed in CRUMB files");
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(
      `Invalid XML at line ${validation.err.line}, column ${validation.err.col}: ${validation.err.msg}`,
    );
  }

  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = parsed.SaveData as Record<string, unknown> | undefined;
  if (!root || typeof root !== "object") {
    throw new Error("Expected CRUMB root element <SaveData>");
  }

  const componentContainer = root.components as Record<string, unknown> | undefined;
  const rawComponents =
    componentContainer && typeof componentContainer === "object"
      ? asArray(componentContainer.SaveComponent)
      : [];
  const components: CruDecodedComponent[] = rawComponents.map((rawComponent, index) => {
    const component = rawComponent as Record<string, unknown>;
    const toolId = numberOf(component.toolID) ?? Number.NaN;
    const data = component.data as Record<string, unknown> | undefined;
    const values =
      data && typeof data === "object" ? asArray(data.anyType).map(decodeDataValue) : [];
    const guidValue = values[0];
    const guid = guidValue?.kind === "guid" ? guidValue.value : undefined;
    return {
      index,
      toolId,
      ...(guid === undefined ? {} : { guid }),
      values,
    };
  });

  const imageData = textOf(root.imageData)?.replaceAll(/\s/g, "") ?? "";
  const pivotPosition = vectorOf(root.pivotPos);
  const pivotRotation = vectorOf(root.pivotRot);
  const cameraPosition = vectorOf(root.camPos);
  const frequency = numberOf(root.frequency);
  const timeStep = numberOf(root.timeStep);
  const throttling = booleanOf(root.throttling);
  return {
    name: textOf(root.name) ?? "",
    components,
    imageData,
    ...(pivotPosition === undefined ? {} : { pivotPosition }),
    ...(pivotRotation === undefined ? {} : { pivotRotation }),
    ...(cameraPosition === undefined ? {} : { cameraPosition }),
    ...(frequency === undefined ? {} : { frequency }),
    ...(timeStep === undefined ? {} : { timeStep }),
    ...(throttling === undefined ? {} : { throttling }),
  };
}

export function inspectCru(xml: string): CruInspection {
  const decoded = decodeCru(xml);
  const nameInfo = describeUntrustedText(decoded.name);
  const components: CruComponentInspection[] = decoded.components.map((component) => {
    const tiePoints = component.values.find(
      (value) => value.kind === "tie-point-array",
    );
    const decodedTiePoints = tiePoints?.kind === "tie-point-array" ? tiePoints.value : [];
    return {
      index: component.index,
      toolId: component.toolId,
      ...(component.guid === undefined ? {} : { guid: component.guid }),
      dataTypes: component.values.map((value) => value.type),
      tiePointIds: decodedTiePoints.map((tiePoint) => tiePoint.id),
      tiePointParents: decodedTiePoints.map((tiePoint) => tiePoint.parentIdentifier),
    };
  });
  const toolCounts: Record<string, number> = {};
  for (const component of components) {
    const key = Number.isFinite(component.toolId) ? String(component.toolId) : "invalid";
    toolCounts[key] = (toolCounts[key] ?? 0) + 1;
  }
  const imageData = decoded.imageData;
  const imageBuffer = imageData.length === 0 ? undefined : Buffer.from(imageData, "base64");
  const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");

  return {
    format: "crumb-cru",
    name: nameInfo.preview,
    nameInfo,
    componentCount: components.length,
    toolCounts,
    components,
    imageDataBytes: imageBuffer?.byteLength ?? 0,
    imageDataFormat:
      imageBuffer === undefined
        ? "none"
        : imageBuffer.subarray(0, pngSignature.byteLength).equals(pngSignature)
          ? "png"
          : "unknown",
    settings: {
      ...(decoded.frequency === undefined ? {} : { frequency: decoded.frequency }),
      ...(decoded.timeStep === undefined ? {} : { timeStep: decoded.timeStep }),
      ...(decoded.throttling === undefined ? {} : { throttling: decoded.throttling }),
    },
  };
}

export function validateCru(xml: string): CruValidation {
  let inspection: CruInspection;
  try {
    inspection = inspectCru(xml);
  } catch (error) {
    const structuralLimit =
      error instanceof CruStructuralLimitError ? error : undefined;
    return {
      valid: false,
      diagnostics: boundDiagnostics([
        {
          severity: "error",
          code:
            structuralLimit === undefined
              ? "invalid-xml-or-root"
              : "structural-token-too-long",
          path: structuralLimit?.diagnosticPath ?? "",
          message: error instanceof Error ? error.message : String(error),
        },
      ]),
    };
  }

  const diagnostics: Diagnostic[] = [];
  if (inspection.nameInfo.previewTruncated) {
    diagnostics.push({
      severity: "warning",
      code: "design-name-truncated",
      path: "SaveData.name",
      message:
        `The untrusted design name is ${inspection.nameInfo.characters} characters; ` +
        `responses include only its ${inspection.nameInfo.previewCharacters}-character preview and SHA-256 digest.`,
    });
  }
  if (inspection.nameInfo.blank) {
    diagnostics.push({
      severity: "error",
      code: "missing-name",
      path: "SaveData.name",
      message: "CRUMB save name is empty",
    });
  }
  if (inspection.imageDataFormat === "none") {
    diagnostics.push({
      severity: "warning",
      code: "missing-thumbnail",
      path: "SaveData.imageData",
      message: "Fresh CRUMB 1.3.5 saves include a PNG thumbnail; this file has none",
    });
  } else if (inspection.imageDataFormat !== "png") {
    diagnostics.push({
      severity: "warning",
      code: "unexpected-thumbnail-format",
      path: "SaveData.imageData",
      message: "Fresh CRUMB 1.3.5 saves use PNG imageData",
    });
  }

  const guids = new Set<string>();
  for (const component of inspection.components) {
    const path = `SaveData.components.SaveComponent.${component.index}`;
    if (!Number.isInteger(component.toolId) || component.toolId < 0) {
      diagnostics.push({
        severity: "error",
        code: "invalid-tool-id",
        path: `${path}.toolID`,
        message: "toolID must be a non-negative integer",
      });
    }
    if (!component.guid) {
      diagnostics.push({
        severity: "error",
        code: "missing-guid",
        path: `${path}.data.anyType.0`,
        message: "The first data value must contain the component GUID",
      });
    } else if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        component.guid,
      )
    ) {
      diagnostics.push({
        severity: "error",
        code: "invalid-guid",
        path: `${path}.data.anyType.0`,
        message: `Invalid component GUID: ${component.guid}`,
      });
    } else if (guids.has(component.guid.toLowerCase())) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-guid",
        path: `${path}.data.anyType.0`,
        message: `Duplicate component GUID: ${component.guid}`,
      });
    } else {
      guids.add(component.guid.toLowerCase());
    }
  }
  for (const component of inspection.components) {
    const path = `SaveData.components.SaveComponent.${component.index}`;
    for (const parent of component.tiePointParents) {
      if (!guids.has(parent.toLowerCase())) {
        diagnostics.push({
          severity: "error",
          code: "unknown-tie-point-parent",
          path: `${path}.data.ArrayOfTiePointID`,
          message: `Tie point references unknown component GUID: ${parent}`,
        });
      }
    }
  }

  const { frequency, timeStep } = inspection.settings;
  if (frequency === undefined || frequency <= 0) {
    diagnostics.push({
      severity: "error",
      code: "invalid-frequency",
      path: "SaveData.frequency",
      message: "frequency must be positive",
    });
  }
  if (timeStep === undefined || timeStep <= 0) {
    diagnostics.push({
      severity: "error",
      code: "invalid-time-step",
      path: "SaveData.timeStep",
      message: "timeStep must be positive",
    });
  }
  if (
    frequency !== undefined &&
    timeStep !== undefined &&
    Math.abs(frequency * timeStep - 1) > 1e-6
  ) {
    diagnostics.push({
      severity: "warning",
      code: "non-reciprocal-timing",
      path: "SaveData",
      message: "Observed CRUMB saves use frequency × timeStep = 1; this file differs",
    });
  }

  const valid = diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  return {
    valid,
    diagnostics: boundDiagnostics(diagnostics),
    inspection,
  };
}
