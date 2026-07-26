import assert from "node:assert/strict";
import test from "node:test";

import { compareCru } from "../src/adapters/crumb/compare.js";
import {
  fixtureDocument,
  generateFixture,
} from "../src/adapters/crumb/fixtures.js";
import { serializeCru } from "../src/adapters/crumb/format.js";

function modifiedChange(
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

test("identical CRUMB saves compare exactly", () => {
  const xml = generateFixture("breadboard-resistor");
  const comparison = compareCru(xml, xml);

  assert.deepEqual(comparison.equivalence, {
    byteEquivalent: true,
    modeledContentEquivalent: true,
    modeledRepresentationEquivalent: true,
    coverage: "complete",
    assessment: "exact",
  });
  assert.equal(comparison.summary.rootFieldChangeCount, 0);
  assert.equal(comparison.summary.modifiedComponentCount, 0);
  assert.equal(comparison.summary.unchangedComponentCount, 2);
  assert.deepEqual(comparison.componentChanges, []);
});

test("XML whitespace changes are modeled-only", () => {
  const baseline = generateFixture("breadboard-resistor");
  const candidate = baseline.replace("</SaveData>", "\n</SaveData>");
  const comparison = compareCru(baseline, candidate);

  assert.equal(comparison.equivalence.byteEquivalent, false);
  assert.equal(comparison.equivalence.modeledContentEquivalent, true);
  assert.equal(comparison.equivalence.modeledRepresentationEquivalent, true);
  assert.equal(comparison.equivalence.assessment, "modeled-only");
  assert.equal(comparison.componentChanges.length, 0);
});

test("namespace aliases are representation-neutral while invalid schema bindings fail closed", () => {
  const baseline = generateFixture("breadboard-resistor");
  const aliasCandidate = baseline
    .replaceAll("xmlns:q1=", "xmlns:q2=")
    .replaceAll("q1:guid", "q2:guid");
  const aliasComparison = compareCru(baseline, aliasCandidate);

  assert.equal(aliasComparison.equivalence.byteEquivalent, false);
  assert.equal(aliasComparison.equivalence.modeledContentEquivalent, true);
  assert.equal(
    aliasComparison.equivalence.modeledRepresentationEquivalent,
    true,
  );
  assert.equal(aliasComparison.equivalence.assessment, "modeled-only");
  assert.deepEqual(aliasComparison.componentChanges, []);

  const wrongXsdCandidate = baseline.replace(
    "http://www.w3.org/2001/XMLSchema",
    "urn:not-xsd",
  );
  assert.throws(
    () => compareCru(baseline, wrongXsdCandidate),
    /namespace|xsd/i,
  );
});

test("unknown root structure forces digest-only inconclusive coverage", () => {
  const privateValue = "SENSITIVE_UNMODELED_ROOT_STATE";
  const baseline = generateFixture("empty");
  const candidate = baseline.replace(
    "</SaveData>",
    `  <futureFlag>${privateValue}</futureFlag>\n</SaveData>`,
  );
  const comparison = compareCru(baseline, candidate);
  const serialized = JSON.stringify(comparison);

  assert.equal(comparison.equivalence.coverage, "partial");
  assert.equal(comparison.equivalence.assessment, "inconclusive");
  assert.equal(comparison.equivalence.modeledContentEquivalent, false);
  assert.equal(comparison.summary.rootFieldChangeCount, 0);
  assert.equal(serialized.includes(privateValue), false);
  assert.ok(
    comparison.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "unmodeled-xml-structure" &&
        diagnostic.path === "candidate",
    ),
  );
});

function withNestedOpaquePayload(xml: string, value: string): string {
  return xml.replace(
    "      </data>",
    [
      '        <anyType xsi:type="FuturePayload">',
      `          <secret>${value}</secret>`,
      "        </anyType>",
      "      </data>",
    ].join("\n"),
  );
}

test("nested opaque payload changes are fingerprinted without content disclosure", () => {
  const secretA = "SENSITIVE_OPAQUE_ALPHA";
  const secretB = "SENSITIVE_OPAQUE_BRAVO";
  const baseline = withNestedOpaquePayload(
    generateFixture("breadboard"),
    secretA,
  );
  const candidate = withNestedOpaquePayload(
    generateFixture("breadboard"),
    secretB,
  );
  const comparison = compareCru(baseline, candidate);
  const change = modifiedChange(
    comparison,
    "8b634796-a77b-4f6b-a276-53fccd69bc62",
  );
  const serialized = JSON.stringify(comparison);

  assert.ok(change.changedFields.includes("opaque-payload"));
  assert.notEqual(
    change.baselinePayloadDigest,
    change.candidatePayloadDigest,
  );
  assert.equal(comparison.equivalence.coverage, "partial");
  assert.equal(comparison.equivalence.assessment, "inconclusive");
  assert.equal(serialized.includes(secretA), false);
  assert.equal(serialized.includes(secretB), false);
});

test("opaque XML child ordering participates in its structural fingerprint", () => {
  const base = generateFixture("breadboard");
  const baseline = withNestedOpaquePayload(
    base,
    "</secret><alpha>1</alpha><beta>2</beta><secret>",
  );
  const candidate = withNestedOpaquePayload(
    base,
    "</secret><beta>2</beta><alpha>1</alpha><secret>",
  );
  const comparison = compareCru(baseline, candidate);
  const change = modifiedChange(
    comparison,
    "8b634796-a77b-4f6b-a276-53fccd69bc62",
  );

  assert.ok(change.changedFields.includes("opaque-payload"));
  assert.notEqual(
    change.baselinePayloadDigest,
    change.candidatePayloadDigest,
  );
  assert.equal(comparison.equivalence.coverage, "partial");
});

test("mixed or extended known payload structure cannot claim complete coverage", () => {
  const baseline = generateFixture("breadboard");
  const candidate = baseline.replace(
    '<anyType xsi:type="Vector3S">',
    '<anyType xsi:type="Vector3S">SENSITIVE_MIXED_TEXT<futureFlag>1</futureFlag>',
  );
  const comparison = compareCru(baseline, candidate);
  const change = modifiedChange(
    comparison,
    "8b634796-a77b-4f6b-a276-53fccd69bc62",
  );

  assert.equal(comparison.equivalence.coverage, "partial");
  assert.equal(comparison.equivalence.assessment, "inconclusive");
  assert.ok(change.changedFields.includes("opaque-payload"));
  assert.equal(
    JSON.stringify(comparison).includes("SENSITIVE_MIXED_TEXT"),
    false,
  );
});

test("numeric lexical-only changes are distinct from parameter value changes", () => {
  const baseline = generateFixture("breadboard-resistor");
  const lexicalCandidate = baseline.replace(
    '<anyType xsi:type="xsd:float">1000</anyType>',
    '<anyType xsi:type="xsd:float">1e3</anyType>',
  );
  const lexicalComparison = compareCru(baseline, lexicalCandidate);
  const resistorId = "a79c6c3e-b687-4c66-89ae-128a02df2de2";
  const lexicalChange = modifiedChange(lexicalComparison, resistorId);

  assert.deepEqual(lexicalChange.changedFields, ["parameter-encoding"]);
  assert.equal(lexicalComparison.equivalence.modeledContentEquivalent, true);
  assert.equal(
    lexicalComparison.equivalence.modeledRepresentationEquivalent,
    false,
  );
  assert.equal(lexicalComparison.equivalence.assessment, "modeled-only");

  const valueCandidate = baseline.replace(
    '<anyType xsi:type="xsd:float">1000</anyType>',
    '<anyType xsi:type="xsd:float">2200</anyType>',
  );
  const valueComparison = compareCru(baseline, valueCandidate);
  const valueChange = modifiedChange(valueComparison, resistorId);

  assert.deepEqual(valueChange.changedFields, ["parameters"]);
  assert.equal(valueChange.baseline?.parameters.resistance?.value, 1000);
  assert.equal(valueChange.candidate?.parameters.resistance?.value, 2200);
  assert.equal(valueComparison.equivalence.modeledContentEquivalent, false);
  assert.equal(valueComparison.equivalence.assessment, "changed");
});

test("root and spatial numeric lexical changes remain representation-visible", () => {
  const rootBaseline = generateFixture("empty");
  const rootCandidate = rootBaseline.replace(
    "<frequency>200</frequency>",
    "<frequency>2e2</frequency>",
  );
  const rootComparison = compareCru(rootBaseline, rootCandidate);

  assert.equal(rootComparison.equivalence.modeledContentEquivalent, true);
  assert.equal(
    rootComparison.equivalence.modeledRepresentationEquivalent,
    false,
  );
  assert.equal(rootComparison.equivalence.assessment, "modeled-only");
  assert.deepEqual(rootComparison.root.changedFields, [
    "modeled-encoding",
  ]);

  const spatialBaseline = generateFixture("breadboard");
  const spatialCandidate = spatialBaseline.replace(
    "<x>0</x>",
    "<x>0e0</x>",
  );
  const spatialComparison = compareCru(
    spatialBaseline,
    spatialCandidate,
  );
  const spatialChange = modifiedChange(
    spatialComparison,
    "8b634796-a77b-4f6b-a276-53fccd69bc62",
  );
  assert.equal(
    spatialComparison.equivalence.modeledContentEquivalent,
    true,
  );
  assert.equal(
    spatialComparison.equivalence.modeledRepresentationEquivalent,
    false,
  );
  assert.deepEqual(spatialChange.changedFields, ["modeled-encoding"]);
});

test("attachment and geometry changes are classified without returning geometry by default", () => {
  const baseline = generateFixture("breadboard-resistor");
  const attachmentCandidate = baseline.replace("<id>581</id>", "<id>582</id>");
  const attachmentComparison = compareCru(baseline, attachmentCandidate);
  const resistorId = "a79c6c3e-b687-4c66-89ae-128a02df2de2";
  const attachmentChange = modifiedChange(
    attachmentComparison,
    resistorId,
  );

  assert.deepEqual(attachmentChange.changedFields, ["attachments"]);

  const geometryCandidate = baseline.replace(
    "<x>55.8799973</x>",
    "<x>56.8799973</x>",
  );
  const geometryComparison = compareCru(baseline, geometryCandidate);
  const geometryChange = modifiedChange(geometryComparison, resistorId);

  assert.deepEqual(geometryChange.changedFields, ["geometry"]);
  assert.equal(geometryChange.baseline?.geometry, undefined);
  assert.equal(geometryChange.candidate?.geometry, undefined);
  assert.equal(geometryComparison.disclosure.geometryIncluded, false);
});

test("connected components without usable geometry are profile-inconclusive", () => {
  const baseline = generateFixture("breadboard-resistor");
  const candidate = baseline.replace(
    /        <anyType xsi:type="ArrayOfVector3S">[\s\S]*?        <\/anyType>/,
    '        <anyType xsi:type="ArrayOfVector3S" />',
  );
  const comparison = compareCru(baseline, candidate);

  assert.equal(comparison.equivalence.coverage, "partial");
  assert.equal(comparison.equivalence.assessment, "inconclusive");
  assert.equal(
    comparison.profileAssessment.candidate.status,
    "inconclusive",
  );
  assert.equal(
    comparison.profileAssessment.candidate.schemaMismatchComponentCount,
    1,
  );
});

test("unknown IC prefab IDs cannot receive a consistent profile assessment", () => {
  const baseline = generateFixture("breadboard");
  const parentGuid = "8b634796-a77b-4f6b-a276-53fccd69bc62";
  const component = [
    "    <SaveComponent>",
    "      <toolID>5</toolID>",
    "      <data>",
    '        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">c9f63a35-d9f2-4af0-9fb7-a991c077d803</anyType>',
    '        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>',
    '        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>',
    `        <anyType xsi:type="ArrayOfTiePointID"><TiePointID><id>0</id><parentIdentifier>${parentGuid}</parentIdentifier></TiePointID></anyType>`,
    '        <anyType xsi:type="xsd:int">999</anyType>',
    "      </data>",
    "    </SaveComponent>",
  ].join("\n");
  const candidate = baseline.replace(
    "  </components>",
    `${component}\n  </components>`,
  );
  const comparison = compareCru(baseline, candidate);

  assert.equal(
    comparison.profileAssessment.candidate.status,
    "inconclusive",
  );
  assert.equal(
    comparison.profileAssessment.candidate.schemaMismatchComponentCount,
    1,
  );
  assert.ok(
    comparison.diagnostics.some(
      (diagnostic) => diagnostic.code === "unknown-ic-prefab",
    ),
  );
});

test("component reordering is representation-only and deterministic", () => {
  const baselineDocument = fixtureDocument("breadboard-resistor");
  const baseline = serializeCru(baselineDocument);
  const candidate = serializeCru({
    ...baselineDocument,
    components: [...baselineDocument.components].reverse(),
  });
  const first = compareCru(baseline, candidate);
  const second = compareCru(baseline, candidate);

  assert.equal(first.equivalence.modeledContentEquivalent, true);
  assert.equal(first.equivalence.modeledRepresentationEquivalent, false);
  assert.equal(first.equivalence.assessment, "modeled-only");
  assert.equal(first.summary.modifiedComponentCount, 2);
  assert.ok(
    first.componentChanges.every((change) =>
      change.changedFields.includes("order"),
    ),
  );
  assert.deepEqual(first, second);
});

test("root metadata and thumbnail changes return bounded observations", () => {
  const privateTail = "PRIVATE_ROOT_NAME_TAIL";
  const baseline = generateFixture("empty", "Baseline");
  const candidate = serializeCru({
    ...fixtureDocument("empty", `${"N".repeat(200)}${privateTail}`),
    imageData: "",
    cameraPosition: { x: 1, y: 2, z: -100 },
    frequency: 100,
    timeStep: 0.01,
  });
  const comparison = compareCru(baseline, candidate);
  const serialized = JSON.stringify(comparison);

  assert.deepEqual(comparison.root.changedFields, [
    "name",
    "thumbnail",
    "camera-position",
    "frequency",
    "time-step",
  ]);
  assert.equal(comparison.root.candidate.name.previewCharacters, 160);
  assert.equal(comparison.root.candidate.name.previewTruncated, true);
  assert.equal(serialized.includes(privateTail), false);
  assert.equal(comparison.root.candidate.thumbnail.contentIncluded, false);
  assert.equal(comparison.equivalence.assessment, "changed");
});

test("unknown candidate signatures remain unverified and inconclusive", () => {
  const baseline = generateFixture("breadboard");
  const candidate = baseline.replace("<toolID>0</toolID>", "<toolID>999</toolID>");
  const comparison = compareCru(baseline, candidate);

  assert.equal(comparison.profileAssessment.candidate.status, "inconclusive");
  assert.equal(comparison.equivalence.coverage, "partial");
  assert.equal(comparison.equivalence.assessment, "inconclusive");
  assert.deepEqual(comparison.schemaCandidates, [
    {
      toolId: 999,
      payloadTypes: ["guid", "Vector3S", "QuaternionS"],
      payloadTypeBounds: {
        total: 3,
        returned: 3,
        limit: 64,
        truncated: false,
      },
      occurrenceCount: 1,
      status: "unverified-observation",
    },
  ]);
  assert.equal(comparison.summary.newToolIdCount, 1);
  assert.equal(comparison.summary.newPayloadSignatureCount, 1);
});

function withSource(
  xml: string,
  source: string,
  secondary = "secondary",
): string {
  const boardGuid = "8b634796-a77b-4f6b-a276-53fccd69bc62";
  const component = [
    "    <SaveComponent>",
    "      <toolID>20</toolID>",
    "      <data>",
    '        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">c9f63a35-d9f2-4af0-9fb7-a991c077d803</anyType>',
    '        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>',
    '        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>',
    '        <anyType xsi:type="ArrayOfTiePointID">',
    `          <TiePointID><id>0</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>`,
    `          <TiePointID><id>5</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>`,
    "        </anyType>",
    `        <anyType xsi:type="xsd:string">${source}</anyType>`,
    `        <anyType xsi:type="xsd:string">${secondary}</anyType>`,
    "      </data>",
    "    </SaveComponent>",
  ].join("\n");
  return xml.replace("  </components>", `${component}\n  </components>`);
}

test("source changes expose metadata and digests, never source content", () => {
  const secretA = "SENSITIVE_FIRMWARE_ALPHA";
  const secretB = "SENSITIVE_FIRMWARE_BRAVO";
  const baseline = withSource(generateFixture("breadboard"), secretA);
  const candidate = withSource(generateFixture("breadboard"), secretB);
  const comparison = compareCru(baseline, candidate);
  const change = modifiedChange(
    comparison,
    "c9f63a35-d9f2-4af0-9fb7-a991c077d803",
  );
  const serialized = JSON.stringify(comparison);

  assert.ok(change.changedFields.includes("source-code"));
  assert.equal(change.baseline?.sourceCode?.included, false);
  assert.equal(change.candidate?.sourceCode?.included, false);
  assert.notEqual(
    change.baseline?.sourceCode?.sha256,
    change.candidate?.sourceCode?.sha256,
  );
  assert.equal(serialized.includes(secretA), false);
  assert.equal(serialized.includes(secretB), false);
  assert.equal(comparison.disclosure.sourceCodeIncluded, false);
});

test("semantic changes in unclassified modeled payloads are not called encoding-only", () => {
  const baseline = withSource(
    generateFixture("breadboard"),
    "void setup() {}",
    "alpha",
  );
  const candidate = withSource(
    generateFixture("breadboard"),
    "void setup() {}",
    "bravo",
  );
  const comparison = compareCru(baseline, candidate);
  const change = modifiedChange(
    comparison,
    "c9f63a35-d9f2-4af0-9fb7-a991c077d803",
  );

  assert.ok(change.changedFields.includes("opaque-payload"));
  assert.equal(change.changedFields.includes("modeled-encoding"), false);
  assert.equal(comparison.equivalence.modeledContentEquivalent, false);
});

function withEeprom(xml: string, fill: number): string {
  const boardGuid = "8b634796-a77b-4f6b-a276-53fccd69bc62";
  const image = Buffer.alloc(2_048, fill).toString("base64");
  const tiePoints = Array.from(
    { length: 24 },
    (_, index) =>
      `          <TiePointID><id>${index}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>`,
  ).join("\n");
  const component = [
    "    <SaveComponent>",
    "      <toolID>5</toolID>",
    "      <data>",
    '        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">d927d45e-1886-4fa3-8962-82dd926681f2</anyType>',
    '        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>',
    '        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>',
    '        <anyType xsi:type="ArrayOfTiePointID">',
    tiePoints,
    "        </anyType>",
    `        <anyType xsi:type="xsd:base64Binary">${image}</anyType>`,
    '        <anyType xsi:type="xsd:int">13</anyType>',
    "      </data>",
    "    </SaveComponent>",
  ].join("\n");
  return xml.replace("  </components>", `${component}\n  </components>`);
}

test("EEPROM changes expose only metadata and digests", () => {
  const baseline = withEeprom(generateFixture("breadboard"), 0x00);
  const candidate = withEeprom(generateFixture("breadboard"), 0xff);
  const comparison = compareCru(baseline, candidate);
  const change = modifiedChange(
    comparison,
    "d927d45e-1886-4fa3-8962-82dd926681f2",
  );
  const serialized = JSON.stringify(comparison);

  assert.ok(change.changedFields.includes("embedded-data"));
  assert.equal(change.baseline?.embeddedData?.contentIncluded, false);
  assert.equal(change.candidate?.embeddedData?.contentIncluded, false);
  assert.equal(change.baseline?.embeddedData?.bytes, 2_048);
  assert.equal(change.candidate?.embeddedData?.bytes, 2_048);
  assert.notEqual(
    change.baseline?.embeddedData?.sha256,
    change.candidate?.embeddedData?.sha256,
  );
  assert.equal(comparison.equivalence.coverage, "partial");
  assert.equal(comparison.equivalence.assessment, "inconclusive");
  assert.equal(serialized.includes(Buffer.alloc(64, 0xff).toString("base64")), false);
  assert.ok(serialized.length < 30_000);
});

function withTiePointCount(xml: string, count: number, tailId: number): string {
  const parentGuid = "510eff91-3435-42f7-a80d-af912a3e35be";
  const tiePoints = Array.from(
    { length: count },
    (_, index) =>
      [
        "          <TiePointID>",
        `            <id>${index === count - 1 ? tailId : index}</id>`,
        `            <parentIdentifier>${parentGuid}</parentIdentifier>`,
        "          </TiePointID>",
      ].join("\n"),
  ).join("\n");
  return xml.replace(
    /        <anyType xsi:type="ArrayOfTiePointID">[\s\S]*?        <\/anyType>/,
    [
      '        <anyType xsi:type="ArrayOfTiePointID">',
      tiePoints,
      "        </anyType>",
    ].join("\n"),
  );
}

test("attachment changes beyond response bounds retain semantic classification", () => {
  const base = generateFixture("breadboard-resistor");
  const baseline = withTiePointCount(base, 65, 64);
  const candidate = withTiePointCount(base, 65, 999);
  const comparison = compareCru(baseline, candidate);
  const change = modifiedChange(
    comparison,
    "a79c6c3e-b687-4c66-89ae-128a02df2de2",
  );

  assert.ok(change.changedFields.includes("attachments"));
  assert.equal(comparison.summary.attachmentChangeCount, 1);
  assert.equal(comparison.equivalence.coverage, "partial");
  const profile = comparison.profileAssessment.candidate;
  assert.equal(
    profile.recognizedComponentCount +
      profile.schemaMismatchComponentCount +
      profile.unknownComponentCount,
    profile.componentCount,
  );
});

function dipSwitchFixture(tailValue: boolean): string {
  const base = serializeCru({
    name: "DIP Tail Comparison",
    components: [
      {
        toolId: 0,
        guid: "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a",
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  const parentGuid = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";
  const tiePoints = Array.from(
    { length: 8 },
    (_, index) =>
      `<TiePointID><id>${index}</id><parentIdentifier>${parentGuid}</parentIdentifier></TiePointID>`,
  ).join("");
  const positions = Array.from(
    { length: 65 },
    (_, index) =>
      `<boolean>${index === 64 ? tailValue : false}</boolean>`,
  ).join("");
  const component = [
    "    <SaveComponent>",
    "      <toolID>13</toolID>",
    "      <data>",
    '        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">1f116ff1-e792-474d-b524-82b3b9530eb7</anyType>',
    '        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>',
    '        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>',
    `        <anyType xsi:type="ArrayOfTiePointID">${tiePoints}</anyType>`,
    `        <anyType xsi:type="ArrayOfBoolean">${positions}</anyType>`,
    "      </data>",
    "    </SaveComponent>",
  ].join("\n");
  return base.replace("  </components>", `${component}\n  </components>`);
}

test("parameter changes beyond response bounds remain parameter changes", () => {
  const comparison = compareCru(
    dipSwitchFixture(false),
    dipSwitchFixture(true),
  );
  const change = modifiedChange(
    comparison,
    "1f116ff1-e792-474d-b524-82b3b9530eb7",
  );

  assert.ok(change.changedFields.includes("parameters"));
  assert.equal(comparison.summary.parameterChangeCount, 1);
  assert.equal(comparison.equivalence.coverage, "partial");
});

test("dual boolean element spellings fail closed instead of hiding a branch", () => {
  const base = dipSwitchFixture(false);
  const baseline = base.replace(
    /(<anyType xsi:type="ArrayOfBoolean">[\s\S]*?)(<\/anyType>)/,
    "$1<Boolean>false</Boolean>$2",
  );
  const candidate = base.replace(
    /(<anyType xsi:type="ArrayOfBoolean">[\s\S]*?)(<\/anyType>)/,
    "$1<Boolean>true</Boolean>$2",
  );
  assert.throws(
    () => compareCru(baseline, candidate),
    /ArrayOfBoolean payload/,
  );
});

function unknownSignatureComponent(
  guid: string,
  extraPayloadCount: number,
): string {
  const payloads = Array.from(
    { length: extraPayloadCount },
    () => '        <anyType xsi:type="FuturePayload"><value>1</value></anyType>',
  ).join("\n");
  return [
    "    <SaveComponent>",
    "      <toolID>999</toolID>",
    "      <data>",
    `        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${guid}</anyType>`,
    payloads,
    "      </data>",
    "    </SaveComponent>",
  ].join("\n");
}

function unknownSignatureDesign(reverse: boolean): string {
  const base = generateFixture("empty");
  const components = [
    unknownSignatureComponent(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      64,
    ),
    unknownSignatureComponent(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      65,
    ),
  ];
  if (reverse) {
    components.reverse();
  }
  return base.replace(
    "  <components />",
    `  <components>\n${components.join("\n")}\n  </components>`,
  );
}

test("bounded schema candidates sort by their full signatures", () => {
  const baseline = generateFixture("empty");
  const forward = compareCru(baseline, unknownSignatureDesign(false));
  const reverse = compareCru(baseline, unknownSignatureDesign(true));

  assert.deepEqual(forward.schemaCandidates, reverse.schemaCandidates);
  assert.deepEqual(
    forward.schemaCandidates.map(
      (candidate) => candidate.payloadTypeBounds.total,
    ).sort((left, right) => left - right),
    [65, 66],
  );
  assert.ok(
    forward.schemaCandidates.every(
      (candidate) =>
        candidate.payloadTypeBounds.returned === 64 &&
        candidate.payloadTypeBounds.truncated,
    ),
  );
});

test("direct comparison rejects missing and duplicate component GUIDs deliberately", () => {
  const baseline = generateFixture("breadboard-and-rail");
  const missingGuid = baseline.replace(
    'xsi:type="q1:guid"',
    'xsi:type="xsd:string"',
  );
  const duplicateGuid = baseline.replace(
    "37494364-d199-47f4-9712-9d205573cf74",
    "da67ded5-59dc-42ae-8ce8-1e9f93739844",
  );

  assert.throws(
    () => compareCru(baseline, missingGuid),
    /component without a GUID/,
  );
  assert.throws(
    () => compareCru(baseline, duplicateGuid),
    /duplicate component GUIDs/,
  );
});

test("direct comparison cannot forge exact identity with caller digests", () => {
  const baseline = generateFixture("empty", "Baseline");
  const candidate = generateFixture("empty", "Candidate");
  const fakeDigest = `sha256:${"0".repeat(64)}`;

  assert.throws(
    () =>
      compareCru(baseline, candidate, {
        baselineByteDigest: fakeDigest,
        candidateByteDigest: fakeDigest,
      }),
    /cannot describe different decoded XML/,
  );
  assert.throws(
    () =>
      compareCru(baseline, candidate, {
        baselineByteDigest: fakeDigest,
      }),
    /both artifacts or neither/,
  );
  assert.throws(
    () =>
      compareCru(baseline, candidate, {
        baselineByteDigest: "not-a-digest",
        candidateByteDigest: "not-a-digest",
      }),
    /lowercase SHA-256/,
  );
});
