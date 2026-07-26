import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CRUMB_FIXTURE_KINDS, generateFixture } from "../src/adapters/crumb/fixtures.js";
import { inspectCru, validateCru } from "../src/adapters/crumb/format.js";

test("all generated CRUMB fixtures are structurally valid", () => {
  for (const kind of CRUMB_FIXTURE_KINDS) {
    const result = validateCru(generateFixture(kind));
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    assert.ok(result.inspection);
  }
});

test("checked-in CRUMB fixtures are exactly the synthetic generator output", () => {
  for (const kind of CRUMB_FIXTURE_KINDS) {
    const fixtureUrl = new URL(`../fixtures/crumb/${kind}.cru`, import.meta.url);
    assert.equal(readFileSync(fixtureUrl, "utf8"), generateFixture(kind));
  }
});

test("fixture inventories match their intended component counts", () => {
  assert.equal(inspectCru(generateFixture("empty")).componentCount, 0);
  assert.equal(inspectCru(generateFixture("breadboard")).componentCount, 1);
  assert.equal(inspectCru(generateFixture("breadboard-and-rail")).componentCount, 2);
  assert.equal(inspectCru(generateFixture("breadboard-resistor")).componentCount, 2);
  assert.equal(inspectCru(generateFixture("breadboard-led")).componentCount, 2);
});

test("resistor and LED fixtures preserve their observed CRUMB payload types", () => {
  const resistor = inspectCru(generateFixture("breadboard-resistor")).components[1];
  assert.deepEqual(resistor?.dataTypes, [
    "q1:guid",
    "ArrayOfVector3S",
    "ArrayOfTiePointID",
    "xsd:float",
    "xsd:float",
  ]);
  assert.deepEqual(resistor?.tiePointIds, [581, 516]);

  const led = inspectCru(generateFixture("breadboard-led")).components[1];
  assert.deepEqual(led?.dataTypes, [
    "q1:guid",
    "ArrayOfVector3S",
    "ArrayOfTiePointID",
    "xsd:double",
    "xsd:int",
    "xsd:double",
  ]);
  assert.deepEqual(led?.tiePointIds, [456, 476]);
});

test("generated component payloads use the observed CRUMB positional types", () => {
  const inspection = inspectCru(generateFixture("breadboard"));
  assert.deepEqual(inspection.components[0]?.dataTypes, [
    "q1:guid",
    "Vector3S",
    "QuaternionS",
  ]);
});

test("GUID namespace aliases and inherited bindings follow XML namespace scope", () => {
  const baseline = generateFixture("breadboard");
  const aliased = baseline
    .replaceAll("xmlns:q1=", "xmlns:q2=")
    .replaceAll("q1:guid", "q2:guid");
  assert.equal(validateCru(aliased).valid, true);

  const inherited = baseline
    .replaceAll(
      ' xmlns:q1="http://microsoft.com/wsdl/types/"',
      "",
    )
    .replace(
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:q1="http://microsoft.com/wsdl/types/"',
    );
  assert.equal(validateCru(inherited).valid, true);
});

test("incorrect namespace bindings cannot masquerade as CRUMB typed values", () => {
  const baseline = generateFixture("breadboard-resistor");
  const wrongGuid = baseline.replaceAll(
    "http://microsoft.com/wsdl/types/",
    "urn:not-guid",
  );
  const wrongXsi = baseline.replace(
    "http://www.w3.org/2001/XMLSchema-instance",
    "urn:not-xsi",
  );
  const defaultNamespace = baseline.replace(
    "<SaveData ",
    '<SaveData xmlns="urn:not-crumb" ',
  );

  for (const candidate of [wrongGuid, wrongXsi]) {
    const result = validateCru(candidate);
    assert.equal(result.valid, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "missing-guid",
      ),
    );
  }
  const defaultResult = validateCru(defaultNamespace);
  assert.equal(defaultResult.valid, false);
  assert.equal(
    defaultResult.diagnostics[0]?.code,
    "invalid-xml-or-root",
  );
});

test("unknown tie-point parent GUIDs are rejected", () => {
  const xml = generateFixture("breadboard-led").replace(
    "7f889f69-8140-493a-b1ef-6a519d869b1a</parentIdentifier>",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa</parentIdentifier>",
  );
  const result = validateCru(xml);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-tie-point-parent"),
  );
});

test("duplicate component GUIDs are rejected", () => {
  const first = "da67ded5-59dc-42ae-8ce8-1e9f93739844";
  const xml = generateFixture("breadboard-and-rail").replace(
    "37494364-d199-47f4-9712-9d205573cf74",
    first,
  );
  const result = validateCru(xml);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "duplicate-guid"));
});

test("generated fixtures include a valid PNG thumbnail like CRUMB 1.3.5 saves", () => {
  const inspection = inspectCru(generateFixture("empty"));
  assert.equal(inspection.imageDataFormat, "png");
  assert.ok(inspection.imageDataBytes > 0);
});

test("malformed XML is rejected", () => {
  const result = validateCru("<SaveData><name>broken</SaveData>");
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0]?.code, "invalid-xml-or-root");
});

test("oversized structural tokens are rejected without echoing their content", () => {
  const oversizedType = `${"t".repeat(256)}PRIVATE_TYPE_TAIL`;
  const oversizedNumeric = `${"0".repeat(1_024)}PRIVATE_NUMBER_TAIL`;
  const oversizedGuid = `${"a".repeat(64)}PRIVATE_GUID_TAIL`;
  const oversizedParent = `${"b".repeat(64)}PRIVATE_PARENT_TAIL`;
  const oversizedXmlName = `${"k".repeat(256)}PRIVATE_NAME_TAIL`;
  const cases = [
    {
      secret: "PRIVATE_TYPE_TAIL",
      xml: generateFixture("breadboard").replace(
        'xsi:type="Vector3S"',
        `xsi:type="${oversizedType}"`,
      ),
    },
    {
      secret: "PRIVATE_NUMBER_TAIL",
      xml: generateFixture("breadboard-resistor").replace(
        ">1000</anyType>",
        `>${oversizedNumeric}</anyType>`,
      ),
    },
    {
      secret: "PRIVATE_GUID_TAIL",
      xml: generateFixture("breadboard").replace(
        /(xsi:type="q1:guid">)[^<]+/,
        `$1${oversizedGuid}`,
      ),
    },
    {
      secret: "PRIVATE_PARENT_TAIL",
      xml: generateFixture("breadboard-led").replace(
        /(<parentIdentifier>)[^<]+/,
        `$1${oversizedParent}`,
      ),
    },
    {
      secret: "PRIVATE_NAME_TAIL",
      xml: generateFixture("breadboard").replace(
        "      </data>",
        `        <anyType xsi:type="custom:payload"><${oversizedXmlName} /></anyType>\n      </data>`,
      ),
    },
  ];

  for (const entry of cases) {
    const result = validateCru(entry.xml);
    assert.equal(result.valid, false);
    assert.equal(result.inspection, undefined);
    assert.equal(result.diagnostics[0]?.code, "structural-token-too-long");
    assert.match(result.diagnostics[0]?.message ?? "", /structural limit/);
    assert.equal(
      JSON.stringify(result.diagnostics).includes(entry.secret),
      false,
    );
    assert.throws(() => inspectCru(entry.xml), /structural limit/);
  }
});

test("oversized tie-point numeric IDs use the numeric lexical limit", () => {
  const privateTail = "PRIVATE_ID_TAIL";
  const oversizedId = `${"1".repeat(1_024)}${privateTail}`;
  const xml = generateFixture("breadboard-led").replace(
    /(<id>)[^<]+/,
    `$1${oversizedId}`,
  );
  const result = validateCru(xml);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0]?.code, "structural-token-too-long");
  assert.equal(JSON.stringify(result.diagnostics).includes(privateTail), false);
});
