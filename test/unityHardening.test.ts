import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCru } from "../src/adapters/crumb/analyze.js";
import { compareCru } from "../src/adapters/crumb/compare.js";
import { generateFixture } from "../src/adapters/crumb/fixtures.js";
import {
  decodeCanonicalBase64,
  decodeCru,
  validateCru,
} from "../src/adapters/crumb/format.js";
import {
  MAX_CRU_MARKUP_DELIMITERS,
  MAX_CRU_TEXT_NODE_CHARACTERS,
  MAX_CRU_XML_NAME_CHARACTERS,
  MAX_UNKNOWN_PAYLOAD_KEYS_RETURNED_PER_COMPONENT,
} from "../src/domain/bounds.js";

const BREADBOARD_ID = "510eff91-3435-42f7-a80d-af912a3e35be";
const RESISTOR_ID = "a79c6c3e-b687-4c66-89ae-128a02df2de2";

function diagnosticCodes(xml: string): string[] {
  return validateCru(xml).diagnostics.map((diagnostic) => diagnostic.code);
}

function appendBreadboardPayload(xml: string, payload: string): string {
  return xml.replace(
    "      </data>",
    `        ${payload}\n      </data>`,
  );
}

function modifiedComponent(
  comparison: ReturnType<typeof compareCru>,
  componentId: string,
) {
  const change = comparison.componentChanges.find(
    (entry) => entry.componentId.toLowerCase() === componentId.toLowerCase(),
  );
  assert.ok(change);
  assert.equal(change.change, "modified");
  return change;
}

test("XML declaration policy accepts UTF-8 with a BOM and rejects conflicting declarations", () => {
  const xml = generateFixture("empty");
  const bomXml = `\uFEFF${xml}`;

  assert.equal(validateCru(xml).valid, true);
  assert.equal(validateCru(bomXml).valid, true);
  assert.equal(
    validateCru(xml.replace('encoding="utf-8"', 'encoding="UTF-8"')).valid,
    true,
  );

  for (const candidate of [
    xml.replace('encoding="utf-8"', 'encoding="utf-16"'),
    xml.replace('encoding="utf-8"', 'encoding="ISO-8859-1"'),
    xml.replace('version="1.0"', 'version="1.1"'),
    xml.replace('version="1.0"', 'version="2.0"'),
  ]) {
    const validation = validateCru(candidate);
    assert.equal(validation.valid, false);
    assert.equal(validation.diagnostics[0]?.code, "invalid-xml-or-root");
  }

  const comparison = compareCru(xml, bomXml);
  assert.equal(comparison.equivalence.byteEquivalent, false);
  assert.equal(comparison.equivalence.modeledContentEquivalent, true);
  assert.equal(comparison.equivalence.modeledRepresentationEquivalent, true);
  assert.equal(comparison.equivalence.assessment, "modeled-only");
});

test("numeric, int32, boolean, and base64 lexical forms are decoded strictly", () => {
  const empty = generateFixture("empty");
  assert.ok(
    diagnosticCodes(
      empty.replace("<frequency>200</frequency>", "<frequency>0xC8</frequency>"),
    ).includes("invalid-frequency"),
  );
  assert.ok(
    diagnosticCodes(
      empty.replace("<x>0</x>", "<x>0x0</x>"),
    ).includes("invalid-root-spatial-value"),
  );
  assert.ok(
    diagnosticCodes(
      empty.replace(
        "<throttling>true</throttling>",
        "<throttling>TRUE</throttling>",
      ),
    ).includes("invalid-throttling"),
  );
  assert.ok(
    diagnosticCodes(
      empty.replace(/<imageData>[^<]+<\/imageData>/, "<imageData>Zh==</imageData>"),
    ).includes("invalid-thumbnail-base64"),
  );

  assert.equal(decodeCanonicalBase64("Zg==")?.toString("utf8"), "f");
  assert.equal(decodeCanonicalBase64("Zh=="), undefined);
  assert.equal(decodeCanonicalBase64("Zg="), undefined);

  const breadboard = generateFixture("breadboard");
  assert.ok(
    diagnosticCodes(
      breadboard.replace("<toolID>0</toolID>", "<toolID>0x0</toolID>"),
    ).includes("invalid-tool-id"),
  );
  const malformedTie = generateFixture("breadboard-resistor").replace(
    "<id>581</id>",
    "<id>581.0</id>",
  );
  assert.equal(decodeCru(malformedTie).modeledStructureComplete, false);
  assert.equal(
    compareCru(generateFixture("breadboard-resistor"), malformedTie)
      .equivalence.coverage,
    "partial",
  );
  const cases = [
    {
      payload: '<anyType xsi:type="xsd:float">1e3</anyType>',
      kind: "number",
      value: 1000,
    },
    {
      payload: '<anyType xsi:type="xsd:float">16777217</anyType>',
      kind: "number",
      value: 16_777_216,
    },
    {
      payload: '<anyType xsi:type="xsd:int">2147483647</anyType>',
      kind: "number",
      value: 2_147_483_647,
    },
    {
      payload: '<anyType xsi:type="xsd:float">0x1</anyType>',
      kind: "unknown",
      value: undefined,
    },
    {
      payload: '<anyType xsi:type="xsd:int">2147483648</anyType>',
      kind: "unknown",
      value: undefined,
    },
    {
      payload: '<anyType xsi:type="xsd:boolean">TRUE</anyType>',
      kind: "unknown",
      value: undefined,
    },
  ] as const;

  for (const entry of cases) {
    const decoded = decodeCru(
      appendBreadboardPayload(breadboard, entry.payload),
    ).components[0]?.values.at(-1);
    const decodedValue =
      decoded !== undefined && "value" in decoded
        ? decoded.value
        : undefined;
    assert.equal(decoded?.kind, entry.kind);
    assert.equal(decodedValue, entry.value);
  }

  const resistor = generateFixture("breadboard-resistor");
  const rounded = compareCru(
    resistor,
    resistor.replace(">1000</anyType>", ">1000.00001</anyType>"),
  );
  assert.equal(rounded.equivalence.modeledContentEquivalent, true);
  assert.deepEqual(
    modifiedComponent(rounded, RESISTOR_ID).changedFields,
    ["parameter-encoding"],
  );
  const overflow = compareCru(
    resistor,
    resistor.replace(">1000</anyType>", ">1e100</anyType>"),
  );
  assert.equal(overflow.equivalence.coverage, "partial");
  assert.equal(overflow.equivalence.assessment, "inconclusive");
});

test("root-name whitespace remains significant while whitespace-only names are invalid", () => {
  const trimmed = generateFixture("empty", "Circuit");
  const padded = trimmed.replace(
    "<name>Circuit</name>",
    "<name>  Circuit  </name>",
  );
  const blank = trimmed.replace("<name>Circuit</name>", "<name>   </name>");

  assert.equal(analyzeCru(padded).designName, "  Circuit  ");
  assert.ok(diagnosticCodes(blank).includes("missing-name"));

  const comparison = compareCru(padded, trimmed);
  assert.deepEqual(comparison.root.changedFields, ["name"]);
  assert.equal(comparison.equivalence.modeledContentEquivalent, false);
  assert.equal(comparison.equivalence.assessment, "changed");
});

test("namespace validation rejects undeclared prefixes, duplicate expanded attributes, and reserved rebinding", () => {
  const xml = generateFixture("breadboard");
  const schemaInstance = "http://www.w3.org/2001/XMLSchema-instance";
  const undeclared = xml.replace(
    'xsi:type="Vector3S"',
    'oops:type="Vector3S"',
  );
  const duplicateExpanded = xml
    .replace(
      `xmlns:xsi="${schemaInstance}"`,
      `xmlns:xsi="${schemaInstance}" xmlns:alt="${schemaInstance}"`,
    )
    .replace(
      'xsi:type="Vector3S"',
      'xsi:type="Vector3S" alt:type="Vector3S"',
    );
  const reservedRebinding = xml.replace(
    "<SaveData ",
    '<SaveData xmlns:xml="urn:not-xml" ',
  );
  const reservedXmlnsPrefix = xml.replace(
    "<SaveData ",
    '<SaveData xmlns:xmlns="urn:not-xmlns" ',
  );
  const emptyPrefixedBinding = xml.replace(
    "<SaveData ",
    '<SaveData xmlns:future="" ',
  );
  const reservedXmlnsUri = xml.replace(
    "<SaveData ",
    '<SaveData xmlns:future="http://www.w3.org/2000/xmlns/" ',
  );

  for (const candidate of [
    undeclared,
    duplicateExpanded,
    reservedRebinding,
    reservedXmlnsPrefix,
    emptyPrefixedBinding,
    reservedXmlnsUri,
  ]) {
    const validation = validateCru(candidate);
    assert.equal(validation.valid, false);
    assert.equal(validation.diagnostics[0]?.code, "invalid-xml-or-root");
  }
});

test("structural bounds cover deeply nested XML names and text without echoing tails", () => {
  const xml = generateFixture("breadboard");
  const privateNameTail = "PRIVATE_NESTED_NAME_TAIL";
  const oversizedName =
    `${"n".repeat(MAX_CRU_XML_NAME_CHARACTERS + 1)}${privateNameTail}`;
  const privateTextTail = "PRIVATE_NESTED_TEXT_TAIL";
  const oversizedText =
    `${"t".repeat(MAX_CRU_TEXT_NODE_CHARACTERS + 1)}${privateTextTail}`;
  const candidates = [
    {
      secret: privateNameTail,
      xml: appendBreadboardPayload(
        xml,
        `<anyType xsi:type="FuturePayload"><outer><inner><${oversizedName} /></inner></outer></anyType>`,
      ),
    },
    {
      secret: privateTextTail,
      xml: appendBreadboardPayload(
        xml,
        `<anyType xsi:type="FuturePayload"><outer><inner>${oversizedText}</inner></outer></anyType>`,
      ),
    },
  ];

  for (const candidate of candidates) {
    const validation = validateCru(candidate.xml);
    assert.equal(validation.valid, false);
    assert.equal(
      validation.diagnostics[0]?.code,
      "structural-token-too-long",
    );
    assert.equal(
      JSON.stringify(validation.diagnostics).includes(candidate.secret),
      false,
    );
  }
});

test("markup breadth is rejected before XML parsing can amplify it", () => {
  const xml = generateFixture("empty").replace(
    "<components />",
    `<components>${"<x />".repeat(MAX_CRU_MARKUP_DELIMITERS + 1)}</components>`,
  );
  const validation = validateCru(xml);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.diagnostics[0]?.code,
    "structural-token-too-long",
  );
  assert.match(
    validation.diagnostics[0]?.message ?? "",
    /markup.*structural limit/i,
  );
});

test("a known semantic change cannot hide a simultaneous opaque change", () => {
  const xml = generateFixture("breadboard");
  const baseline = xml.replace(
    '<anyType xsi:type="Vector3S">',
    '<anyType xsi:type="Vector3S" future="SENSITIVE_ALPHA">',
  );
  const candidate = xml
    .replace(
      '<anyType xsi:type="Vector3S">',
      '<anyType xsi:type="Vector3S" future="SENSITIVE_BRAVO">',
    )
    .replace("<x>0</x>", "<x>1</x>");
  const comparison = compareCru(baseline, candidate);
  const componentId = decodeCru(baseline).components[0]?.guid;
  assert.ok(componentId);
  const change = modifiedComponent(comparison, componentId);
  const serialized = JSON.stringify(comparison);

  assert.ok(change.changedFields.includes("position"));
  assert.ok(change.changedFields.includes("opaque-payload"));
  assert.equal(comparison.equivalence.coverage, "partial");
  assert.equal(comparison.equivalence.assessment, "inconclusive");
  assert.equal(serialized.includes("SENSITIVE_ALPHA"), false);
  assert.equal(serialized.includes("SENSITIVE_BRAVO"), false);
});

test("simultaneous semantic and lexical-only modeled changes retain both classifiers", () => {
  const baseline = generateFixture("breadboard");
  const candidate = baseline
    .replace("<x>0</x>", "<x>1</x>")
    .replace("<w>1</w>", "<w>1e0</w>");
  const comparison = compareCru(baseline, candidate);
  const componentId = decodeCru(baseline).components[0]?.guid;
  assert.ok(componentId);
  const change = modifiedComponent(comparison, componentId);

  assert.deepEqual(change.changedFields, ["position", "modeled-encoding"]);
  assert.equal(comparison.equivalence.modeledContentEquivalent, false);
  assert.equal(comparison.equivalence.modeledRepresentationEquivalent, false);
  assert.equal(comparison.equivalence.assessment, "changed");
});

test("tie-point parent GUID casing is semantically and representationally neutral", () => {
  const baseline = generateFixture("breadboard-resistor");
  const candidate = baseline.replaceAll(
    `<parentIdentifier>${BREADBOARD_ID}</parentIdentifier>`,
    `<parentIdentifier>${BREADBOARD_ID.toUpperCase()}</parentIdentifier>`,
  );
  const comparison = compareCru(baseline, candidate);

  assert.equal(validateCru(candidate).valid, true);
  assert.equal(comparison.equivalence.byteEquivalent, false);
  assert.equal(comparison.equivalence.modeledContentEquivalent, true);
  assert.equal(comparison.equivalence.modeledRepresentationEquivalent, true);
  assert.equal(comparison.equivalence.assessment, "modeled-only");
  assert.deepEqual(comparison.componentChanges, []);
});

test("direct-only comparisons still make the version-pinned profile inconclusive for out-of-range ties", () => {
  const baseline = generateFixture("breadboard-resistor");
  const candidate = baseline.replace("<id>581</id>", "<id>630</id>");
  const comparison = compareCru(baseline, candidate, {
    topologyMode: "direct-only",
  });

  assert.equal(comparison.topologyMode, "direct-only");
  assert.equal(
    comparison.profileAssessment.candidate.status,
    "inconclusive",
  );
  assert.equal(comparison.equivalence.assessment, "changed");
  assert.ok(
    modifiedComponent(comparison, RESISTOR_ID).changedFields.includes(
      "attachments",
    ),
  );
});

test("malformed known scalar payloads downgrade analysis instead of being positionally trusted", () => {
  const xml = generateFixture("breadboard-resistor").replace(
    ">1000</anyType>",
    ">0x3e8</anyType>",
  );
  const analysis = analyzeCru(xml);
  const resistor = analysis.components.find(
    (component) => component.id.toLowerCase() === RESISTOR_ID,
  );

  assert.ok(resistor);
  assert.equal(resistor.recognitionStatus, "schema-mismatch");
  assert.equal(resistor.payloadMatchesCatalog, false);
  assert.deepEqual(resistor.parameters, {});
  assert.equal(resistor.unknownPayloads[0]?.type, "xsd:float");
  assert.equal(analysis.summary.schemaMismatchComponentCount, 1);
});

test("unknown payload keys share one per-component budget and keep aggregate output bounded", () => {
  const keyNames = Array.from(
    { length: MAX_UNKNOWN_PAYLOAD_KEYS_RETURNED_PER_COMPONENT },
    (_, index) => `k${index}_${"x".repeat(96)}`,
  );
  const payloads = Array.from(
    { length: 64 },
    (_, payloadIndex) =>
      `<anyType xsi:type="FuturePayload${payloadIndex}">${keyNames
        .map((key) => `<${key}>1</${key}>`)
        .join("")}</anyType>`,
  ).join("");
  const component = [
    "<components>",
    "<SaveComponent>",
    "<toolID>999</toolID>",
    "<data>",
    '<anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa</anyType>',
    payloads,
    "</data>",
    "</SaveComponent>",
    "</components>",
  ].join("");
  const xml = generateFixture("empty").replace("<components />", component);
  const analysis = analyzeCru(xml);
  const unknown = analysis.components[0];
  assert.ok(unknown);

  const returnedKeyCount = unknown.unknownPayloads.reduce(
    (total, payload) => total + payload.keys.length,
    0,
  );
  assert.equal(
    returnedKeyCount,
    MAX_UNKNOWN_PAYLOAD_KEYS_RETURNED_PER_COMPONENT,
  );
  assert.equal(unknown.unknownPayloads.length, 64);
  assert.equal(unknown.unknownPayloads[0]?.keys.length, 64);
  assert.equal(unknown.unknownPayloads[1]?.keys.length, 0);
  assert.equal(unknown.unknownPayloads[1]?.keyBounds.truncated, true);
  assert.ok(JSON.stringify(analysis).length < 100_000);
});
