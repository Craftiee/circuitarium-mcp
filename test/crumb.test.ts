import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CRUMB_FIXTURE_KINDS, generateFixture } from "../src/adapters/crumb/fixtures.js";
import {
  decodeCru,
  inspectCru,
  serializeCru,
  validateCru,
  type CruDocument,
} from "../src/adapters/crumb/format.js";
import {
  MAX_CRU_COMPONENTS,
  MAX_CRU_DATA_VALUES_PER_COMPONENT,
  MAX_CRU_XML_DEPTH,
} from "../src/domain/bounds.js";

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
    assert.equal(result.inspection, undefined);
    assert.equal(result.diagnostics[0]?.code, "invalid-xml-or-root");
    assert.match(result.diagnostics[0]?.message ?? "", /namespace|unbound/i);
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

test("malformed known typed payloads fail atomically", () => {
  const breadboard = generateFixture("breadboard");
  const resistor = generateFixture("breadboard-resistor");
  const led = generateFixture("breadboard-led");
  const cases = [
    breadboard.replace("<x>0</x>", "<x>not-a-number</x>"),
    breadboard.replace("<w>1</w>", "<w>not-a-number</w>"),
    resistor.replace(
      "<x>55.8799973</x>",
      "<x>not-a-number</x>",
    ),
    led.replace("<id>456</id>", "<id>not-a-number</id>"),
    resistor.replace("<id>581</id>", "<id>-1</id>"),
    resistor.replace(">1000</anyType>", ">not-a-number</anyType>"),
    resistor.replace(">1000</anyType>", ">0x10</anyType>"),
    resistor.replace(">1000</anyType>", ">0b10</anyType>"),
    resistor.replace(">1000</anyType>", ">1E+100</anyType>"),
    led.replace(
      '<anyType xsi:type="xsd:int">0</anyType>',
      '<anyType xsi:type="xsd:int">1e2</anyType>',
    ),
    breadboard.replace("<x>0</x>", "<x>1E+100</x>"),
    breadboard.replace("<x>0</x>", "<x>1e-50</x>"),
    breadboard.replace(
      "      </data>",
      '        <anyType xsi:type="ArrayOfBoolean"><boolean>true</boolean><boolean>not-a-boolean</boolean></anyType>\n      </data>',
    ),
    breadboard.replace(
      "      </data>",
      '        <anyType xsi:type="xsd:boolean">not-a-boolean</anyType>\n      </data>',
    ),
    breadboard.replace(
      "      </data>",
      '        <anyType xsi:type="xsd:boolean">True</anyType>\n      </data>',
    ),
  ];

  for (const xml of cases) {
    assert.throws(() => decodeCru(xml));
    assert.throws(() => inspectCru(xml));
    const result = validateCru(xml);
    assert.equal(result.valid, false, xml.slice(0, 200));
    assert.equal(result.inspection, undefined);
    assert.equal(result.diagnostics[0]?.code, "invalid-xml-or-root");
    assert.match(result.diagnostics[0]?.message ?? "", /payload|Vector3S|QuaternionS/);
  }
});

test("namespace rebinding cannot disguise known xsi and xsd payloads", () => {
  const resistor = generateFixture("breadboard-resistor");
  const breadboard = generateFixture("breadboard");
  const cases = [
    resistor.replace(
      "<SaveData ",
      '<SaveData xmlns="urn:wrong" ',
    ),
    resistor.replace(
      "<components>",
      '<components xmlns="urn:wrong">',
    ),
    resistor
      .replace(
        "<components>",
        '<c:components xmlns:c="urn:hidden">',
      )
      .replace("</components>", "</c:components>"),
    resistor.replace(
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
      "",
    ),
    resistor.replace(
      ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
      ' xmlns:xsd="urn:wrong"',
    ),
    resistor.replace(
      '<anyType xsi:type="xsd:float">1000</anyType>',
      '<anyType xmlns:xsd="urn:wrong" xsi:type="xsd:float">1000</anyType>',
    ),
    resistor.replace(
      '<anyType xsi:type="xsd:float">1000</anyType>',
      '<anyType xmlns="urn:wrong" xsi:type="xsd:float">1000</anyType>',
    ),
    resistor.replace(
      '<anyType xsi:type="xsd:float">1000</anyType>',
      '<anyType xmlns:xsi="urn:wrong" xsi:type="xsd:float">1000</anyType>',
    ),
    breadboard.replace(
      ' xmlns:q1="http://microsoft.com/wsdl/types/"',
      "",
    ),
    breadboard.replace(
      'xmlns:q1="http://microsoft.com/wsdl/types/"',
      'xmlns:q1="urn:wrong"',
    ),
  ];

  for (const xml of cases) {
    assert.throws(() => decodeCru(xml));
    assert.throws(() => inspectCru(xml));
    const result = validateCru(xml);
    assert.equal(result.valid, false);
    assert.equal(result.inspection, undefined);
    assert.equal(result.diagnostics[0]?.code, "invalid-xml-or-root");
    assert.match(result.diagnostics[0]?.message ?? "", /namespace|unbound/i);
  }
});

test("duplicate singleton containers cannot hide CRUMB content", () => {
  const breadboard = generateFixture("breadboard");
  const cases = [
    breadboard.replace(
      "  <components>",
      "  <components />\n  <components>",
    ),
    breadboard.replace(
      "      <data>",
      "      <data />\n      <data>",
    ),
    breadboard.replace(
      "      <toolID>0</toolID>",
      "      <toolID>0</toolID>\n      <toolID>0</toolID>",
    ),
  ];
  for (const xml of cases) {
    assert.throws(() => decodeCru(xml));
    assert.throws(() => inspectCru(xml));
    const result = validateCru(xml);
    assert.equal(result.valid, false);
    assert.equal(result.inspection, undefined);
    assert.equal(result.diagnostics[0]?.code, "invalid-xml-or-root");
    assert.match(result.diagnostics[0]?.message ?? "", /duplicate|exactly one/i);
  }
});

test("serializer rejects runtime scalar values that contradict their xsi type", () => {
  const document: CruDocument = {
    name: "Malformed Scalar",
    components: [
      {
        toolId: 3,
        guid: "35f92d9a-cda9-44c7-b416-8c77f301248e",
        geometry: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        tiePoints: [
          {
            id: 0,
            parentIdentifier: "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a",
          },
          {
            id: 1,
            parentIdentifier: "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a",
          },
        ],
        settings: [
          { type: "xsd:int", value: "not-an-int" } as never,
        ],
      },
    ],
  };

  assert.throws(
    () => serializeCru(document),
    /xsd:int settings require a numeric value/,
  );
  assert.throws(
    () =>
      serializeCru({
        name: "Float32 Underflow",
        components: [],
        pivotPosition: { x: 1e-50, y: 0, z: 0 },
      }),
    /structurally invalid|spatial/i,
  );
});

test("parser work limits reject hostile depth and collection counts", () => {
  const saveDataOpen =
    '<SaveData xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">';
  const tooDeep =
    saveDataOpen +
    "<nested>".repeat(MAX_CRU_XML_DEPTH) +
    "</nested>".repeat(MAX_CRU_XML_DEPTH) +
    "</SaveData>";
  const tooManyComponents =
    `${saveDataOpen}<name>Many</name><components>` +
    "<SaveComponent />".repeat(MAX_CRU_COMPONENTS + 1) +
    "</components></SaveData>";
  const tooManyValues =
    `${saveDataOpen}<name>Many Values</name><components><SaveComponent>` +
    "<toolID>0</toolID><data>" +
    '<anyType xsi:type="xsd:string" />'.repeat(
      MAX_CRU_DATA_VALUES_PER_COMPONENT + 1,
    ) +
    "</data></SaveComponent></components></SaveData>";

  for (const xml of [tooDeep, tooManyComponents, tooManyValues]) {
    const result = validateCru(xml);
    assert.equal(result.valid, false);
    assert.equal(
      result.diagnostics[0]?.code,
      "structural-work-limit-exceeded",
    );
    assert.equal(result.inspection, undefined);
  }
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
        `        <anyType xmlns:custom="urn:test" xsi:type="custom:payload"><${oversizedXmlName} /></anyType>\n      </data>`,
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
