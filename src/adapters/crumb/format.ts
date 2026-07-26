import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import {
  boundDiagnostics,
  describeUntrustedText,
  MAX_CRU_GUID_TOKEN_CHARACTERS,
  MAX_CRU_DOCUMENT_CHARACTERS,
  MAX_CRU_MARKUP_DELIMITERS,
  MAX_CRU_NUMERIC_LEXICAL_CHARACTERS,
  MAX_CRU_TEXT_NODE_CHARACTERS,
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

export interface Vector3Lexical {
  x: string;
  y: string;
  z: string;
}

export interface QuaternionLexical {
  w: string;
  x: string;
  y: string;
  z: string;
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

export interface CruDecodedTiePoint extends CruTiePoint {
  lexical: {
    id: string;
    parentIdentifier: string;
  };
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
  imageDataEncodingValid: boolean;
  rootSpatialValuesValid: boolean;
  settings: {
    frequency?: number;
    timeStep?: number;
    throttling?: boolean;
  };
}

type CruDecodedDataValueCore =
  | { type: string; kind: "guid"; value: string; lexical: string }
  | { type: string; kind: "number"; value: number; lexical: string }
  | { type: string; kind: "boolean"; value: boolean; lexical: string }
  | { type: string; kind: "string"; value: string; lexical: string }
  | {
      type: string;
      kind: "vector3";
      value: Vector3;
      lexical: Vector3Lexical;
    }
  | {
      type: string;
      kind: "quaternion";
      value: Quaternion;
      lexical: QuaternionLexical;
    }
  | {
      type: string;
      kind: "vector3-array";
      value: Vector3[];
      lexical: Vector3Lexical[];
    }
  | {
      type: string;
      kind: "tie-point-array";
      value: CruDecodedTiePoint[];
    }
  | {
      type: string;
      kind: "boolean-array";
      value: boolean[];
      lexical: string[];
    }
  | { type: string; kind: "unknown"; keys: string[]; text?: string };

export type CruDecodedDataValue = CruDecodedDataValueCore & {
  structuralDigest?: string;
  modeledStructureComplete: boolean;
};

export interface CruDecodedComponent {
  index: number;
  toolId: number;
  guid?: string;
  values: CruDecodedDataValue[];
  structuralDigest?: string;
  modeledStructureComplete: boolean;
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
  lexical: {
    pivotPosition?: Vector3Lexical;
    pivotRotation?: Vector3Lexical;
    cameraPosition?: Vector3Lexical;
    frequency?: string;
    timeStep?: string;
    throttling?: string;
  };
  rootSpatialValuesValid: boolean;
  structuralDigest?: string;
  modeledStructureComplete: boolean;
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
  trimValues: false,
});
const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: false,
  preserveOrder: true,
});

const CRUMB_GUID_NAMESPACE_URI = "http://microsoft.com/wsdl/types/";
const XML_SCHEMA_NAMESPACE_URI = "http://www.w3.org/2001/XMLSchema";
const XML_SCHEMA_INSTANCE_NAMESPACE_URI =
  "http://www.w3.org/2001/XMLSchema-instance";
const XML_NAMESPACE_URI = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE_URI = "http://www.w3.org/2000/xmlns/";
const XML_FINITE_NUMBER_LEXICAL =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const XML_INTEGER_LEXICAL = /^[+-]?\d+$/;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

class CruStructuralLimitError extends Error {
  constructor(
    readonly diagnosticPath: string,
    label: string,
    limit: number,
    unit = "characters",
  ) {
    super(
      `A CRUMB ${label} exceeds the structural limit of ${limit} ${unit}.`,
    );
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

function requireMarkupDelimiterLimit(xml: string): void {
  let delimiters = 0;
  for (let index = 0; index < xml.length; index += 1) {
    if (xml.charCodeAt(index) !== 60) {
      continue;
    }
    delimiters += 1;
    if (delimiters > MAX_CRU_MARKUP_DELIMITERS) {
      throw new CruStructuralLimitError(
        "SaveData",
        "XML markup",
        MAX_CRU_MARKUP_DELIMITERS,
        "less-than delimiters",
      );
    }
  }
}

function requireDocumentCharacterLimit(xml: string): void {
  if (xml.length > MAX_CRU_DOCUMENT_CHARACTERS) {
    throw new CruStructuralLimitError(
      "",
      "XML document",
      MAX_CRU_DOCUMENT_CHARACTERS,
    );
  }
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function withoutFormattingWhitespace(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) {
      withoutFormattingWhitespace(entry);
    }
    return value;
  }
  const record = recordOf(value);
  if (record === undefined) {
    return value;
  }
  const hasElementChild = Object.keys(record).some(
    (key) => key !== "#text" && !key.startsWith("@_"),
  );
  for (const [key, entry] of Object.entries(record)) {
    if (
      key === "#text" &&
      hasElementChild &&
      typeof entry === "string" &&
      entry.trim().length === 0
    ) {
      delete record[key];
      continue;
    }
    withoutFormattingWhitespace(entry);
  }
  return value;
}

function requireBoundedParsedXml(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      requireBoundedParsedXml(entry);
    }
    return;
  }
  if (typeof value === "string") {
    requireStructuralToken(
      value,
      MAX_CRU_TEXT_NODE_CHARACTERS,
      "XML text node",
      "SaveData",
    );
    return;
  }
  const record = recordOf(value);
  if (record === undefined) {
    return;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (
      key !== "#text" &&
      key !== "?xml" &&
      !key.startsWith("@_")
    ) {
      requireStructuralToken(
        key,
        MAX_CRU_XML_NAME_CHARACTERS,
        "XML element-name token",
        "SaveData",
      );
    }
    requireBoundedParsedXml(entry);
  }
}

function updateStructuralHash(
  hash: ReturnType<typeof createHash>,
  value: unknown,
): void {
  if (value === null) {
    hash.update("null;");
    return;
  }
  if (typeof value === "string") {
    hash.update(`string:${Buffer.byteLength(value, "utf8")}:`);
    hash.update(value, "utf8");
    hash.update(";");
    return;
  }
  if (typeof value === "number") {
    hash.update(`number:${Number.isFinite(value) ? String(value) : "null"};`);
    return;
  }
  if (typeof value === "boolean") {
    hash.update(value ? "boolean:true;" : "boolean:false;");
    return;
  }
  if (Array.isArray(value)) {
    hash.update(`array:${value.length}:[`);
    for (const entry of value) {
      updateStructuralHash(hash, entry);
    }
    hash.update("];");
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    hash.update(`object:${keys.length}:{`);
    for (const key of keys) {
      hash.update(`key:${Buffer.byteLength(key, "utf8")}:`);
      hash.update(key, "utf8");
      hash.update(";");
      updateStructuralHash(hash, record[key]);
    }
    hash.update("};");
    return;
  }
  hash.update("unsupported;");
}

function structuralDigest(value: unknown): string {
  const hash = createHash("sha256");
  updateStructuralHash(hash, value);
  return `sha256:${hash.digest("hex")}`;
}

function isNamespaceAttribute(key: string): boolean {
  return key === "@_xmlns" || key.startsWith("@_xmlns:");
}

function hasOnlyModeledKeys(
  value: unknown,
  childKeys: readonly string[],
  attributeKeys: readonly string[] = [],
  allowText = false,
): boolean {
  const record = recordOf(value);
  if (record === undefined) {
    return value === undefined || value === null || typeof value !== "object";
  }
  const children = new Set(childKeys);
  const attributes = new Set(attributeKeys);
  return Object.keys(record).every(
    (key) =>
      (allowText && key === "#text") ||
      children.has(key) ||
      attributes.has(key) ||
      isNamespaceAttribute(key),
  );
}

function hasRequiredKeys(
  value: unknown,
  requiredKeys: readonly string[],
): boolean {
  const record = recordOf(value);
  return (
    record !== undefined &&
    requiredKeys.every((key) => Object.hasOwn(record, key))
  );
}

function simpleTextStructureComplete(value: unknown): boolean {
  return hasOnlyModeledKeys(value, [], [], true);
}

function vectorStructureComplete(
  value: unknown,
  attributeKeys: readonly string[] = [],
): boolean {
  const record = recordOf(value);
  return (
    hasRequiredKeys(value, ["x", "y", "z"]) &&
    hasOnlyModeledKeys(value, ["x", "y", "z"], attributeKeys) &&
    simpleTextStructureComplete(record?.x) &&
    simpleTextStructureComplete(record?.y) &&
    simpleTextStructureComplete(record?.z)
  );
}

function quaternionStructureComplete(
  value: unknown,
  attributeKeys: readonly string[] = [],
): boolean {
  const record = recordOf(value);
  return (
    hasRequiredKeys(value, ["w", "x", "y", "z"]) &&
    hasOnlyModeledKeys(value, ["w", "x", "y", "z"], attributeKeys) &&
    simpleTextStructureComplete(record?.w) &&
    simpleTextStructureComplete(record?.x) &&
    simpleTextStructureComplete(record?.y) &&
    simpleTextStructureComplete(record?.z)
  );
}

function namespaceBindings(
  value: unknown,
): Record<string, string> {
  const bindings: Record<string, string> = {};
  const record = recordOf(value);
  if (record === undefined) {
    return bindings;
  }
  for (const [key, rawValue] of Object.entries(record)) {
    if (!key.startsWith("@_xmlns:")) {
      continue;
    }
    const binding = textOf(rawValue);
    if (binding !== undefined) {
      bindings[key.slice("@_xmlns:".length)] = binding;
    }
  }
  return bindings;
}

function mergedNamespaceBindings(
  inherited: Readonly<Record<string, string>>,
  value: unknown,
): Record<string, string> {
  return { ...inherited, ...namespaceBindings(value) };
}

function requireBoundQName(
  name: string,
  bindings: Readonly<Record<string, string>>,
  label: "element" | "attribute",
): { namespaceUri: string; localName: string } {
  const parts = name.split(":");
  if (
    parts.length > 2 ||
    parts.some((part) => part.length === 0)
  ) {
    throw new Error(`Invalid XML ${label} qualified name: ${name}`);
  }
  if (parts.length === 1) {
    return { namespaceUri: "", localName: name };
  }
  const [prefix, localName] = parts;
  const namespaceUri = prefix === undefined ? undefined : bindings[prefix];
  if (namespaceUri === undefined) {
    throw new Error(
      `Undeclared XML namespace prefix on ${label}: ${prefix}`,
    );
  }
  return { namespaceUri, localName: localName ?? "" };
}

function requireNamespaceWellFormed(
  value: unknown,
  inherited: Readonly<Record<string, string>> = {
    xml: XML_NAMESPACE_URI,
  },
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      requireNamespaceWellFormed(entry, inherited);
    }
    return;
  }
  const record = recordOf(value);
  if (record === undefined) {
    return;
  }
  const bindings = mergedNamespaceBindings(inherited, record);
  if (
    bindings.xml !== undefined &&
    bindings.xml !== XML_NAMESPACE_URI
  ) {
    throw new Error("The reserved XML namespace prefix has an invalid binding");
  }
  const expandedAttributes = new Set<string>();
  for (const key of Object.keys(record)) {
    if (key.startsWith("@_xmlns:")) {
      const prefix = key.slice("@_xmlns:".length);
      const namespaceUri = textOf(record[key]) ?? "";
      requireStructuralToken(
        prefix,
        MAX_CRU_XML_NAME_CHARACTERS,
        "XML namespace-prefix token",
        "SaveData",
      );
      if (
        prefix === "xmlns" ||
        namespaceUri.length === 0 ||
        namespaceUri === XMLNS_NAMESPACE_URI ||
        (prefix === "xml") !== (namespaceUri === XML_NAMESPACE_URI)
      ) {
        throw new Error(
          `Invalid reserved XML namespace declaration for prefix: ${prefix}`,
        );
      }
      continue;
    }
    if (!key.startsWith("@_") || key === "@_xmlns") {
      continue;
    }
    const attributeName = key.slice("@_".length);
    requireStructuralToken(
      attributeName,
      MAX_CRU_XML_NAME_CHARACTERS,
      "XML attribute-name token",
      "SaveData",
    );
    const expanded = requireBoundQName(
      attributeName,
      bindings,
      "attribute",
    );
    const expandedName = `${expanded.namespaceUri}\u0000${expanded.localName}`;
    if (expandedAttributes.has(expandedName)) {
      throw new Error(
        `Duplicate expanded XML attribute name: ${attributeName}`,
      );
    }
    expandedAttributes.add(expandedName);
  }
  for (const [key, entry] of Object.entries(record)) {
    if (
      key === "#text" ||
      key === "?xml" ||
      key.startsWith("@_")
    ) {
      continue;
    }
    for (const child of asArray(entry)) {
      const childBindings = mergedNamespaceBindings(bindings, child);
      requireBoundQName(key, childBindings, "element");
      requireNamespaceWellFormed(child, bindings);
    }
  }
}

function requireSupportedXmlDeclaration(xml: string): void {
  const start = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (!xml.startsWith("<?xml", start)) {
    return;
  }
  const close = xml.indexOf("?>", start + 5);
  if (close < 0) {
    throw new Error("The XML declaration is not terminated");
  }
  const body = xml.slice(start + 5, close);
  if (!/^\s/.test(body)) {
    throw new Error("The XML declaration must separate xml from its attributes");
  }
  const attributes: Array<{ name: string; value: string }> = [];
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/gy;
  let cursor = 0;
  while (cursor < body.length) {
    const whitespace = /^\s+/.exec(body.slice(cursor))?.[0] ?? "";
    cursor += whitespace.length;
    if (cursor === body.length) {
      break;
    }
    pattern.lastIndex = cursor;
    const match = pattern.exec(body);
    if (match === null) {
      throw new Error("The XML declaration contains invalid attributes");
    }
    attributes.push({
      name: match[1] ?? "",
      value: match[3] ?? "",
    });
    cursor = pattern.lastIndex;
  }
  const names = attributes.map((attribute) => attribute.name);
  const allowedOrder = ["version", "encoding", "standalone"];
  if (
    names[0] !== "version" ||
    new Set(names).size !== names.length ||
    names.some((name) => !allowedOrder.includes(name)) ||
    names.some(
      (name, index) =>
        index > 0 &&
        allowedOrder.indexOf(name) <=
          allowedOrder.indexOf(names[index - 1] ?? ""),
    )
  ) {
    throw new Error(
      "The XML declaration must contain version followed by optional encoding and standalone attributes",
    );
  }
  const declaration = Object.fromEntries(
    attributes.map((attribute) => [attribute.name, attribute.value]),
  );
  if (declaration.version !== "1.0") {
    throw new Error("Only XML version 1.0 CRUMB saves are supported");
  }
  if (
    declaration.encoding !== undefined &&
    declaration.encoding.toLowerCase() !== "utf-8"
  ) {
    throw new Error(
      "CRUMB file bytes are UTF-8; a conflicting XML encoding declaration is not supported",
    );
  }
  if (
    declaration.standalone !== undefined &&
    declaration.standalone !== "yes" &&
    declaration.standalone !== "no"
  ) {
    throw new Error("XML standalone must be yes or no");
  }
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

function requireSupportedDefaultNamespaces(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      requireSupportedDefaultNamespaces(entry);
    }
    return;
  }
  const record = recordOf(value);
  if (record === undefined) {
    return;
  }
  const defaultNamespace = textOf(record["@_xmlns"]);
  if (defaultNamespace !== undefined && defaultNamespace.length > 0) {
    throw new Error(
      "CRUMB Unity saves must use unqualified elements; non-empty default XML namespaces are not supported",
    );
  }
  for (const [key, entry] of Object.entries(record)) {
    if (!key.startsWith("@_")) {
      requireSupportedDefaultNamespaces(entry);
    }
  }
}

function schemaInstanceType(
  record: Record<string, unknown> | undefined,
  namespaces: Readonly<Record<string, string>>,
): { attributeKey: string; type: string } | undefined {
  if (record === undefined) {
    return undefined;
  }
  const matches = Object.entries(record).flatMap(([key, value]) => {
    const match = /^@_([^:]+):type$/.exec(key);
    const prefix = match?.[1];
    const type = textOf(value);
    return prefix !== undefined &&
      type !== undefined &&
      namespaces[prefix] === XML_SCHEMA_INSTANCE_NAMESPACE_URI
      ? [{ attributeKey: key, type }]
      : [];
  });
  for (const match of matches) {
    requireStructuralToken(
      match.type,
      MAX_CRU_XSI_TYPE_CHARACTERS,
      "xsi:type token",
      "SaveData.components.SaveComponent.data.anyType.@xsi:type",
    );
  }
  if (matches.length > 1) {
    throw new Error("Duplicate expanded xsi:type attributes are not allowed");
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizedXmlSchemaType(
  type: string,
  namespaces: Readonly<Record<string, string>>,
): string | undefined {
  const match = /^([^:]+):([^:]+)$/.exec(type);
  const prefix = match?.[1];
  const localName = match?.[2];
  return prefix !== undefined &&
    localName !== undefined &&
    namespaces[prefix] === XML_SCHEMA_NAMESPACE_URI
    ? `xsd:${localName}`
    : undefined;
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
  if (!XML_FINITE_NUMBER_LEXICAL.test(text)) {
    return undefined;
  }
  const parsedNumber = Number(text);
  return Number.isFinite(parsedNumber) ? parsedNumber : undefined;
}

function singleOf(value: unknown): number | undefined {
  const parsedNumber = numberOf(value);
  if (parsedNumber === undefined) {
    return undefined;
  }
  const parsedSingle = Math.fround(parsedNumber);
  return Number.isFinite(parsedSingle) ? parsedSingle : undefined;
}

function integerOf(value: unknown): number | undefined {
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
  if (!XML_INTEGER_LEXICAL.test(text)) {
    return undefined;
  }
  const parsedNumber = Number(text);
  return Number.isInteger(parsedNumber) &&
    parsedNumber >= INT32_MIN &&
    parsedNumber <= INT32_MAX
    ? parsedNumber
    : undefined;
}

function booleanOf(value: unknown): boolean | undefined {
  const text = textOf(value);
  if (text === "true" || text === "1") {
    return true;
  }
  if (text === "false" || text === "0") {
    return false;
  }
  return undefined;
}

export function decodeCanonicalBase64(value: string): Buffer | undefined {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : undefined;
}

function vectorOf(value: unknown): Vector3 | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = singleOf(record.x);
  const y = singleOf(record.y);
  const z = singleOf(record.z);
  return x === undefined || y === undefined || z === undefined ? undefined : { x, y, z };
}

function vectorLexicalOf(value: unknown): Vector3Lexical | undefined {
  const record = recordOf(value);
  const x = textOf(record?.x);
  const y = textOf(record?.y);
  const z = textOf(record?.z);
  return x === undefined || y === undefined || z === undefined
    ? undefined
    : { x, y, z };
}

function quaternionOf(value: unknown): Quaternion | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const w = singleOf(record.w);
  const x = singleOf(record.x);
  const y = singleOf(record.y);
  const z = singleOf(record.z);
  return w === undefined || x === undefined || y === undefined || z === undefined
    ? undefined
    : { w, x, y, z };
}

function quaternionLexicalOf(
  value: unknown,
): QuaternionLexical | undefined {
  const record = recordOf(value);
  const w = textOf(record?.w);
  const x = textOf(record?.x);
  const y = textOf(record?.y);
  const z = textOf(record?.z);
  return w === undefined ||
    x === undefined ||
    y === undefined ||
    z === undefined
    ? undefined
    : { w, x, y, z };
}

function dataValueStructureComplete(
  value: unknown,
  decoded: CruDecodedDataValueCore,
  typeAttributeKey: string | undefined,
): boolean {
  const record = recordOf(value);
  const commonAttributes =
    typeAttributeKey === undefined ? [] : [typeAttributeKey];
  switch (decoded.kind) {
    case "guid":
    case "number":
    case "boolean":
    case "string":
      return hasOnlyModeledKeys(value, [], commonAttributes, true);
    case "vector3":
      return vectorStructureComplete(value, commonAttributes);
    case "quaternion":
      return quaternionStructureComplete(value, commonAttributes);
    case "vector3-array": {
      if (
        !hasOnlyModeledKeys(value, ["Vector3S"], commonAttributes) ||
        record === undefined
      ) {
        return false;
      }
      return asArray(record.Vector3S).every((entry) =>
        vectorStructureComplete(entry),
      );
    }
    case "tie-point-array": {
      if (
        !hasOnlyModeledKeys(value, ["TiePointID"], commonAttributes) ||
        record === undefined
      ) {
        return false;
      }
      return asArray(record.TiePointID).every((rawTiePoint) => {
        const tiePoint = recordOf(rawTiePoint);
        return (
          hasRequiredKeys(rawTiePoint, ["id", "parentIdentifier"]) &&
          hasOnlyModeledKeys(rawTiePoint, ["id", "parentIdentifier"]) &&
          simpleTextStructureComplete(tiePoint?.id) &&
          simpleTextStructureComplete(tiePoint?.parentIdentifier) &&
          integerOf(tiePoint?.id) !== undefined &&
          textOf(tiePoint?.parentIdentifier) !== undefined
        );
      });
    }
    case "boolean-array": {
      if (
        !hasOnlyModeledKeys(
          value,
          ["boolean", "Boolean"],
          commonAttributes,
        ) ||
        record === undefined
      ) {
        return false;
      }
      const hasLower = Object.hasOwn(record, "boolean");
      const hasUpper = Object.hasOwn(record, "Boolean");
      if (hasLower && hasUpper) {
        return false;
      }
      return asArray(hasLower ? record.boolean : record.Boolean).every(
        (entry) =>
          simpleTextStructureComplete(entry) &&
          booleanOf(entry) !== undefined,
      );
    }
    case "unknown":
      return false;
  }
}

function decodedValue(
  value: unknown,
  decoded: CruDecodedDataValueCore,
  typeAttributeKey: string | undefined,
): CruDecodedDataValue {
  const modeledStructureComplete = dataValueStructureComplete(
    value,
    decoded,
    typeAttributeKey,
  );
  return {
    ...decoded,
    modeledStructureComplete,
  };
}

function decodeDataValue(
  value: unknown,
  inheritedNamespaces: Readonly<Record<string, string>>,
): CruDecodedDataValue {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const namespaces = mergedNamespaceBindings(inheritedNamespaces, value);
  const typeAttribute = schemaInstanceType(record, namespaces);
  const rawType = typeAttribute?.type ?? "untyped";
  const schemaType = normalizedXmlSchemaType(rawType, namespaces);
  const type =
    schemaType ??
    (rawType.includes(":") ? `unresolved:${rawType}` : rawType);
  const text = textOf(value);
  requireStructuralToken(
    rawType,
    MAX_CRU_XSI_TYPE_CHARACTERS,
    "xsi:type token",
    "SaveData.components.SaveComponent.data.anyType.@xsi:type",
  );

  const guidTypeMatch = /^([^:]+):guid$/.exec(rawType);
  const guidPrefix = guidTypeMatch?.[1];
  const guidNamespace =
    guidPrefix === undefined ? undefined : namespaces[guidPrefix];
  if (
    guidTypeMatch !== null &&
    guidNamespace === CRUMB_GUID_NAMESPACE_URI &&
    text !== undefined
  ) {
    requireStructuralToken(
      text,
      MAX_CRU_GUID_TOKEN_CHARACTERS,
      "GUID token",
      "SaveData.components.SaveComponent.data.anyType",
    );
    return decodedValue(
      value,
      {
        type: rawType,
        kind: "guid",
        value: text,
        lexical: text,
      },
      typeAttribute?.attributeKey,
    );
  }
  if (type === "Vector3S") {
    const vector = vectorOf(record);
    const lexical = vectorLexicalOf(record);
    if (vector && lexical) {
      return decodedValue(
        value,
        { type, kind: "vector3", value: vector, lexical },
        typeAttribute?.attributeKey,
      );
    }
  }
  if (type === "QuaternionS") {
    const quaternion = quaternionOf(record);
    const lexical = quaternionLexicalOf(record);
    if (quaternion && lexical) {
      return decodedValue(
        value,
        {
          type,
          kind: "quaternion",
          value: quaternion,
          lexical,
        },
        typeAttribute?.attributeKey,
      );
    }
  }
  if (type === "ArrayOfVector3S") {
    const decodedVectors = asArray(record?.Vector3S)
      .map((rawVector) => ({
        value: vectorOf(rawVector),
        lexical: vectorLexicalOf(rawVector),
      }))
      .filter(
        (
          entry,
        ): entry is {
          value: Vector3;
          lexical: Vector3Lexical;
        } => entry.value !== undefined && entry.lexical !== undefined,
      );
    return decodedValue(
      value,
      {
        type,
        kind: "vector3-array",
        value: decodedVectors.map((entry) => entry.value),
        lexical: decodedVectors.map((entry) => entry.lexical),
      },
      typeAttribute?.attributeKey,
    );
  }
  if (type === "ArrayOfTiePointID") {
    const tiePoints = asArray(record?.TiePointID)
      .map((rawTiePoint) => {
        if (!rawTiePoint || typeof rawTiePoint !== "object") {
          return undefined;
        }
        const tiePoint = rawTiePoint as Record<string, unknown>;
        const id = integerOf(tiePoint.id);
        const idLexical = textOf(tiePoint.id);
        const parentIdentifier = textOf(tiePoint.parentIdentifier);
        if (parentIdentifier !== undefined) {
          requireStructuralToken(
            parentIdentifier,
            MAX_CRU_GUID_TOKEN_CHARACTERS,
            "tie-point parent GUID token",
            "SaveData.components.SaveComponent.data.ArrayOfTiePointID.parentIdentifier",
          );
        }
        return id === undefined ||
          idLexical === undefined ||
          parentIdentifier === undefined
          ? undefined
          : {
              id,
              parentIdentifier,
              lexical: {
                id: idLexical,
                parentIdentifier,
              },
            };
      })
      .filter(
        (tiePoint): tiePoint is CruDecodedTiePoint =>
          tiePoint !== undefined,
      );
    return decodedValue(
      value,
      {
        type,
        kind: "tie-point-array",
        value: tiePoints,
      },
      typeAttribute?.attributeKey,
    );
  }
  if (type === "ArrayOfBoolean") {
    const decodedBooleans = asArray(record?.boolean ?? record?.Boolean)
      .map((rawBoolean) => ({
        value: booleanOf(rawBoolean),
        lexical: textOf(rawBoolean),
      }))
      .filter(
        (
          entry,
        ): entry is { value: boolean; lexical: string } =>
          entry.value !== undefined && entry.lexical !== undefined,
      );
    return decodedValue(
      value,
      {
        type,
        kind: "boolean-array",
        value: decodedBooleans.map((entry) => entry.value),
        lexical: decodedBooleans.map((entry) => entry.lexical),
      },
      typeAttribute?.attributeKey,
    );
  }
  if (schemaType === "xsd:boolean") {
    const parsedBoolean = booleanOf(value);
    if (parsedBoolean !== undefined) {
      return decodedValue(
        value,
        {
          type,
          kind: "boolean",
          value: parsedBoolean,
          lexical: text ?? "",
        },
        typeAttribute?.attributeKey,
      );
    }
  }
  if (
    schemaType === "xsd:int" ||
    schemaType === "xsd:float" ||
    schemaType === "xsd:double"
  ) {
    const parsedNumber =
      schemaType === "xsd:int"
        ? integerOf(value)
        : schemaType === "xsd:float"
          ? singleOf(value)
          : numberOf(value);
    if (parsedNumber !== undefined) {
      return decodedValue(
        value,
        {
          type,
          kind: "number",
          value: parsedNumber,
          lexical: text ?? "",
        },
        typeAttribute?.attributeKey,
      );
    }
  }
  if (schemaType === "xsd:string") {
    return decodedValue(
      value,
      {
        type,
        kind: "string",
        value: text ?? "",
        lexical: text ?? "",
      },
      typeAttribute?.attributeKey,
    );
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
  return decodedValue(
    value,
    {
      type,
      kind: "unknown",
      keys,
      ...(text === undefined ? {} : { text }),
    },
    typeAttribute?.attributeKey,
  );
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

function decodedComponentEnvelopeComplete(
  rawComponent: unknown,
  data: unknown,
): boolean {
  const component = recordOf(rawComponent);
  const dataRecord = recordOf(data);
  return (
    component !== undefined &&
    hasOnlyModeledKeys(rawComponent, ["toolID", "data"]) &&
    simpleTextStructureComplete(component.toolID) &&
    integerOf(component.toolID) !== undefined &&
    dataRecord !== undefined &&
    hasOnlyModeledKeys(data, ["anyType"])
  );
}

function decodedDocumentEnvelopeComplete(
  root: Record<string, unknown>,
  componentContainer: unknown,
): boolean {
  const container = recordOf(componentContainer);
  const containerComplete =
    componentContainer === undefined ||
    componentContainer === null ||
    componentContainer === "" ||
    (container !== undefined &&
      hasOnlyModeledKeys(componentContainer, ["SaveComponent"]));
  const imageData = textOf(root.imageData)?.replaceAll(/\s/g, "");
  return (
    hasOnlyModeledKeys(root, [
      "name",
      "components",
      "imageData",
      "pivotPos",
      "pivotRot",
      "camPos",
      "frequency",
      "timeStep",
      "throttling",
    ]) &&
    simpleTextStructureComplete(root.name) &&
    containerComplete &&
    simpleTextStructureComplete(root.imageData) &&
    (imageData === undefined || decodeCanonicalBase64(imageData) !== undefined) &&
    (root.pivotPos === undefined ||
      (vectorStructureComplete(root.pivotPos) &&
        vectorOf(root.pivotPos) !== undefined)) &&
    (root.pivotRot === undefined ||
      (vectorStructureComplete(root.pivotRot) &&
        vectorOf(root.pivotRot) !== undefined)) &&
    (root.camPos === undefined ||
      (vectorStructureComplete(root.camPos) &&
        vectorOf(root.camPos) !== undefined)) &&
    (root.frequency === undefined ||
      (simpleTextStructureComplete(root.frequency) &&
        singleOf(root.frequency) !== undefined)) &&
    (root.timeStep === undefined ||
      (simpleTextStructureComplete(root.timeStep) &&
        singleOf(root.timeStep) !== undefined)) &&
    (root.throttling === undefined ||
      (simpleTextStructureComplete(root.throttling) &&
        booleanOf(root.throttling) !== undefined))
  );
}

function orderedElementNodes(
  content: unknown,
  elementName: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((entry) => {
    const record = recordOf(entry);
    return record !== undefined && Object.hasOwn(record, elementName)
      ? [record]
      : [];
  });
}

function firstOrderedElementNode(
  content: unknown,
  elementName: string,
): Record<string, unknown> | undefined {
  return orderedElementNodes(content, elementName)[0];
}

function orderedCruStructure(xml: string): {
  root?: Record<string, unknown>;
  components: Array<{
    node: Record<string, unknown>;
    values: Array<Record<string, unknown>>;
  }>;
} {
  const parsed = orderedParser.parse(xml) as unknown;
  const root = firstOrderedElementNode(parsed, "SaveData");
  const rootContent = root?.SaveData;
  const componentsNode = firstOrderedElementNode(
    rootContent,
    "components",
  );
  const componentNodes = orderedElementNodes(
    componentsNode?.components,
    "SaveComponent",
  );
  return {
    ...(root === undefined ? {} : { root }),
    components: componentNodes.map((node) => {
      const dataNode = firstOrderedElementNode(
        node.SaveComponent,
        "data",
      );
      return {
        node,
        values: orderedElementNodes(dataNode?.data, "anyType"),
      };
    }),
  };
}

export function decodeCru(xml: string): CruDecodedDocument {
  requireDocumentCharacterLimit(xml);
  requireSupportedXmlDeclaration(xml);
  requireMarkupDelimiterLimit(xml);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("DOCTYPE and ENTITY declarations are not allowed in CRUMB files");
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(
      `Invalid XML at line ${validation.err.line}, column ${validation.err.col}: ${validation.err.msg}`,
    );
  }

  const parsed = withoutFormattingWhitespace(
    parser.parse(xml),
  ) as Record<string, unknown>;
  requireBoundedParsedXml(parsed);
  requireNamespaceWellFormed(parsed);
  requireSupportedDefaultNamespaces(parsed);
  const root = parsed.SaveData as Record<string, unknown> | undefined;
  if (!root || typeof root !== "object") {
    throw new Error("Expected CRUMB root element <SaveData>");
  }

  const rootNamespaces = namespaceBindings(root);
  const componentContainer = root.components;
  const componentContainerRecord = recordOf(componentContainer);
  const componentContainerNamespaces = mergedNamespaceBindings(
    rootNamespaces,
    componentContainer,
  );
  const rawComponents =
    componentContainerRecord !== undefined
      ? asArray(componentContainerRecord.SaveComponent)
      : [];
  const componentEnvelopeCompleteness: boolean[] = [];
  const rawDataValuesByComponent: unknown[][] = [];
  const components: CruDecodedComponent[] = rawComponents.map((rawComponent, index) => {
    const component = rawComponent as Record<string, unknown>;
    const toolId = integerOf(component.toolID) ?? Number.NaN;
    const componentNamespaces = mergedNamespaceBindings(
      componentContainerNamespaces,
      component,
    );
    const data = component.data;
    const dataRecord = recordOf(data);
    const dataNamespaces = mergedNamespaceBindings(componentNamespaces, data);
    const values =
      dataRecord === undefined
        ? []
        : asArray(dataRecord.anyType).map((value) =>
            decodeDataValue(value, dataNamespaces),
          );
    rawDataValuesByComponent.push(
      dataRecord === undefined ? [] : asArray(dataRecord.anyType),
    );
    const guidValue = values[0];
    const guid = guidValue?.kind === "guid" ? guidValue.value : undefined;
    const envelopeComplete = decodedComponentEnvelopeComplete(
      rawComponent,
      data,
    );
    componentEnvelopeCompleteness.push(envelopeComplete);
    return {
      index,
      toolId,
      ...(guid === undefined ? {} : { guid }),
      values,
      modeledStructureComplete:
        envelopeComplete &&
        values.every((value) => value.modeledStructureComplete),
    };
  });

  const imageData = textOf(root.imageData)?.replaceAll(/\s/g, "") ?? "";
  const pivotPosition = vectorOf(root.pivotPos);
  const pivotPositionLexical = vectorLexicalOf(root.pivotPos);
  const pivotRotation = vectorOf(root.pivotRot);
  const pivotRotationLexical = vectorLexicalOf(root.pivotRot);
  const cameraPosition = vectorOf(root.camPos);
  const cameraPositionLexical = vectorLexicalOf(root.camPos);
  const frequency = singleOf(root.frequency);
  const frequencyLexical = textOf(root.frequency);
  const timeStep = singleOf(root.timeStep);
  const timeStepLexical = textOf(root.timeStep);
  const throttling = booleanOf(root.throttling);
  const throttlingLexical = textOf(root.throttling);
  const documentEnvelopeComplete = decodedDocumentEnvelopeComplete(
    root,
    componentContainer,
  );
  const decoded: CruDecodedDocument = {
    name: textOf(root.name) ?? "",
    components,
    imageData,
    ...(pivotPosition === undefined ? {} : { pivotPosition }),
    ...(pivotRotation === undefined ? {} : { pivotRotation }),
    ...(cameraPosition === undefined ? {} : { cameraPosition }),
    ...(frequency === undefined ? {} : { frequency }),
    ...(timeStep === undefined ? {} : { timeStep }),
    ...(throttling === undefined ? {} : { throttling }),
    lexical: {
      ...(pivotPositionLexical === undefined
        ? {}
        : { pivotPosition: pivotPositionLexical }),
      ...(pivotRotationLexical === undefined
        ? {}
        : { pivotRotation: pivotRotationLexical }),
      ...(cameraPositionLexical === undefined
        ? {}
        : { cameraPosition: cameraPositionLexical }),
      ...(frequencyLexical === undefined
        ? {}
        : { frequency: frequencyLexical }),
      ...(timeStepLexical === undefined
        ? {}
        : { timeStep: timeStepLexical }),
      ...(throttlingLexical === undefined
        ? {}
        : { throttling: throttlingLexical }),
    },
    rootSpatialValuesValid:
      (root.pivotPos === undefined || pivotPosition !== undefined) &&
      (root.pivotRot === undefined || pivotRotation !== undefined) &&
      (root.camPos === undefined || cameraPosition !== undefined),
    modeledStructureComplete:
      documentEnvelopeComplete &&
      components.every((component) => component.modeledStructureComplete),
  };
  if (!decoded.modeledStructureComplete) {
    const ordered = orderedCruStructure(xml);
    for (const [componentIndex, component] of components.entries()) {
      const orderedComponent = ordered.components[componentIndex];
      if (!componentEnvelopeCompleteness[componentIndex]) {
        component.structuralDigest = structuralDigest(
          orderedComponent?.node ?? rawComponents[componentIndex],
        );
      }
      const rawValues = rawDataValuesByComponent[componentIndex] ?? [];
      for (const [valueIndex, value] of component.values.entries()) {
        if (!value.modeledStructureComplete) {
          value.structuralDigest = structuralDigest(
            orderedComponent?.values[valueIndex] ?? rawValues[valueIndex],
          );
        }
      }
    }
    if (!documentEnvelopeComplete) {
      decoded.structuralDigest = structuralDigest(ordered.root ?? root);
    }
  }
  return decoded;
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
  const imageBuffer =
    imageData.length === 0 ? Buffer.alloc(0) : decodeCanonicalBase64(imageData);
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
      imageData.length === 0
        ? "none"
        : imageBuffer
              ?.subarray(0, pngSignature.byteLength)
              .equals(pngSignature)
          ? "png"
          : "unknown",
    imageDataEncodingValid: imageBuffer !== undefined,
    rootSpatialValuesValid: decoded.rootSpatialValuesValid,
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
  } else if (!inspection.imageDataEncodingValid) {
    diagnostics.push({
      severity: "error",
      code: "invalid-thumbnail-base64",
      path: "SaveData.imageData",
      message: "imageData must use canonical base64 encoding",
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
  if (inspection.settings.throttling === undefined) {
    diagnostics.push({
      severity: "error",
      code: "invalid-throttling",
      path: "SaveData.throttling",
      message: "throttling must be true, false, 1, or 0",
    });
  }
  if (!inspection.rootSpatialValuesValid) {
    diagnostics.push({
      severity: "error",
      code: "invalid-root-spatial-value",
      path: "SaveData",
      message:
        "pivotPos, pivotRot, and camPos values must use finite Unity float32 decimal forms",
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
