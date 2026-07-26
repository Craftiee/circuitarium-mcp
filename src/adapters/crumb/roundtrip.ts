import { createHash } from "node:crypto";

import { SaxesParser, type SaxesTagPlain } from "saxes";

import { getCrumbComponentDefinition } from "./catalog.js";
import {
  decodeCru,
  validateCru,
  type CruDecodedDocument,
  type Quaternion,
  type Vector3,
} from "./format.js";
import { MAX_CRU_BYTES } from "./io.js";
import {
  MAX_CRU_XML_DEPTH,
  MAX_CRU_XML_ELEMENTS,
} from "../../domain/bounds.js";

export interface CruByteSpan {
  readonly start: number;
  readonly end: number;
}

export interface CruElementSpan {
  readonly whole: CruByteSpan;
  readonly content: CruByteSpan;
  readonly selfClosing: boolean;
  readonly hasStructuredContent: boolean;
}

export interface CruAnyTypeSyntax extends CruElementSpan {
  readonly xsiType?: string;
  readonly opaque: boolean;
  readonly childElements: Readonly<Record<string, readonly CruElementSpan[]>>;
}

export interface CruComponentSyntax {
  readonly index: number;
  readonly whole: CruByteSpan;
  readonly toolId?: CruElementSpan;
  readonly values: readonly CruAnyTypeSyntax[];
}

export interface CruSyntaxIndex {
  readonly root: CruElementSpan;
  readonly name?: CruElementSpan;
  readonly imageData?: CruElementSpan;
  readonly frequency?: CruElementSpan;
  readonly timeStep?: CruElementSpan;
  readonly throttling?: CruElementSpan;
  readonly components: readonly CruComponentSyntax[];
}

export interface CruRoundTripDocument {
  readonly sourceSha256: `sha256:${string}`;
  readonly decoded: CruDecodedDocument;
  readonly syntax: CruSyntaxIndex;
}

export interface CruEditOptions {
  readonly expectedSha256: string;
}

interface CruBytePatch {
  readonly span: CruByteSpan;
  readonly replacement: Uint8Array;
}

/** The source cannot be represented by the CRUMB UTF-8 round-trip layer. */
export class CruRoundTripEncodingError extends Error {}

/** The XML syntax index and semantic CRUMB decoder disagree. */
export class CruRoundTripIndexError extends Error {}

/** A requested source patch is stale, overlapping, or out of bounds. */
export class CruRoundTripPatchError extends Error {}

/** The requested edit is not safe for the selected CRUMB payload. */
export class CruUnsupportedEditError extends Error {}

interface PrivateRoundTripState {
  readonly source: Buffer;
}

interface InternalElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly startChar: number;
  readonly contentStartChar: number;
  readonly contentEndChar: number;
  readonly endChar: number;
  readonly selfClosing: boolean;
  readonly hasStructuredContent: boolean;
  readonly children: readonly InternalElement[];
}

interface OpenElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly startChar: number;
  readonly contentStartChar: number;
  readonly selfClosing: boolean;
  hasStructuredContent: boolean;
  readonly children: InternalElement[];
}

const privateStates = new WeakMap<CruRoundTripDocument, PrivateRoundTripState>();
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);
const OFFSET_CHECKPOINT_INTERVAL = 4_096;

function sha256(source: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      freezeDeep(nested);
    }
  }
  return value;
}

class Utf8ByteOffsetIndex {
  readonly #charOffsets: number[] = [0];
  readonly #byteOffsets: number[] = [0];

  constructor(
    readonly text: string,
    readonly bytePrefix: number,
  ) {
    let previousChar = 0;
    let bytes = 0;
    for (
      let tentative = OFFSET_CHECKPOINT_INTERVAL;
      tentative < text.length;
      tentative += OFFSET_CHECKPOINT_INTERVAL
    ) {
      let boundary = tentative;
      const previous = text.charCodeAt(boundary - 1);
      const current = text.charCodeAt(boundary);
      if (
        previous >= 0xd800 &&
        previous <= 0xdbff &&
        current >= 0xdc00 &&
        current <= 0xdfff
      ) {
        boundary += 1;
      }
      if (boundary <= previousChar) {
        continue;
      }
      bytes += Buffer.byteLength(text.slice(previousChar, boundary), "utf8");
      this.#charOffsets.push(boundary);
      this.#byteOffsets.push(bytes);
      previousChar = boundary;
    }
  }

  toByte(characterOffset: number): number {
    if (
      !Number.isInteger(characterOffset) ||
      characterOffset < 0 ||
      characterOffset > this.text.length
    ) {
      throw new CruRoundTripIndexError(
        `XML character offset is outside the source: ${characterOffset}`,
      );
    }
    if (
      characterOffset > 0 &&
      characterOffset < this.text.length &&
      this.text.charCodeAt(characterOffset - 1) >= 0xd800 &&
      this.text.charCodeAt(characterOffset - 1) <= 0xdbff &&
      this.text.charCodeAt(characterOffset) >= 0xdc00 &&
      this.text.charCodeAt(characterOffset) <= 0xdfff
    ) {
      throw new CruRoundTripIndexError(
        `XML parser returned an offset inside a Unicode surrogate pair: ${characterOffset}`,
      );
    }

    let low = 0;
    let high = this.#charOffsets.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((this.#charOffsets[middle] ?? 0) <= characterOffset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    const checkpointChar = this.#charOffsets[low] ?? 0;
    const checkpointBytes = this.#byteOffsets[low] ?? 0;
    return (
      this.bytePrefix +
      checkpointBytes +
      Buffer.byteLength(this.text.slice(checkpointChar, characterOffset), "utf8")
    );
  }
}

function decodeUtf8(source: Buffer): { text: string; bytePrefix: number } {
  if (
    source.subarray(0, UTF16_LE_BOM.length).equals(UTF16_LE_BOM) ||
    source.subarray(0, UTF16_BE_BOM.length).equals(UTF16_BE_BOM)
  ) {
    throw new CruRoundTripEncodingError(
      "CRUMB round-trip editing supports UTF-8 XML only; UTF-16 BOM detected",
    );
  }
  const bytePrefix = source.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)
    ? UTF8_BOM.length
    : 0;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      source.subarray(bytePrefix),
    );
  } catch (error) {
    throw new CruRoundTripEncodingError(
      `CRUMB source is not valid UTF-8: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { text, bytePrefix };
}

function locateOpeningTag(text: string, parserPosition: number): number {
  const start = text.lastIndexOf("<", Math.max(0, parserPosition - 1));
  if (start < 0 || text.startsWith("</", start)) {
    throw new CruRoundTripIndexError("Could not locate the current XML opening tag");
  }
  return start;
}

function parseElementTree(text: string): InternalElement {
  const parser = new SaxesParser({ xmlns: false, position: true });
  const stack: OpenElement[] = [];
  let root: InternalElement | undefined;
  let pendingStart: number | undefined;
  let parseError: Error | undefined;
  let elementCount = 0;

  parser.on("xmldecl", (declaration) => {
    if (declaration.version !== "1.0") {
      parseError ??= new CruRoundTripEncodingError(
        `CRUMB round-trip editing supports XML 1.0 only; declaration uses ${declaration.version}`,
      );
    }
    const encoding = declaration.encoding?.toLowerCase();
    if (encoding !== undefined && encoding !== "utf-8" && encoding !== "utf8") {
      parseError ??= new CruRoundTripEncodingError(
        `CRUMB round-trip editing supports UTF-8 XML only; declaration uses ${declaration.encoding}`,
      );
    }
  });
  parser.on("doctype", () => {
    parseError ??= new CruRoundTripIndexError(
      "DOCTYPE and ENTITY declarations are not allowed in CRUMB files",
    );
  });
  parser.on("error", (error) => {
    parseError ??= error;
  });
  parser.on("opentagstart", () => {
    pendingStart = locateOpeningTag(text, parser.position);
  });
  parser.on("opentag", (tag: SaxesTagPlain) => {
    if (pendingStart === undefined) {
      parseError ??= new CruRoundTripIndexError(
        `Missing source position for opening tag <${tag.name}>`,
      );
      return;
    }
    elementCount += 1;
    if (elementCount > MAX_CRU_XML_ELEMENTS) {
      throw new CruRoundTripIndexError(
        `CRUMB XML exceeds the ${MAX_CRU_XML_ELEMENTS}-element round-trip limit`,
      );
    }
    if (stack.length + 1 > MAX_CRU_XML_DEPTH) {
      throw new CruRoundTripIndexError(
        `CRUMB XML exceeds the ${MAX_CRU_XML_DEPTH}-level round-trip limit`,
      );
    }
    const parent = stack.at(-1);
    if (parent) {
      parent.hasStructuredContent = true;
    }
    stack.push({
      name: tag.name,
      attributes: { ...tag.attributes },
      startChar: pendingStart,
      contentStartChar: parser.position,
      selfClosing: tag.isSelfClosing,
      hasStructuredContent: false,
      children: [],
    });
    pendingStart = undefined;
  });
  const markStructuredContent = (): void => {
    const current = stack.at(-1);
    if (current) {
      current.hasStructuredContent = true;
    }
  };
  parser.on("comment", markStructuredContent);
  parser.on("cdata", markStructuredContent);
  parser.on("processinginstruction", markStructuredContent);
  parser.on("closetag", (tag: SaxesTagPlain) => {
    const open = stack.pop();
    if (!open || open.name !== tag.name) {
      parseError ??= new CruRoundTripIndexError(
        `XML close-tag stack disagrees at </${tag.name}>`,
      );
      return;
    }
    const endChar = parser.position;
    const contentEndChar = open.selfClosing
      ? open.contentStartChar
      : text.lastIndexOf("</", Math.max(0, endChar - 1));
    if (
      contentEndChar < open.contentStartChar ||
      endChar < contentEndChar
    ) {
      parseError ??= new CruRoundTripIndexError(
        `Could not locate the closing source span for <${tag.name}>`,
      );
      return;
    }
    const element: InternalElement = {
      ...open,
      contentEndChar,
      endChar,
      children: open.children,
    };
    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(element);
    } else if (root === undefined) {
      root = element;
    } else {
      parseError ??= new CruRoundTripIndexError(
        "Expected exactly one XML root element",
      );
    }
  });

  try {
    parser.write(text).close();
  } catch (error) {
    parseError ??= error instanceof Error ? error : new Error(String(error));
  }
  if (parseError) {
    throw parseError;
  }
  if (!root || stack.length !== 0) {
    throw new CruRoundTripIndexError("Expected one complete XML root element");
  }
  return root;
}

function directChild(
  parent: InternalElement | undefined,
  name: string,
): InternalElement | undefined {
  return parent?.children.find((child) => child.name === name);
}

function spanOf(
  element: InternalElement,
  offsets: Utf8ByteOffsetIndex,
): CruElementSpan {
  return freezeDeep({
    whole: {
      start: offsets.toByte(element.startChar),
      end: offsets.toByte(element.endChar),
    },
    content: {
      start: offsets.toByte(element.contentStartChar),
      end: offsets.toByte(element.contentEndChar),
    },
    selfClosing: element.selfClosing,
    hasStructuredContent: element.hasStructuredContent,
  });
}

function childSpanRecord(
  element: InternalElement,
  offsets: Utf8ByteOffsetIndex,
): Readonly<Record<string, readonly CruElementSpan[]>> {
  const record = Object.create(null) as Record<string, CruElementSpan[]>;
  for (const child of element.children) {
    const spans = record[child.name] ?? [];
    spans.push(spanOf(child, offsets));
    record[child.name] = spans;
  }
  return freezeDeep(record);
}

function buildSyntaxIndex(
  root: InternalElement,
  decoded: CruDecodedDocument,
  offsets: Utf8ByteOffsetIndex,
): CruSyntaxIndex {
  if (root.name !== "SaveData") {
    throw new CruRoundTripIndexError("Expected CRUMB root element <SaveData>");
  }
  const componentContainer = directChild(root, "components");
  const rawComponents =
    componentContainer?.children.filter((child) => child.name === "SaveComponent") ??
    [];
  if (rawComponents.length !== decoded.components.length) {
    throw new CruRoundTripIndexError(
      `Syntax found ${rawComponents.length} components but semantic decode found ${decoded.components.length}`,
    );
  }

  const components = rawComponents.map((component, index): CruComponentSyntax => {
    const data = directChild(component, "data");
    const rawValues = data?.children.filter((child) => child.name === "anyType") ?? [];
    const decodedComponent = decoded.components[index];
    if (!decodedComponent || rawValues.length !== decodedComponent.values.length) {
      throw new CruRoundTripIndexError(
        `Component ${index} has ${rawValues.length} syntax values but ${
          decodedComponent?.values.length ?? 0
        } semantic values`,
      );
    }
    return freezeDeep({
      index,
      whole: spanOf(component, offsets).whole,
      ...(directChild(component, "toolID")
        ? { toolId: spanOf(directChild(component, "toolID")!, offsets) }
        : {}),
      values: rawValues.map((value, valueIndex): CruAnyTypeSyntax => {
        const decodedValue = decodedComponent.values[valueIndex];
        const base = spanOf(value, offsets);
        return freezeDeep({
          ...base,
          ...(value.attributes["xsi:type"] === undefined
            ? {}
            : { xsiType: value.attributes["xsi:type"] }),
          opaque: decodedValue?.kind === "unknown",
          childElements: childSpanRecord(value, offsets),
        });
      }),
    });
  });

  const optionalSpan = (name: string): CruElementSpan | undefined => {
    const element = directChild(root, name);
    return element === undefined ? undefined : spanOf(element, offsets);
  };
  const name = optionalSpan("name");
  const imageData = optionalSpan("imageData");
  const frequency = optionalSpan("frequency");
  const timeStep = optionalSpan("timeStep");
  const throttling = optionalSpan("throttling");
  return freezeDeep({
    root: spanOf(root, offsets),
    ...(name === undefined ? {} : { name }),
    ...(imageData === undefined ? {} : { imageData }),
    ...(frequency === undefined ? {} : { frequency }),
    ...(timeStep === undefined ? {} : { timeStep }),
    ...(throttling === undefined ? {} : { throttling }),
    components,
  });
}

function stateOf(document: CruRoundTripDocument): PrivateRoundTripState {
  const state = privateStates.get(document);
  if (!state) {
    throw new CruRoundTripPatchError(
      "Round-trip documents must be created by decodeCruRoundTrip",
    );
  }
  return state;
}

function assertExpectedDigest(
  document: CruRoundTripDocument,
  options: CruEditOptions,
): void {
  stateOf(document);
  if (options.expectedSha256 !== document.sourceSha256) {
    throw new CruRoundTripPatchError(
      `Stale CRUMB source digest: expected ${options.expectedSha256}, current ${document.sourceSha256}`,
    );
  }
}

/**
 * Decodes one UTF-8 CRUMB XML file while retaining its exact bytes privately.
 * The returned semantic and syntax views are recursively immutable.
 */
export function decodeCruRoundTrip(source: Uint8Array): CruRoundTripDocument {
  if (source.byteLength > MAX_CRU_BYTES) {
    throw new CruRoundTripEncodingError(
      `CRUMB source exceeds the ${MAX_CRU_BYTES}-byte round-trip safety limit`,
    );
  }
  const bytes = Buffer.from(source);
  const { text, bytePrefix } = decodeUtf8(bytes);
  const root = parseElementTree(text);
  const decoded = freezeDeep(decodeCru(text));
  const validation = validateCru(text);
  if (!validation.valid) {
    const diagnostic = validation.diagnostics.find(
      (entry) => entry.severity === "error",
    );
    throw new CruRoundTripIndexError(
      `CRUMB source is structurally invalid: ${
        diagnostic?.code ?? "unknown"
      } at ${diagnostic?.path ?? ""}${
        diagnostic?.message === undefined ? "" : ` - ${diagnostic.message}`
      }`,
    );
  }
  const offsets = new Utf8ByteOffsetIndex(text, bytePrefix);
  const document = freezeDeep({
    sourceSha256: sha256(bytes),
    decoded,
    syntax: buildSyntaxIndex(root, decoded, offsets),
  });
  privateStates.set(document, { source: bytes });
  return document;
}

/** Returns a defensive copy of the exact current XML bytes. */
export function serializeCruRoundTrip(document: CruRoundTripDocument): Buffer {
  return Buffer.from(stateOf(document).source);
}

function validatePatches(
  sourceBytes: number,
  patches: readonly CruBytePatch[],
): CruBytePatch[] {
  const ordered = patches
    .map((patch) => ({
      span: { ...patch.span },
      replacement: patch.replacement,
    }))
    .sort((left, right) => left.span.start - right.span.start);
  let previous: CruBytePatch | undefined;
  for (const patch of ordered) {
    if (
      !Number.isInteger(patch.span.start) ||
      !Number.isInteger(patch.span.end) ||
      patch.span.start < 0 ||
      patch.span.end < patch.span.start ||
      patch.span.end > sourceBytes
    ) {
      throw new CruRoundTripPatchError(
        `CRUMB byte patch is outside the source: ${patch.span.start}..${patch.span.end}`,
      );
    }
    if (
      previous &&
      (patch.span.start < previous.span.end ||
        patch.span.start === previous.span.start)
    ) {
      throw new CruRoundTripPatchError(
        `CRUMB byte patches overlap at ${patch.span.start}`,
      );
    }
    previous = patch;
  }
  return ordered;
}

/**
 * Atomically applies byte patches, then performs a fresh UTF-8 decode, syntax
 * index, semantic decode, and structural validation before returning.
 */
function applyCruBytePatches(
  document: CruRoundTripDocument,
  patches: readonly CruBytePatch[],
  options: CruEditOptions,
): CruRoundTripDocument {
  const state = stateOf(document);
  assertExpectedDigest(document, options);
  if (patches.length === 0) {
    return document;
  }
  const ordered = validatePatches(state.source.byteLength, patches);
  let outputBytes = state.source.byteLength;
  for (const patch of ordered) {
    outputBytes +=
      patch.replacement.byteLength - (patch.span.end - patch.span.start);
    if (!Number.isSafeInteger(outputBytes) || outputBytes > MAX_CRU_BYTES) {
      throw new CruRoundTripPatchError(
        `Patched CRUMB source exceeds the ${MAX_CRU_BYTES}-byte safety limit`,
      );
    }
  }
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  for (const patch of ordered) {
    chunks.push(state.source.subarray(cursor, patch.span.start));
    chunks.push(patch.replacement);
    cursor = patch.span.end;
  }
  chunks.push(state.source.subarray(cursor));
  const output = Buffer.concat(chunks, outputBytes);
  try {
    return decodeCruRoundTrip(output);
  } catch (error) {
    throw new CruRoundTripPatchError(
      `Patched CRUMB source was rejected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertXmlText(value: string): void {
  for (let offset = 0; offset < value.length; ) {
    const point = value.codePointAt(offset);
    if (
      point === undefined ||
      point === 0 ||
      (point < 0x20 && point !== 0x09 && point !== 0x0a && point !== 0x0d) ||
      (point >= 0xd800 && point <= 0xdfff) ||
      point === 0xfffe ||
      point === 0xffff
    ) {
      throw new CruUnsupportedEditError(
        `Text contains a character XML 1.0 cannot represent at offset ${offset}`,
      );
    }
    offset += point > 0xffff ? 2 : 1;
  }
}

function escapeXmlText(value: string): string {
  assertXmlText(value);
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlTextReplacement(value: string): Buffer {
  assertXmlText(value);
  let escapedBytes = Buffer.byteLength(value, "utf8");
  for (const character of value) {
    if (character === "&") {
      escapedBytes += 4;
    } else if (character === "<" || character === ">") {
      escapedBytes += 3;
    } else if (character === '"' || character === "'") {
      escapedBytes += 5;
    }
    if (escapedBytes > MAX_CRU_BYTES) {
      throw new CruUnsupportedEditError(
        `Escaped CRUMB text exceeds the ${MAX_CRU_BYTES}-byte safety limit`,
      );
    }
  }
  return Buffer.from(escapeXmlText(value), "utf8");
}

function canonicalNumber(value: number, type: string): string {
  if (!Number.isFinite(value)) {
    throw new CruUnsupportedEditError("CRUMB scalar numbers must be finite");
  }
  if (type === "xsd:int") {
    if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
      throw new CruUnsupportedEditError(
        `xsd:int must be a signed 32-bit integer; received ${value}`,
      );
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (type === "xsd:float") {
    const floatValue = Math.fround(value);
    if (
      !Number.isFinite(floatValue) ||
      (value !== 0 && floatValue === 0)
    ) {
      throw new CruUnsupportedEditError(
        `xsd:float must be representable as a finite 32-bit float; received ${value}`,
      );
    }
  }
  const lexical = Object.is(value, -0) ? "0" : String(value);
  return lexical.replace("e", "E");
}

/** Renames the design by replacing only the root name element's content. */
export function renameCruDesign(
  document: CruRoundTripDocument,
  name: string,
  options: CruEditOptions,
): CruRoundTripDocument {
  assertExpectedDigest(document, options);
  if (name.trim().length === 0) {
    throw new CruUnsupportedEditError("CRUMB save name cannot be empty");
  }
  if (name === document.decoded.name) {
    return document;
  }
  const nameElement = document.syntax.name;
  if (!nameElement) {
    throw new CruUnsupportedEditError("CRUMB save has no editable <name> element");
  }
  if (nameElement.selfClosing || nameElement.hasStructuredContent) {
    throw new CruUnsupportedEditError(
      "CRUMB save name contains XML structure that cannot be safely reconstructed",
    );
  }
  return applyCruBytePatches(
    document,
    [
      {
        span: nameElement.content,
        replacement: xmlTextReplacement(name),
      },
    ],
    options,
  );
}

/**
 * Sets one simple xsd scalar. Unknown, GUID, vector, array, and nested payloads
 * are deliberately refused instead of being reconstructed.
 */
export function setCruScalar(
  document: CruRoundTripDocument,
  componentIndex: number,
  valueIndex: number,
  value: string | number | boolean,
  options: CruEditOptions,
): CruRoundTripDocument {
  assertExpectedDigest(document, options);
  const component = document.decoded.components[componentIndex];
  const syntax = document.syntax.components[componentIndex];
  const current = component?.values[valueIndex];
  const valueSyntax = syntax?.values[valueIndex];
  if (!component || !syntax || !current || !valueSyntax) {
    throw new CruUnsupportedEditError(
      `No CRUMB scalar exists at component ${componentIndex}, value ${valueIndex}`,
    );
  }
  if (
    valueSyntax.opaque ||
    (current.kind !== "number" &&
      current.kind !== "boolean" &&
      current.kind !== "string")
  ) {
    throw new CruUnsupportedEditError(
      `CRUMB value ${componentIndex}.${valueIndex} is not a safely editable scalar`,
    );
  }
  if (typeof value !== typeof current.value) {
    throw new CruUnsupportedEditError(
      `CRUMB value ${componentIndex}.${valueIndex} requires ${typeof current.value}`,
    );
  }
  if (Object.is(current.value, value) || current.value === value) {
    return document;
  }
  if (
    valueSyntax.selfClosing ||
    valueSyntax.hasStructuredContent
  ) {
    throw new CruUnsupportedEditError(
      `CRUMB scalar ${componentIndex}.${valueIndex} contains XML structure that cannot be safely reconstructed`,
    );
  }
  const lexical =
    current.kind === "number"
      ? canonicalNumber(value as number, current.type)
      : current.kind === "boolean"
        ? String(value)
        : undefined;
  const replacement =
    current.kind === "string"
      ? xmlTextReplacement(value as string)
      : Buffer.from(lexical ?? "", "utf8");
  return applyCruBytePatches(
    document,
    [
      {
        span: valueSyntax.content,
        replacement,
      },
    ],
    options,
  );
}

function oneChild(
  syntax: CruAnyTypeSyntax,
  name: string,
): CruElementSpan {
  const matches = syntax.childElements[name] ?? [];
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new CruUnsupportedEditError(
      `Expected exactly one <${name}> child in ${syntax.xsiType ?? "untyped"} payload`,
    );
  }
  const match = matches[0];
  if (match.selfClosing || match.hasStructuredContent) {
    throw new CruUnsupportedEditError(
      `<${name}> contains XML structure that cannot be safely reconstructed`,
    );
  }
  return match;
}

/**
 * Moves a spatial component by patching only Vector3S and QuaternionS scalar
 * content. Geometry arrays are not treated as positions.
 */
export function moveCruComponent(
  document: CruRoundTripDocument,
  componentIndex: number,
  next: { position?: Vector3; rotation?: Quaternion },
  options: CruEditOptions,
): CruRoundTripDocument {
  assertExpectedDigest(document, options);
  const component = document.decoded.components[componentIndex];
  const syntax = document.syntax.components[componentIndex];
  if (!component || !syntax) {
    throw new CruUnsupportedEditError(`Unknown CRUMB component ${componentIndex}`);
  }
  const definition = getCrumbComponentDefinition(component.toolId);
  const signatures =
    definition === undefined
      ? []
      : [
          definition.expectedDataTypes,
          ...(definition.alternateDataTypes ?? []),
        ];
  const normalizedTypes = component.values.map((entry) =>
    entry.type.endsWith(":guid") ? "guid" : entry.type,
  );
  const signatureMatches = signatures.some(
    (signature) =>
      signature.length === normalizedTypes.length &&
      signature.every((type, index) => type === normalizedTypes[index]),
  );
  const positionIndex = 1;
  const rotationIndex = 2;
  if (
    !signatureMatches ||
    component.values[positionIndex]?.kind !== "vector3" ||
    component.values[rotationIndex]?.kind !== "quaternion"
  ) {
    throw new CruUnsupportedEditError(
      `CRUMB component ${componentIndex} does not have one recognized spatial payload layout`,
    );
  }
  const patches: CruBytePatch[] = [];
  const appendVectorPatches = (
    valueIndex: number,
    entries: readonly (readonly [name: string, before: number, after: number])[],
  ): void => {
    const valueSyntax = syntax.values[valueIndex];
    if (!valueSyntax || valueSyntax.opaque) {
      throw new CruUnsupportedEditError(
        `CRUMB component ${componentIndex} has no safely editable spatial payload`,
      );
    }
    for (const [name, before, after] of entries) {
      if (Object.is(before, after) || before === after) {
        continue;
      }
      patches.push({
        span: oneChild(valueSyntax, name).content,
        replacement: Buffer.from(canonicalNumber(after, "xsd:float"), "utf8"),
      });
    }
  };

  if (next.position) {
    const value = component.values[positionIndex];
    if (positionIndex < 0 || value?.kind !== "vector3") {
      throw new CruUnsupportedEditError(
        `CRUMB component ${componentIndex} has no spatial position`,
      );
    }
    appendVectorPatches(
      positionIndex,
      [
        ["x", value.value.x, next.position.x],
        ["y", value.value.y, next.position.y],
        ["z", value.value.z, next.position.z],
      ],
    );
  }
  if (next.rotation) {
    const value = component.values[rotationIndex];
    if (rotationIndex < 0 || value?.kind !== "quaternion") {
      throw new CruUnsupportedEditError(
        `CRUMB component ${componentIndex} has no spatial rotation`,
      );
    }
    appendVectorPatches(
      rotationIndex,
      [
        ["w", value.value.w, next.rotation.w],
        ["x", value.value.x, next.rotation.x],
        ["y", value.value.y, next.rotation.y],
        ["z", value.value.z, next.rotation.z],
      ],
    );
  }
  return applyCruBytePatches(document, patches, options);
}

/** Removes exactly one SaveComponent element and revalidates the result. */
export function removeCruComponent(
  document: CruRoundTripDocument,
  componentIndex: number,
  options: CruEditOptions,
): CruRoundTripDocument {
  assertExpectedDigest(document, options);
  const component = document.syntax.components[componentIndex];
  const decodedComponent = document.decoded.components[componentIndex];
  if (!component || !decodedComponent) {
    throw new CruUnsupportedEditError(`Unknown CRUMB component ${componentIndex}`);
  }
  if (decodedComponent.guid === undefined) {
    throw new CruUnsupportedEditError(
      `CRUMB component ${componentIndex} has no GUID that can be checked for references`,
    );
  }
  const source = stateOf(document).source;
  const targetGuid = decodedComponent.guid.toLowerCase();
  const possibleReference =
    source
      .subarray(0, component.whole.start)
      .toString("utf8")
      .toLowerCase()
      .includes(targetGuid) ||
    source
      .subarray(component.whole.end)
      .toString("utf8")
      .toLowerCase()
      .includes(targetGuid);
  if (possibleReference) {
    throw new CruUnsupportedEditError(
      `CRUMB component ${componentIndex} may still be referenced outside its source span`,
    );
  }
  return applyCruBytePatches(
    document,
    [{ span: component.whole, replacement: Buffer.alloc(0) }],
    options,
  );
}
